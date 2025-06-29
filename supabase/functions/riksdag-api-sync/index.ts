
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

// API-konfiguration baserad på Riksdagens öppna data dokumentation
const RIKSDAG_API_CONFIG = {
  baseUrl: 'https://data.riksdag.se',
  endpoints: {
    members: '/personlista/?format=json&utformat=utokad',
    debates: '/anforandelista/?format=json',
    documents: '/dokumentlista/?format=json',
    votes: '/voteringlista/?format=json'
  },
  // Riksdagens API stöder inte offset/limit direkt, så vi hanterar det lokalt
  maxRetries: 3,
  timeout: 60000 // 60 sekunder timeout per request
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const abortController = new AbortController();
  const syncSessionId = crypto.randomUUID();
  
  // Sätt upp timeout för hela operationen (5 minuter)
  const timeoutId = setTimeout(() => {
    console.log('Operation timeout reached, aborting...');
    abortController.abort();
  }, 300000);

  try {
    const { syncType, batchSize = 50 }: SyncRequest = await req.json();
    console.log(`Starting validated batch sync for: ${syncType}, batch size: ${batchSize}, session: ${syncSessionId}`);

    // Validera syncType
    if (!['members', 'debates', 'documents', 'votes'].includes(syncType)) {
      throw new Error(`Invalid sync type: ${syncType}`);
    }

    // Get current sync state med abort signal
    const { data: syncState, error: stateError } = await supabase
      .from('sync_state')
      .select('*')
      .eq('sync_type', syncType)
      .abortSignal(abortController.signal)
      .single();

    if (stateError) {
      console.error('Failed to get sync state:', stateError);
      throw new Error(`Failed to get sync state: ${stateError.message}`);
    }

    // Check if sync is already complete
    if (syncState.is_complete) {
      clearTimeout(timeoutId);
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

    // Log sync start med abort signal
    const { error: logError } = await supabase
      .from('api_sync_log')
      .insert({
        sync_type: syncType,
        status: 'running',
        started_at: new Date().toISOString(),
        records_processed: 0
      })
      .abortSignal(abortController.signal);

    if (logError) {
      console.error('Failed to log sync start:', logError);
    }

    // Initialize progress tracking med abort signal
    await supabase
      .from('sync_progress')
      .insert({
        sync_session_id: syncSessionId,
        sync_type: syncType,
        current_status: 'starting',
        total_records: batchSize,
        processed_records: 0,
        failed_records: 0
      })
      .abortSignal(abortController.signal);

    let totalProcessed = 0;
    const startTime = Date.now();

    try {
      console.log(`Processing ${syncType} with proper API validation...`);
      
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

      // Update sync state med abort signal
      await supabase
        .from('sync_state')
        .update({
          last_offset: syncState.last_offset + totalProcessed,
          total_fetched: syncState.total_fetched + totalProcessed,
          last_sync_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_complete: totalProcessed < batchSize
        })
        .eq('sync_type', syncType)
        .abortSignal(abortController.signal);

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
        .eq('status', 'running')
        .abortSignal(abortController.signal);

      await supabase
        .from('sync_progress')
        .update({
          current_status: 'completed',
          completed_at: new Date().toISOString(),
          processed_records: totalProcessed
        })
        .eq('sync_session_id', syncSessionId)
        .abortSignal(abortController.signal);

      console.log(`Batch sync completed for ${syncType}: ${totalProcessed} records in ${duration}ms`);
      clearTimeout(timeoutId);

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
            error_message: 'Batch-synkronisering avbruten',
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

        clearTimeout(timeoutId);
        return new Response(
          JSON.stringify({ success: false, error: 'Batch sync aborted' }),
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
    clearTimeout(timeoutId);
    
    // Update failed sync log
    try {
      await supabase
        .from('api_sync_log')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message
        })
        .eq('sync_type', (await req.json()).syncType)
        .eq('status', 'running');
    } catch (logError) {
      console.error('Failed to update error log:', logError);
    }
    
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

async function makeRiksdagApiRequest(url: string, signal: AbortSignal): Promise<any> {
  console.log(`Making API request to: ${url}`);
  
  let lastError;
  
  for (let attempt = 1; attempt <= RIKSDAG_API_CONFIG.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RIKSDAG_API_CONFIG.timeout);
      
      // Kombinera signals
      signal.addEventListener('abort', () => controller.abort());
      
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'Riksdagskoll/1.0',
          'Accept': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`API request successful on attempt ${attempt}`);
      return data;
      
    } catch (error: any) {
      lastError = error;
      console.error(`API request attempt ${attempt} failed:`, error.message);
      
      if (error.name === 'AbortError' || signal.aborted) {
        throw error;
      }
      
      if (attempt < RIKSDAG_API_CONFIG.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

async function syncMembersBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing members batch: offset=${offset}, limit=${batchSize}`);
  
  const url = `${RIKSDAG_API_CONFIG.baseUrl}${RIKSDAG_API_CONFIG.endpoints.members}`;
  const data = await makeRiksdagApiRequest(url, signal);
  
  const allMembers = data?.personlista?.person || [];
  console.log(`Retrieved ${allMembers.length} total members from API`);
  
  const members = allMembers.slice(offset, offset + batchSize);
  
  if (members.length === 0) {
    console.log('No more members to process');
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: members.length,
      current_status: `Processing members batch: ${offset}-${offset + members.length}`
    })
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

  // Validera och mappa data enligt Riksdagens API-specifikation
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
  })).filter(member => member.iid); // Filtrera bort poster utan ID

  console.log(`Processed ${memberData.length} valid members`);

  const { error } = await supabase
    .from('ledamoter')
    .upsert(memberData, { onConflict: 'iid' })
    .abortSignal(signal);

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
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

  return members.length;
}

async function syncDebatesBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing debates batch: offset=${offset}, limit=${batchSize}`);
  
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const url = `${RIKSDAG_API_CONFIG.baseUrl}${RIKSDAG_API_CONFIG.endpoints.debates}&from=${fromDateStr}`;
  const data = await makeRiksdagApiRequest(url, signal);
  
  const allDebates = data?.anforandelista?.anforande || [];
  console.log(`Retrieved ${allDebates.length} total debates from API`);
  
  const debates = allDebates.slice(offset, offset + batchSize);
  
  if (debates.length === 0) {
    console.log('No more debates to process');
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: debates.length,
      current_status: `Processing debates batch: ${offset}-${offset + debates.length}`
    })
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

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
  })).filter(debate => debate.anforande_id);

  console.log(`Processed ${debateData.length} valid debates`);

  const { error } = await supabase
    .from('anforanden')
    .upsert(debateData, { onConflict: 'anforande_id' })
    .abortSignal(signal);

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
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

  return debates.length;
}

