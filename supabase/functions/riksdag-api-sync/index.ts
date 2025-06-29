
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
  phases: {
    [key: string]: {
      priority: number;
      maxBatchSize: number;
      defaultBatchSize: number;
      estimatedTotal: number;
    };
  };
}

const API_CONFIG: RiksdagApiConfig = {
  baseUrl: 'https://data.riksdag.se',
  endpoints: {
    members: '/personlista/?iid=&fnamn=&enamn=&f_ar=&kn=&parti=&valkrets=&rdlstatus=&org=&utformat=json&termlista=',
    debates: '/anforande/?rm=&bet=&punkt=&dok_id=&anf_id=&talare=&parti=&anforandetyp=&anfnr=&anf_datum_from=&anf_datum_tom=&kammaraktivitet=&anf_sekunder=&anf_klockslag_from=&anf_klockslag_tom=&anf_video=&debatt=&utformat=json&a_sz=50',
    documents: '/dokumentlista/?sok=&doktyp=&rm=&from=&tom=&ts=&bet=&tempbet=&nr=&org=&iid=&webbtv=&talare=&exakt=&planering=&sort=datum&sortorder=desc&rapport=&utformat=json&a_sz=50',
    votes: '/votering/?rm=&bet=&punkt=&valkrets=&rost=&iid=&sz=50&utformat=json',
    committees: '/utskott/?iid=&namn=&typ=&utformat=json'
  },
  phases: {
    members: { priority: 1, maxBatchSize: 200, defaultBatchSize: 100, estimatedTotal: 500 },
    committees: { priority: 2, maxBatchSize: 50, defaultBatchSize: 25, estimatedTotal: 100 },
    documents: { priority: 3, maxBatchSize: 100, defaultBatchSize: 50, estimatedTotal: 2000 },
    debates: { priority: 4, maxBatchSize: 75, defaultBatchSize: 40, estimatedTotal: 1500 },
    votes: { priority: 5, maxBatchSize: 150, defaultBatchSize: 75, estimatedTotal: 3000 }
  }
};

const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2.5,
  jitterMax: 500
};

const RATE_LIMIT_CONFIG = {
  requestsPerSecond: 2,
  burstLimit: 5,
  cooldownPeriod: 30000
};

let requestQueue: Array<() => Promise<any>> = [];
let lastRequestTime = 0;
let requestCount = 0;
let rateLimitResetTime = 0;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function addJitter(delay: number): number {
  return delay + Math.random() * RETRY_CONFIG.jitterMax;
}

async function rateLimitedRequest<T>(requestFn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  
  if (now < rateLimitResetTime) {
    const waitTime = rateLimitResetTime - now;
    console.log(`Rate limit active, waiting ${waitTime}ms`);
    await sleep(waitTime);
  }
  
  if (now - lastRequestTime >= 1000) {
    requestCount = 0;
  }
  
  if (requestCount >= RATE_LIMIT_CONFIG.requestsPerSecond) {
    const waitTime = 1000 - (now - lastRequestTime);
    if (waitTime > 0) {
      await sleep(waitTime);
    }
    requestCount = 0;
  }
  
  lastRequestTime = Date.now();
  requestCount++;
  
  return await requestFn();
}

async function makeRiksdagRequest(url: string, retryCount = 0): Promise<any> {
  return await rateLimitedRequest(async () => {
    try {
      console.log(`Making request to: ${url} (attempt ${retryCount + 1})`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Riksdagskoll/2.0 (Strategic Data Fetching)',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : 
            Math.min(
              addJitter(RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount)),
              RETRY_CONFIG.maxDelay
            );
          
          console.log(`Rate limited, waiting ${delay}ms before retry`);
          rateLimitResetTime = Date.now() + delay;
          await sleep(delay);
          
          if (retryCount < RETRY_CONFIG.maxRetries) {
            return makeRiksdagRequest(url, retryCount + 1);
          }
          throw new Error(`Rate limited after ${RETRY_CONFIG.maxRetries} retries`);
        }
        
        if (response.status === 413 || response.status === 414) {
          throw new Error('ResponseTooLargeError: Query returned too much data. Try reducing batch size or adding more filters.');
        }
        
        if (response.status >= 500) {
          console.log(`Server error ${response.status}, will retry`);
          if (retryCount < RETRY_CONFIG.maxRetries) {
            const delay = addJitter(RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount));
            await sleep(delay);
            return makeRiksdagRequest(url, retryCount + 1);
          }
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data || Object.keys(data).length === 0) {
        console.log('Empty response received');
        return { isEmpty: true, data: null };
      }

      const hasData = 
        (data.dokumentlista?.dokument?.length > 0) ||
        (data.personlista?.person?.length > 0) ||
        (data.anforandelista?.anforande?.length > 0) ||
        (data.voteringlista?.votering?.length > 0) ||
        (data.utskottslista?.utskott?.length > 0);

      if (!hasData) {
        console.log('No data in response');
        return { isEmpty: true, data };
      }

      return { isEmpty: false, data };
    } catch (error) {
      console.error(`Request failed:`, error);
      
      if (retryCount < RETRY_CONFIG.maxRetries && 
          !error.message.includes('ResponseTooLargeError') &&
          !error.message.includes('NetworkError')) {
        const delay = addJitter(
          Math.min(
            RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
            RETRY_CONFIG.maxDelay
          )
        );
        console.log(`Retrying in ${delay}ms...`);
        await sleep(delay);
        return makeRiksdagRequest(url, retryCount + 1);
      }
      
      throw error;
    }
  });
}

