
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  syncType: string;
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { syncType }: SyncRequest = await req.json();
    console.log(`Starting sync for: ${syncType}`);

    // Create abort controller for this sync session
    const abortController = new AbortController();
    const syncSessionId = crypto.randomUUID();

    // Log sync start
    const { error: logError } = await supabase
      .from('api_sync_log')
      .insert({
        sync_type: syncType,
        status: 'running',
        started_at: new Date().toISOString(),
        records_processed: 0
      });

    if (logError) {
      console.error('Failed to log sync start:', logError);
    }

    // Initialize progress tracking
    await supabase
      .from('sync_progress')
      .insert({
        sync_session_id: syncSessionId,
        sync_type: syncType,
        current_status: 'starting',
        total_records: 0,
        processed_records: 0,
        failed_records: 0
      });

    let totalProcessed = 0;
    const startTime = Date.now();

    try {
      switch (syncType) {
        case 'members':
          totalProcessed = await syncMembers(abortController.signal, syncSessionId);
          break;
        case 'debates':
          totalProcessed = await syncDebates(abortController.signal, syncSessionId);
          break;
        case 'documents':
          totalProcessed = await syncDocuments(abortController.signal, syncSessionId);
          break;
        case 'votes':
          totalProcessed = await syncVotes(abortController.signal, syncSessionId);
          break;
        default:
          throw new Error(`Unknown sync type: ${syncType}`);
      }

      // Mark as completed
      const endTime = Date.now();
      const duration = endTime - startTime;

      await supabase
        .from('api_sync_log')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          records_processed: totalProcessed
        })
        .eq('sync_type', syncType)
        .eq('status', 'running');

      await supabase
        .from('sync_progress')
        .update({
          current_status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('sync_session_id', syncSessionId);

      console.log(`Sync completed for ${syncType}: ${totalProcessed} records in ${duration}ms`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          syncType, 
          recordsProcessed: totalProcessed,
          duration 
        }),
        { 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          } 
        }
      );

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(`Sync aborted for ${syncType}`);
        
        await supabase
          .from('api_sync_log')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Synkronisering avbruten av användaren',
            records_processed: totalProcessed
          })
          .eq('sync_type', syncType)
          .eq('status', 'running');

        await supabase
          .from('sync_progress')
          .update({
            current_status: 'aborted',
            completed_at: new Date().toISOString()
          })
          .eq('sync_session_id', syncSessionId);

        return new Response(
          JSON.stringify({ success: false, error: 'Sync aborted by user' }),
          { 
            status: 499,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders 
            } 
          }
        );
      }

      throw error;
    }

  } catch (error: any) {
    console.error('Sync error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders 
        } 
      }
    );
  }
});