async function syncDocumentsBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing documents batch: offset=${offset}, limit=${batchSize}`);
  
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const url = `${RIKSDAG_API_CONFIG.baseUrl}${RIKSDAG_API_CONFIG.endpoints.documents}&from=${fromDateStr}`;
  const data = await makeRiksdagApiRequest(url, signal);
  
  const allDocuments = data?.dokumentlista?.dokument || [];
  console.log(`Retrieved ${allDocuments.length} total documents from API`);
  
  const documents = allDocuments.slice(offset, offset + batchSize);
  
  if (documents.length === 0) {
    console.log('No more documents to process');
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: documents.length,
      current_status: `Processing documents batch: ${offset}-${offset + documents.length}`
    })
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

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
  })).filter(doc => doc.dok_id);

  console.log(`Processed ${documentData.length} valid documents`);

  const { error } = await supabase
    .from('dokument')
    .upsert(documentData, { onConflict: 'dok_id' })
    .abortSignal(signal);

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
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

  return documents.length;
}

async function syncVotesBatch(signal: AbortSignal, sessionId: string, batchSize: number, offset: number): Promise<number> {
  console.log(`Syncing votes batch: offset=${offset}, limit=${batchSize}`);
  
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const fromDateStr = fromDate.toISOString().split('T')[0];
  
  const url = `${RIKSDAG_API_CONFIG.baseUrl}${RIKSDAG_API_CONFIG.endpoints.votes}&from=${fromDateStr}`;
  const data = await makeRiksdagApiRequest(url, signal);
  
  const allVotes = data?.voteringlista?.votering || [];
  console.log(`Retrieved ${allVotes.length} total votes from API`);
  
  const votes = allVotes.slice(offset, offset + batchSize);
  
  if (votes.length === 0) {
    console.log('No more votes to process');
    return 0;
  }

  await supabase
    .from('sync_progress')
    .update({
      total_records: votes.length,
      current_status: `Processing votes batch: ${offset}-${offset + votes.length}`
    })
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

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
  })).filter(vote => vote.votering_id && vote.intressent_id);

  console.log(`Processed ${voteData.length} valid votes`);

  const { error } = await supabase
    .from('voteringar')
    .upsert(voteData, { onConflict: 'votering_id,intressent_id' })
    .abortSignal(signal);

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
    .eq('sync_session_id', sessionId)
    .abortSignal(signal);

  return votes.length;
}