function getOptimalBatchSize(syncType: string, responseTime: number, errorCount: number): number {
  const config = API_CONFIG.phases[syncType];
  if (!config) return 50;
  
  let batchSize = config.defaultBatchSize;
  
  // Adjust based on response time
  if (responseTime > 10000) { // > 10s
    batchSize = Math.max(10, Math.floor(batchSize * 0.5));
  } else if (responseTime > 5000) { // > 5s
    batchSize = Math.max(15, Math.floor(batchSize * 0.7));
  } else if (responseTime < 2000) { // < 2s
    batchSize = Math.min(config.maxBatchSize, Math.floor(batchSize * 1.2));
  }
  
  // Adjust based on error count
  if (errorCount > 3) {
    batchSize = Math.max(5, Math.floor(batchSize * 0.6));
  } else if (errorCount > 1) {
    batchSize = Math.max(10, Math.floor(batchSize * 0.8));
  }
  
  return Math.max(5, Math.min(config.maxBatchSize, batchSize));
}

function buildApiUrl(syncType: string, filters: any = {}, offset = 0, batchSize = 50): string {
  const baseEndpoint = API_CONFIG.endpoints[syncType];
  if (!baseEndpoint) {
    throw new Error(`Unknown sync type: ${syncType}`);
  }

  let url = `${API_CONFIG.baseUrl}${baseEndpoint}`;
  
  // Handle different pagination parameters
  if (url.includes('sz=')) {
    url = url.replace(/sz=\d+/, `sz=${batchSize}`);
  } else if (url.includes('a_sz=')) {
    url = url.replace(/a_sz=\d+/, `a_sz=${batchSize}`);
  }
  
  // Add correct pagination parameter
  if (offset > 0) {
    const page = Math.floor(offset / batchSize) + 1;
    url += `&p=${page}`;
  }

  // Apply filters with proper encoding
  if (filters && Object.keys(filters).length > 0) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== '') {
        if (key.includes('_from') || key.includes('_tom')) {
          url = url.replace(new RegExp(`${key}=[^&]*`), `${key}=${encodeURIComponent(value)}`);
        } else {
          url += `&${key}=${encodeURIComponent(value)}`;
        }
      }
    });
  }

  return url;
}

