
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RiksdagApiConfig {
  baseUrl: string;
  endpoints: {
    [key: string]: string;
  };
}

const API_CONFIG: RiksdagApiConfig = {
  baseUrl: 'https://data.riksdag.se',
  endpoints: {
    members: '/personlista/?iid=&fnamn=&enamn=&f_ar=&kn=&parti=&valkrets=&rdlstatus=&org=&utformat=json&termlista=',
    debates: '/anforande/?rm=&bet=&punkt=&dok_id=&anf_id=&talare=&parti=&anforandetyp=&anfnr=&anf_datum_from=&anf_datum_tom=&kammaraktivitet=&anf_sekunder=&anf_klockslag_from=&anf_klockslag_tom=&anf_video=&debatt=&utformat=json&a_sz=50',
    documents: '/dokumentlista/?sok=&doktyp=&rm=&from=&tom=&ts=&bet=&tempbet=&nr=&org=&iid=&webbtv=&talare=&exakt=&planering=&sort=datum&sortorder=desc&rapport=&utformat=json&a_sz=50',
    votes: '/votering/?rm=&bet=&punkt=&valkrets=&rost=&iid=&sz=50&utformat=json'
  }
};

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRiksdagRequest(url: string, retryCount = 0): Promise<any> {
  try {
    console.log(`Making request to: ${url} (attempt ${retryCount + 1})`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Riksdagskoll/1.0 (Educational Purpose)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - exponential backoff
        const delay = Math.min(
          RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
          RETRY_CONFIG.maxDelay
        );
        console.log(`Rate limited, waiting ${delay}ms before retry`);
        await sleep(delay);
        
        if (retryCount < RETRY_CONFIG.maxRetries) {
          return makeRiksdagRequest(url, retryCount + 1);
        }
        throw new Error(`Rate limited after ${RETRY_CONFIG.maxRetries} retries`);
      }
      
      if (response.status === 413) {
        throw new Error('ResponseTooLargeError: Query returned too much data. Try reducing batch size or adding more filters.');
      }
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data || (data.dokumentlista?.dokument?.length === 0 && data.personlista?.person?.length === 0 && data.anforandelista?.anforande?.length === 0 && data.voteringlista?.votering?.length === 0)) {
      console.log('Empty response received');
      return { isEmpty: true, data };
    }

    return { isEmpty: false, data };
  } catch (error) {
    console.error(`Request failed:`, error);
    
    if (retryCount < RETRY_CONFIG.maxRetries && !error.message.includes('ResponseTooLargeError')) {
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
        RETRY_CONFIG.maxDelay
      );
      console.log(`Retrying in ${delay}ms...`);
      await sleep(delay);
      return makeRiksdagRequest(url, retryCount + 1);
    }
    
    throw error;
  }
}

