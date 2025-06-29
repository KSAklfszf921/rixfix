
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  syncType: string;
  batchSize?: number;
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
    const { syncType, batchSize = 50 }: SyncRequest = await req.json();
    console.log(`Starting batch sync for: ${syncType}, batch size: ${batchSize}`);

    const abortController = new AbortController();
    const syncSessionId = crypto.randomUUID();

    // Get current sync state
    const { data: syncState, error: stateError } = await supabase
      .from('sync_state')
      .select('*')
      .eq('sync_type', syncType)
      .single();

    if (stateError) {
      console.error('Failed to get sync state:', stateError);
      throw new Error(`Failed to get sync state: ${stateError.message}`);
    }

    // Check if sync is already complete
    if (syncState.is_complete) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Sync already complete. Reset to continue.',
          recordsProcessed: 0 
        }),
        { 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          } 
        }
      );
    }

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
        total_records: batchSize,
        processed_records: 0,
        failed_records: 0
      });

    let totalProcessed = 0;
    const startTime = Date.now();

    try {
      switch (syncType) {
        case 'members':
          totalProcessed = await syncMembersBatch(abortController.signal, syncSessionId, batchSize, syncState.last_offset);
          break;
        case 'debates':
          totalProcessed = await syncDebatesBatch(abortController.signal, syncSessionId, batchSize, syncState.last_offset);
          break;
        case 'documents':
          totalProcessed = await syncDocumentsBatch(abortController.signal, syncSessionId, batchSize, syncState.last_offset);
          break;
        case 'votes':
          totalProcessed = await syncVotesBatch(abortController.signal, syncSessionId, batchSize, syncState.last_offset);
          break;
        default:
          throw new Error(`Unknown sync type: ${syncType}`);
      }

      // Update sync state
      await supabase
        .from('sync_state')
        .update({
          last_offset: syncState.last_offset + totalProcessed,
          total_fetched: syncState.total_fetched + totalProcessed,
          last_sync_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Mark as complete if we got less than requested batch size
          is_complete: totalProcessed < batchSize
        })
        .eq('sync_type', syncType);

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
          completed_at: new Date().toISOString(),
          processed_records: totalProcessed
        })
        .eq('sync_session_id', syncSessionId);

      console.log(`Batch sync completed for ${syncType}: ${totalProcessed} records in ${duration}ms`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          syncType, 
          recordsProcessed: totalProcessed,
          duration,
          isComplete: totalProcessed < batchSize
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
        console.log(`Batch sync aborted for ${syncType}`);
        
        await supabase
          .from('api_sync_log')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Batch-synkronisering avbruten av användaren',
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
          JSON.stringify({ success: false, error: 'Batch sync aborted by user' }),
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
    console.error('Batch sync error:', error);
    
    // Update failed sync log
    await supabase
      .from('api_sync_log')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error.message
      })
      .eq('sync_type', (await req.json()).syncType)
      .eq('status', 'running');
    
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

async function syncMembersBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing members batch: offset=${offset}, limit=${batchSize}`);
  
  // Riksdagens API använder inte offset/limit direkt, så vi hämtar alla och slicear
  const response = await fetch(
    'https://data.riksdag.se/personlista/?format=json&utformat=utokad',
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch members: ${response.statusText}`);
  }
  
  const data = await response.json();
  const allMembers = data?.personlista?.person || [];
  
  // Slice to get the requested batch
  const members = allMembers.slice(offset, offset + batchSize);
  
  if (members.length === 0) {
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: members.length,
      current_status: `Processing members batch: ${offset}-${offset + members.length}`
    })
    .eq('sync_session_id', sessionId);

  const memberData = members.map((member: any) => ({
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
    throw error;
  }

  await supabase
    .from('sync_progress')
    .update({
      processed_records: members.length,
      current_status: `Completed members batch: ${members.length} records`
    })
    .eq('sync_session_id', sessionId);

  return members.length;
}

async function syncDebatesBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing debates batch: offset=${offset}, limit=${batchSize}`);
  
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90); // Hämta från de senaste 90 dagarna
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  // Riksdagens API stöder inte offset/limit för anföranden, så vi hämtar alla och slicear
  const response = await fetch(
    `https://data.riksdag.se/anforandelista/?format=json&from=${fromDateStr}`,
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch debates: ${response.statusText}`);
  }
  
  const data = await response.json();
  const allDebates = data?.anforandelista?.anforande || [];
  
  const debates = allDebates.slice(offset, offset + batchSize);
  
  if (debates.length === 0) {
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: debates.length,
      current_status: `Processing debates batch: ${offset}-${offset + debates.length}`
    })
    .eq('sync_session_id', sessionId);

  const debateData = debates.map((debate: any) => ({
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
    throw error;
  }

  await supabase
    .from('sync_progress')
    .update({
      processed_records: debates.length,
      current_status: `Completed debates batch: ${debates.length} records`
    })
    .eq('sync_session_id', sessionId);

  return debates.length;
}

async function syncDocumentsBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing documents batch: offset=${offset}, limit=${batchSize}`);
  
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const response = await fetch(
    `https://data.riksdag.se/dokumentlista/?format=json&from=${fromDateStr}`,
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch documents: ${response.statusText}`);
  }
  
  const data = await response.json();
  const allDocuments = data?.dokumentlista?.dokument || [];
  
  const documents = allDocuments.slice(offset, offset + batchSize);
  
  if (documents.length === 0) {
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: documents.length,
      current_status: `Processing documents batch: ${offset}-${offset + documents.length}`
    })
    .eq('sync_session_id', sessionId);

  const documentData = documents.map((doc: any) => ({
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
    throw error;
  }

  await supabase
    .from('sync_progress')
    .update({
      processed_records: documents.length,
      current_status: `Completed documents batch: ${documents.length} records`
    })
    .eq('sync_session_id', sessionId);

  return documents.length;
}

async function syncVotesBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing votes batch: offset=${offset}, limit=${batchSize}`);
  
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const response = await fetch(
    `https://data.riksdag.se/voteringlista/?format=json&from=${fromDateStr}`,
    { signal }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch votes: ${response.statusText}`);
  }
  
  const data = await response.json();
  const allVotes = data?.voteringlista?.votering || [];
  
  const votes = allVotes.slice(offset, offset + batchSize);
  
  if (votes.length === 0) {
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: votes.length,
      current_status: `Processing votes batch: ${offset}-${offset + votes.length}`
    })
    .eq('sync_session_id', sessionId);

  const voteData = votes.map((vote: any) => ({
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
    throw error;
  }

  await supabase
    .from('sync_progress')
    .update({
      processed_records: votes.length,
      current_status: `Completed votes batch: ${votes.length} records`
    })
    .eq('sync_session_id', sessionId);

  return votes.length;
}