async function syncMembers(signal: AbortSignal, sessionId: string): Promise<number> {
  console.log('Syncing members from Riksdag API...');
  
  const response = await fetch(
    'https://data.riksdag.se/personlista/?format=json&utformat=utokad',
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch members: ${response.statusText}`);
  }
  
  const data = await response.json();
  const members = data?.personlista?.person || [];
  
  await supabase
    .from('sync_progress')
    .update({
      total_records: members.length
    })
    .eq('sync_session_id', sessionId);

  let processed = 0;
  const batchSize = 50;

  for (let i = 0; i < members.length; i += batchSize) {
    if (signal.aborted) {
      throw new Error('AbortError');
    }

    const batch = members.slice(i, i + batchSize);
    const memberData = batch.map((member: any) => ({
      iid: member.intressent_id,
      tilltalsnamn: member.tilltalsnamn,
      efternamn: member.efternamn,
      parti: member.parti,
      valkrets: member.valkrets,
      status: member.status,
      kon: member.kon,
      fodd_ar: member.fodd_ar ? parseInt(member.fodd_ar) : null,
      bild_url: member.bild_url_192 || member.bild_url_80,
      webbplats_url: member.webbsida_url
    }));

    const { error } = await supabase
      .from('ledamoter')
      .upsert(memberData, { onConflict: 'iid' });

    if (error) {
      console.error('Failed to upsert members:', error);
    } else {
      processed += batch.length;
      
      await supabase
        .from('sync_progress')
        .update({
          processed_records: processed,
          current_status: `Processing members: ${processed}/${members.length}`
        })
        .eq('sync_session_id', sessionId);
    }
  }

  return processed;
}

async function syncDebates(signal: AbortSignal, sessionId: string): Promise<number> {
  console.log('Syncing debates from Riksdag API...');
  
  // Get recent debates (last 30 days)
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const response = await fetch(
    `https://data.riksdag.se/anforandelista/?format=json&from=${fromDateStr}`,
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch debates: ${response.statusText}`);
  }
  
  const data = await response.json();
  const debates = data?.anforandelista?.anforande || [];
  
  await supabase
    .from('sync_progress')
    .update({
      total_records: debates.length
    })
    .eq('sync_session_id', sessionId);

  let processed = 0;
  const batchSize = 25;

  for (let i = 0; i < debates.length; i += batchSize) {
    if (signal.aborted) {
      throw new Error('AbortError');
    }

    const batch = debates.slice(i, i + batchSize);
    const debateData = batch.map((debate: any) => ({
      anforande_id: debate.anforande_id,
      datum: debate.datum,
      talare: debate.talare,
      parti: debate.parti,
      intressent_id: debate.intressent_id,
      rubrik: debate.rubrik,
      text: debate.anforandetext,
      dok_titel: debate.dok_titel,
      anforandetyp: debate.anforandetyp,
      kon: debate.kon
    }));

    const { error } = await supabase
      .from('anforanden')
      .upsert(debateData, { onConflict: 'anforande_id' });

    if (error) {
      console.error('Failed to upsert debates:', error);
    } else {
      processed += batch.length;
      
      await supabase
        .from('sync_progress')
        .update({
          processed_records: processed,
          current_status: `Processing debates: ${processed}/${debates.length}`
        })
        .eq('sync_session_id', sessionId);
    }
  }

  return processed;
}

async function syncDocuments(signal: AbortSignal, sessionId: string): Promise<number> {
  console.log('Syncing documents from Riksdag API...');
  
  // Get recent documents (last 30 days)
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const response = await fetch(
    `https://data.riksdag.se/dokumentlista/?format=json&from=${fromDateStr}`,
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch documents: ${response.statusText}`);
  }
  
  const data = await response.json();
  const documents = data?.dokumentlista?.dokument || [];
  
  await supabase
    .from('sync_progress')
    .update({
      total_records: documents.length
    })
    .eq('sync_session_id', sessionId);

  let processed = 0;
  const batchSize = 25;

  for (let i = 0; i < documents.length; i += batchSize) {
    if (signal.aborted) {
      throw new Error('AbortError');
    }

    const batch = documents.slice(i, i + batchSize);
    const documentData = batch.map((doc: any) => ({
      dok_id: doc.dok_id,
      titel: doc.titel,
      doktyp: doc.doktyp,
      rm: doc.rm,
      datum: doc.datum,
      organ: doc.organ,
      dokument_url_html: doc.dokument_url_html,
      dokument_url_pdf: doc.dokument_url_pdf,
      dokument_url_text: doc.dokument_url_text,
      status: doc.status
    }));

    const { error } = await supabase
      .from('dokument')
      .upsert(documentData, { onConflict: 'dok_id' });

    if (error) {
      console.error('Failed to upsert documents:', error);
    } else {
      processed += batch.length;
      
      await supabase
        .from('sync_progress')
        .update({
          processed_records: processed,
          current_status: `Processing documents: ${processed}/${documents.length}`
        })
        .eq('sync_session_id', sessionId);
    }
  }

  return processed;
}

async function syncVotes(signal: AbortSignal, sessionId: string): Promise<number> {
  console.log('Syncing votes from Riksdag API...');
  
  // Get recent votes (last 30 days)
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const response = await fetch(
    `https://data.riksdag.se/voteringlista/?format=json&from=${fromDateStr}`,
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch votes: ${response.statusText}`);
  }
  
  const data = await response.json();
  const votes = data?.voteringlista?.votering || [];
  
  await supabase
    .from('sync_progress')
    .update({
      total_records: votes.length
    })
    .eq('sync_session_id', sessionId);

  let processed = 0;
  const batchSize = 25;

  for (let i = 0; i < votes.length; i += batchSize) {
    if (signal.aborted) {
      throw new Error('AbortError');
    }

    const batch = votes.slice(i, i + batchSize);
    const voteData = batch.map((vote: any) => ({
      votering_id: vote.votering_id,
      dok_id: vote.dok_id,
      avser: vote.avser,
      votering_datum: vote.datum,
      namn: vote.namn,
      parti: vote.parti,
      valkrets: vote.valkrets,
      rost: vote.rost,
      intressent_id: vote.intressent_id
    }));

    const { error } = await supabase
      .from('voteringar')
      .upsert(voteData, { onConflict: 'votering_id,intressent_id' });

    if (error) {
      console.error('Failed to upsert votes:', error);
    } else {
      processed += batch.length;
      
      await supabase
        .from('sync_progress')
        .update({
          processed_records: processed,
          current_status: `Processing votes: ${processed}/${votes.length}`
        })
        .eq('sync_session_id', sessionId);
    }
  }

  return processed;
}