function buildApiUrl(syncType: string, filters: any = {}, offset = 0, batchSize = 50): string {
  const baseEndpoint = API_CONFIG.endpoints[syncType];
  if (!baseEndpoint) {
    throw new Error(`Unknown sync type: ${syncType}`);
  }

  let url = `${API_CONFIG.baseUrl}${baseEndpoint}`;
  
  // Add pagination
  if (url.includes('sz=')) {
    url = url.replace(/sz=\d+/, `sz=${batchSize}`);
  } else if (url.includes('a_sz=')) {
    url = url.replace(/a_sz=\d+/, `a_sz=${batchSize}`);
  }
  
  // Add offset/page parameter
  if (offset > 0) {
    const page = Math.floor(offset / batchSize) + 1;
    url += `&p=${page}`;
  }

  // Apply filters
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== '') {
        // Handle date filters
        if (key.includes('_from') || key.includes('_tom')) {
          url = url.replace(new RegExp(`${key}=[^&]*`), `${key}=${value}`);
        } else {
          url += `&${key}=${encodeURIComponent(value)}`;
        }
      }
    });
  }

  return url;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { syncType, batchSize = 50, filters = {}, preview = false } = await req.json()

    if (!syncType) {
      throw new Error('syncType is required')
    }

    // Log start of sync
    const { data: logEntry } = await supabaseClient
      .from('api_sync_log')
      .insert({
        sync_type: syncType,
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single()

    const logId = logEntry?.id

    try {
      // Get current sync state
      const { data: syncState } = await supabaseClient
        .from('sync_state')
        .select('*')
        .eq('sync_type', syncType)
        .single()

      const currentOffset = syncState?.last_offset || 0
      
      // Build API URL
      const apiUrl = buildApiUrl(syncType, filters, currentOffset, batchSize)
      console.log(`Built API URL: ${apiUrl}`)

      // If preview mode, just return the URL and estimated count
      if (preview) {
        return new Response(
          JSON.stringify({
            success: true,
            preview: true,
            apiUrl,
            estimatedBatch: batchSize,
            currentOffset,
            filters
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Make API request
      const result = await makeRiksdagRequest(apiUrl)
      
      if (result.isEmpty) {
        // Mark as complete if no more data
        await supabaseClient
          .from('sync_state')
          .upsert({
            sync_type: syncType,
            is_complete: true,
            last_sync_date: new Date().toISOString(),
            api_endpoint: apiUrl,
            filter_params: filters,
            updated_at: new Date().toISOString()
          })

        await supabaseClient
          .from('api_sync_log')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            records_processed: 0
          })
          .eq('id', logId)

        return new Response(
          JSON.stringify({
            success: true,
            message: 'No more data available',
            recordsProcessed: 0,
            isComplete: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Process the data based on sync type
      let recordsProcessed = 0
      const { data } = result

      switch (syncType) {
        case 'members':
          if (data.personlista?.person) {
            const members = Array.isArray(data.personlista.person) 
              ? data.personlista.person 
              : [data.personlista.person]
            
            for (const member of members) {
              await supabaseClient
                .from('ledamoter')
                .upsert({
                  iid: member.intressent_id,
                  tilltalsnamn: member.tilltalsnamn,
                  efternamn: member.efternamn,
                  parti: member.parti,
                  valkrets: member.valkrets,
                  kon: member.kon,
                  fodd_ar: member.fodd_ar ? parseInt(member.fodd_ar) : null,
                  status: member.status,
                  bild_url: member.bild_url_192,
                  senast_uppdaterad: new Date().toISOString()
                })
            }
            
            recordsProcessed = members.length
          }
          break;

        case 'debates':
          if (data.anforandelista?.anforande) {
            const debates = Array.isArray(data.anforandelista.anforande) 
              ? data.anforandelista.anforande 
              : [data.anforandelista.anforande]
            
            for (const debate of debates) {
              await supabaseClient
                .from('anforanden')
                .upsert({
                  anforande_id: debate.dok_id + '_' + debate.anforande_nummer,
                  intressent_id: debate.intressent_id,
                  talare: debate.talare,
                  parti: debate.parti,
                  datum: debate.datum,
                  anforandetyp: debate.anforandetyp,
                  rubrik: debate.rubrik,
                  text: debate.anforandetext,
                  dok_titel: debate.dok_titel,
                  kon: debate.kon,
                  nummer: debate.anforande_nummer,
                  protokoll_url_xml: debate.protokoll_url_xml,
                  relaterat_dokument_url: debate.relaterat_dokument_url
                })
            }
            
            recordsProcessed = debates.length
          }
          break;

        case 'documents':
          if (data.dokumentlista?.dokument) {
            const documents = Array.isArray(data.dokumentlista.dokument) 
              ? data.dokumentlista.dokument 
              : [data.dokumentlista.dokument]
            
            for (const doc of documents) {
              await supabaseClient
                .from('dokument')
                .upsert({
                  dok_id: doc.dok_id,
                  titel: doc.titel,
                  doktyp: doc.doktyp,
                  datum: doc.datum,
                  status: doc.status,
                  organ: doc.organ,
                  rm: doc.rm,
                  dokument_url_html: doc.dokument_url_html,
                  dokument_url_pdf: doc.dokument_url_pdf,
                  dokument_url_text: doc.dokument_url_text,
                  relaterat_id: doc.relaterat_id,
                  hangar_id: doc.hangar_id
                })
            }
            
            recordsProcessed = documents.length
          }
          break;

        case 'votes':
          if (data.voteringlista?.votering) {
            const votes = Array.isArray(data.voteringlista.votering) 
              ? data.voteringlista.votering 
              : [data.voteringlista.votering]
            
            for (const vote of votes) {
              await supabaseClient
                .from('voteringar')
                .upsert({
                  votering_id: vote.votering_id,
                  intressent_id: vote.intressent_id,
                  namn: vote.namn,
                  parti: vote.parti,
                  valkrets: vote.valkrets,
                  rost: vote.rost,
                  avser: vote.avser,
                  votering_datum: vote.votering_datum,
                  dok_id: vote.dok_id
                })
            }
            
            recordsProcessed = votes.length
          }
          break;
      }

      // Update sync state
      await supabaseClient
        .from('sync_state')
        .upsert({
          sync_type: syncType,
          last_offset: currentOffset + recordsProcessed,
          total_fetched: (syncState?.total_fetched || 0) + recordsProcessed,
          last_sync_date: new Date().toISOString(),
          api_endpoint: apiUrl,
          filter_params: filters,
          retry_count: 0,
          is_complete: recordsProcessed < batchSize,
          updated_at: new Date().toISOString()
        })

      // Update log
      await supabaseClient
        .from('api_sync_log')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          records_processed: recordsProcessed
        })
        .eq('id', logId)

      return new Response(
        JSON.stringify({
          success: true,
          recordsProcessed,
          totalFetched: (syncState?.total_fetched || 0) + recordsProcessed,
          isComplete: recordsProcessed < batchSize,
          apiUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )

    } catch (error) {
      console.error('Sync error:', error)
      
      // Update log with error
      if (logId) {
        await supabaseClient
          .from('api_sync_log')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error.message
          })
          .eq('id', logId)
      }

      // Update sync state with error
      await supabaseClient
        .from('sync_state')
        .upsert({
          sync_type: syncType,
          last_error: error.message,
          retry_count: (syncState?.retry_count || 0) + 1,
          updated_at: new Date().toISOString()
        })

      throw error
    }

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