async function processDataByType(syncType: string, data: any, supabaseClient: any): Promise<number> {
  let recordsProcessed = 0;

  try {
    switch (syncType) {
      case 'members':
        if (data.personlista?.person) {
          const members = Array.isArray(data.personlista.person) 
            ? data.personlista.person 
            : [data.personlista.person];
          
          for (const member of members) {
            try {
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
                }, { onConflict: 'iid' });
            } catch (error) {
              console.error(`Error inserting member ${member.intressent_id}:`, error);
            }
          }
          recordsProcessed = members.length;
        }
        break;

      case 'committees':
        if (data.utskottslista?.utskott) {
          const committees = Array.isArray(data.utskottslista.utskott) 
            ? data.utskottslista.utskott 
            : [data.utskottslista.utskott];
          
          for (const committee of committees) {
            try {
              await supabaseClient
                .from('utskott_kodlista')
                .upsert({
                  kod: committee.kod,
                  namn: committee.namn
                }, { onConflict: 'kod' });
            } catch (error) {
              console.error(`Error inserting committee ${committee.kod}:`, error);
            }
          }
          recordsProcessed = committees.length;
        }
        break;

      case 'debates':
        if (data.anforandelista?.anforande) {
          const debates = Array.isArray(data.anforandelista.anforande) 
            ? data.anforandelista.anforande 
            : [data.anforandelista.anforande];
          
          for (const debate of debates) {
            try {
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
                }, { onConflict: 'anforande_id' });
            } catch (error) {
              console.error(`Error inserting debate ${debate.dok_id}_${debate.anforande_nummer}:`, error);
            }
          }
          recordsProcessed = debates.length;
        }
        break;

      case 'documents':
        if (data.dokumentlista?.dokument) {
          const documents = Array.isArray(data.dokumentlista.dokument) 
            ? data.dokumentlista.dokument 
            : [data.dokumentlista.dokument];
          
          for (const doc of documents) {
            try {
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
                }, { onConflict: 'dok_id' });
            } catch (error) {
              console.error(`Error inserting document ${doc.dok_id}:`, error);
            }
          }
          recordsProcessed = documents.length;
        }
        break;

      case 'votes':
        if (data.voteringlista?.votering) {
          const votes = Array.isArray(data.voteringlista.votering) 
            ? data.voteringlista.votering 
            : [data.voteringlista.votering];
          
          for (const vote of votes) {
            try {
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
                }, { onConflict: 'votering_id,intressent_id' });
            } catch (error) {
              console.error(`Error inserting vote ${vote.votering_id}:`, error);
            }
          }
          recordsProcessed = votes.length;
        }
        break;
    }
  } catch (error) {
    console.error(`Error processing ${syncType} data:`, error);
    throw error;
  }

  return recordsProcessed;
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

    const { syncType, batchSize = 50, filters = {}, preview = false, strategicPlan = false } = await req.json()

    if (!syncType) {
      throw new Error('syncType is required')
    }

    // Log start of sync
    const { data: logEntry } = await supabaseClient
      .from('api_sync_log')
      .insert({
        sync_type: strategicPlan ? 'strategic_plan' : syncType,
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single()

    const logId = logEntry?.id

    try {
      if (strategicPlan) {
        // Execute strategic plan for all phases
        const phases = Object.entries(API_CONFIG.phases)
          .sort(([,a], [,b]) => a.priority - b.priority);
        
        let totalProcessed = 0;
        const results = [];

        for (const [phaseType] of phases) {
          console.log(`Starting strategic phase: ${phaseType}`);
          
          const { data: syncState } = await supabaseClient
            .from('sync_state')
            .select('*')
            .eq('sync_type', phaseType)
            .single();

          if (syncState?.is_complete) {
            console.log(`Phase ${phaseType} already complete, skipping`);
            continue;
          }

          const currentOffset = syncState?.last_offset || 0;
          const optimalBatchSize = getOptimalBatchSize(phaseType, 3000, syncState?.retry_count || 0);
          
          const apiUrl = buildApiUrl(phaseType, filters, currentOffset, optimalBatchSize);
          const startTime = Date.now();
          
          const result = await makeRiksdagRequest(apiUrl);
          const responseTime = Date.now() - startTime;
          
          if (!result.isEmpty) {
            const processed = await processDataByType(phaseType, result.data, supabaseClient);
            totalProcessed += processed;

            // Update sync state
            await supabaseClient
              .from('sync_state')
              .upsert({
                sync_type: phaseType,
                last_offset: currentOffset + processed,
                total_fetched: (syncState?.total_fetched || 0) + processed,
                last_sync_date: new Date().toISOString(),
                api_endpoint: apiUrl,
                filter_params: filters,
                retry_count: 0,
                is_complete: processed < optimalBatchSize,
                updated_at: new Date().toISOString()
              });

            results.push({
              phase: phaseType,
              processed,
              responseTime,
              batchSize: optimalBatchSize,
              isComplete: processed < optimalBatchSize
            });
          } else {
            await supabaseClient
              .from('sync_state')
              .upsert({
                sync_type: phaseType,
                is_complete: true,
                last_sync_date: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
          }

          // Small delay between phases
          await sleep(1000);
        }

        await supabaseClient
          .from('api_sync_log')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            records_processed: totalProcessed
          })
          .eq('id', logId);

        return new Response(
          JSON.stringify({
            success: true,
            strategicPlan: true,
            totalProcessed,
            results,
            message: `Strategic plan executed successfully. Processed ${totalProcessed} records across ${results.length} phases.`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Single sync type execution
      const { data: syncState } = await supabaseClient
        .from('sync_state')
        .select('*')
        .eq('sync_type', syncType)
        .single()

      const currentOffset = syncState?.last_offset || 0;
      const optimalBatchSize = preview ? batchSize : getOptimalBatchSize(
        syncType, 
        3000, 
        syncState?.retry_count || 0
      );
      
      const apiUrl = buildApiUrl(syncType, filters, currentOffset, optimalBatchSize);
      console.log(`Built API URL: ${apiUrl}`);

      if (preview) {
        return new Response(
          JSON.stringify({
            success: true,
            preview: true,
            apiUrl,
            estimatedBatch: optimalBatchSize,
            currentOffset,
            filters,
            phaseInfo: API_CONFIG.phases[syncType] || null
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const startTime = Date.now();
      const result = await makeRiksdagRequest(apiUrl);
      const responseTime = Date.now() - startTime;
      
      if (result.isEmpty) {
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

      const recordsProcessed = await processDataByType(syncType, result.data, supabaseClient);

      // Update sync state with performance metrics
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
          is_complete: recordsProcessed < optimalBatchSize,
          updated_at: new Date().toISOString()
        })

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
          isComplete: recordsProcessed < optimalBatchSize,
          responseTime,
          optimalBatchSize,
          apiUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )

    } catch (error) {
      console.error('Sync error:', error)
      
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

      const { data: currentSyncState } = await supabaseClient
        .from('sync_state')
        .select('*')
        .eq('sync_type', syncType)
        .single();

      await supabaseClient
        .from('sync_state')
        .upsert({
          sync_type: syncType,
          last_error: error.message,
          retry_count: (currentSyncState?.retry_count || 0) + 1,
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
