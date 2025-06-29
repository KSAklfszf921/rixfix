
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

// Circuit Breaker Configuration
interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: number;
  successCount: number;
}

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  recoveryTimeout: 300000, // 5 minutes
  halfOpenMaxCalls: 3,
  timeout: 60000 // 1 minute request timeout
};

let circuitBreakerState: CircuitBreakerState = {
  state: 'CLOSED',
  failureCount: 0,
  lastFailureTime: 0,
  successCount: 0
};

// Enhanced Retry Configuration
const RETRY_CONFIG = {
  maxRetries: 8,
  baseDelay: 2000,
  maxDelay: 120000, // 2 minutes max delay
  backoffMultiplier: 2,
  jitterMax: 1000,
  networkTimeoutRetries: 3
};

// Rate Limiting (more conservative)
const RATE_LIMIT_CONFIG = {
  requestsPerSecond: 1,
  burstLimit: 2,
  cooldownPeriod: 60000
};

let requestQueue: Array<() => Promise<any>> = [];
let lastRequestTime = 0;
let requestCount = 0;
let rateLimitResetTime = 0;

// Health Check State
let lastHealthCheck = 0;
let isApiHealthy = true;
const HEALTH_CHECK_INTERVAL = 300000; // 5 minutes

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function addJitter(delay: number): number {
  return delay + Math.random() * RETRY_CONFIG.jitterMax;
}

// Circuit Breaker Logic
function canMakeRequest(): boolean {
  const now = Date.now();
  
  switch (circuitBreakerState.state) {
    case 'OPEN':
      if (now - circuitBreakerState.lastFailureTime > CIRCUIT_BREAKER_CONFIG.recoveryTimeout) {
        console.log('Circuit breaker transitioning to HALF_OPEN');
        circuitBreakerState.state = 'HALF_OPEN';
        circuitBreakerState.successCount = 0;
        return true;
      }
      return false;
    
    case 'HALF_OPEN':
      return circuitBreakerState.successCount < CIRCUIT_BREAKER_CONFIG.halfOpenMaxCalls;
    
    case 'CLOSED':
    default:
      return true;
  }
}

function recordSuccess() {
  switch (circuitBreakerState.state) {
    case 'HALF_OPEN':
      circuitBreakerState.successCount++;
      if (circuitBreakerState.successCount >= CIRCUIT_BREAKER_CONFIG.halfOpenMaxCalls) {
        console.log('Circuit breaker CLOSED - API recovered');
        circuitBreakerState.state = 'CLOSED';
        circuitBreakerState.failureCount = 0;
      }
      break;
    
    case 'CLOSED':
      circuitBreakerState.failureCount = Math.max(0, circuitBreakerState.failureCount - 1);
      break;
  }
}

function recordFailure() {
  circuitBreakerState.failureCount++;
  circuitBreakerState.lastFailureTime = Date.now();
  
  if (circuitBreakerState.state === 'CLOSED' && 
      circuitBreakerState.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    console.log(`Circuit breaker OPEN - too many failures (${circuitBreakerState.failureCount})`);
    circuitBreakerState.state = 'OPEN';
  } else if (circuitBreakerState.state === 'HALF_OPEN') {
    console.log('Circuit breaker OPEN again - failure during recovery');
    circuitBreakerState.state = 'OPEN';
  }
}

// Enhanced Health Check
async function performHealthCheck(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return isApiHealthy;
  }
  
  try {
    console.log('Performing API health check...');
    const testUrl = `${API_CONFIG.baseUrl}/personlista/?utformat=json&sz=1`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for health
    
    const response = await fetch(testUrl, {
      method: 'HEAD', // Use HEAD for lighter request
      signal: controller.signal,
      headers: {
        'User-Agent': 'Riksdagskoll-HealthCheck/2.0 (+https://riksdagskoll.se)',
        'Accept': 'application/json',
      }
    });
    
    clearTimeout(timeoutId);
    isApiHealthy = response.ok;
    lastHealthCheck = now;
    
    console.log(`Health check result: ${isApiHealthy ? 'HEALTHY' : 'UNHEALTHY'} (${response.status})`);
    return isApiHealthy;
    
  } catch (error) {
    console.log(`Health check failed: ${error.message}`);
    isApiHealthy = false;
    lastHealthCheck = now;
    return false;
  }
}

// Enhanced Rate Limiting
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
      console.log(`Rate limiting: waiting ${waitTime}ms`);
      await sleep(waitTime);
    }
    requestCount = 0;
  }
  
  lastRequestTime = Date.now();
  requestCount++;
  
  return await requestFn();
}

// Enhanced Request with Timeout and Better Error Handling
async function makeRiksdagRequest(url: string, retryCount = 0): Promise<any> {
  // Check circuit breaker
  if (!canMakeRequest()) {
    throw new Error('CircuitBreakerOpen: API is currently unavailable due to repeated failures');
  }
  
  // Perform health check if needed
  if (!await performHealthCheck()) {
    throw new Error('HealthCheckFailed: API appears to be down');
  }
  
  return await rateLimitedRequest(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log(`Request timeout after ${CIRCUIT_BREAKER_CONFIG.timeout}ms`);
    }, CIRCUIT_BREAKER_CONFIG.timeout);
    
    try {
      console.log(`Making request to: ${url} (attempt ${retryCount + 1})`);
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Riksdagskoll/2.0 (Strategic Data Collection; +https://riksdagskoll.se; contact@riksdagskoll.se)',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : 
            Math.min(
              addJitter(RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount)),
              RETRY_CONFIG.maxDelay
            );
          
          console.log(`Rate limited (429), waiting ${delay}ms before retry`);
          rateLimitResetTime = Date.now() + delay;
          await sleep(delay);
          
          if (retryCount < RETRY_CONFIG.maxRetries) {
            return makeRiksdagRequest(url, retryCount + 1);
          }
          recordFailure();
          throw new Error(`RateLimitExceeded: Rate limited after ${RETRY_CONFIG.maxRetries} retries`);
        }
        
        if (response.status === 413 || response.status === 414) {
          recordFailure();
          throw new Error('ResponseTooLargeError: Query returned too much data. Try reducing batch size or adding more filters.');
        }
        
        if (response.status >= 500 || response.status === 503) {
          console.log(`Server error ${response.status}: ${errorText}`);
          if (retryCount < RETRY_CONFIG.maxRetries) {
            const delay = addJitter(
              Math.min(
                RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
                RETRY_CONFIG.maxDelay
              )
            );
            console.log(`Retrying server error in ${delay}ms...`);
            await sleep(delay);
            return makeRiksdagRequest(url, retryCount + 1);
          }
          recordFailure();
          throw new Error(`ServerError: HTTP ${response.status} after ${RETRY_CONFIG.maxRetries} retries: ${errorText}`);
        }
        
        if (response.status === 404) {
          console.log('Endpoint not found (404) - might be temporary or endpoint changed');
          recordFailure();
          throw new Error(`EndpointNotFound: HTTP 404 - ${url}`);
        }
        
        recordFailure();
        throw new Error(`HTTPError: ${response.status} ${response.statusText}: ${errorText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.log(`Unexpected content type: ${contentType}`);
        recordFailure();
        throw new Error(`InvalidContentType: Expected JSON, got ${contentType}`);
      }

      const data = await response.json();
      
      if (!data || Object.keys(data).length === 0) {
        console.log('Empty response received');
        recordSuccess(); // Empty response is not necessarily a failure
        return { isEmpty: true, data: null };
      }

      const hasData = 
        (data.dokumentlista?.dokument?.length > 0) ||
        (data.personlista?.person?.length > 0) ||
        (data.anforandelista?.anforande?.length > 0) ||
        (data.voteringlista?.votering?.length > 0) ||
        (data.utskottslista?.utskott?.length > 0);

      if (!hasData) {
        console.log('No data found in response');
        recordSuccess(); // No data might be end of pagination
        return { isEmpty: true, data };
      }

      recordSuccess();
      return { isEmpty: false, data };

    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`Request failed:`, error);
      
      // Handle specific error types
      if (error.name === 'AbortError') {
        console.log('Request aborted due to timeout');
        if (retryCount < RETRY_CONFIG.networkTimeoutRetries) {
          const delay = addJitter(RETRY_CONFIG.baseDelay * 2); // Longer delay for timeouts
          console.log(`Retrying timeout in ${delay}ms...`);
          await sleep(delay);
          return makeRiksdagRequest(url, retryCount + 1);
        }
        recordFailure();
        throw new Error(`TimeoutError: Request timed out after ${CIRCUIT_BREAKER_CONFIG.timeout}ms`);
      }
      
      if (error.message.includes('TypeError: error sending request') || 
          error.name === 'TypeError' || 
          error.message.includes('NetworkError')) {
        console.log('Network error detected');
        if (retryCount < RETRY_CONFIG.networkTimeoutRetries) {
          const delay = addJitter(
            Math.min(
              RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
              RETRY_CONFIG.maxDelay
            )
          );
          console.log(`Retrying network error in ${delay}ms...`);
          await sleep(delay);
          return makeRiksdagRequest(url, retryCount + 1);
        }
        recordFailure();
        throw new Error(`NetworkError: ${error.message} after ${RETRY_CONFIG.networkTimeoutRetries} retries`);
      }
      
      // Don't retry certain errors
      if (error.message.includes('CircuitBreakerOpen') ||
          error.message.includes('HealthCheckFailed') ||
          error.message.includes('ResponseTooLargeError')) {
        throw error;
      }
      
      if (retryCount < RETRY_CONFIG.maxRetries) {
        const delay = addJitter(
          Math.min(
            RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
            RETRY_CONFIG.maxDelay
          )
        );
        console.log(`Retrying general error in ${delay}ms...`);
        await sleep(delay);
        return makeRiksdagRequest(url, retryCount + 1);
      }
      
      recordFailure();
      throw error;
    }
  });
}

function getOptimalBatchSize(syncType: string, responseTime: number, errorCount: number): number {
  const config = API_CONFIG.phases[syncType];
  if (!config) return 25; // More conservative default
  
  let batchSize = Math.floor(config.defaultBatchSize * 0.5); // Start with smaller batches
  
  // More conservative adjustments
  if (responseTime > 15000) { // > 15s
    batchSize = Math.max(5, Math.floor(batchSize * 0.3));
  } else if (responseTime > 10000) { // > 10s
    batchSize = Math.max(10, Math.floor(batchSize * 0.5));
  } else if (responseTime > 5000) { // > 5s
    batchSize = Math.max(15, Math.floor(batchSize * 0.7));
  } else if (responseTime < 2000 && errorCount === 0) { // Only increase if no errors
    batchSize = Math.min(config.maxBatchSize, Math.floor(batchSize * 1.1));
  }
  
  // Aggressive reduction on errors
  if (errorCount > 5) {
    batchSize = Math.max(1, Math.floor(batchSize * 0.2));
  } else if (errorCount > 3) {
    batchSize = Math.max(5, Math.floor(batchSize * 0.4));
  } else if (errorCount > 1) {
    batchSize = Math.max(10, Math.floor(batchSize * 0.6));
  }
  
  // Consider circuit breaker state
  if (circuitBreakerState.state === 'HALF_OPEN') {
    batchSize = Math.max(1, Math.floor(batchSize * 0.5));
  }
  
  return Math.max(1, Math.min(config.maxBatchSize, batchSize));
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

    const { syncType, batchSize = 25, filters = {}, preview = false, strategicPlan = false } = await req.json()

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
        // Log circuit breaker state
        console.log(`Starting strategic plan. Circuit breaker state: ${circuitBreakerState.state}`);
        
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
          const errorCount = syncState?.retry_count || 0;
          const optimalBatchSize = getOptimalBatchSize(phaseType, 3000, errorCount);
          
          console.log(`Phase ${phaseType}: offset=${currentOffset}, batchSize=${optimalBatchSize}, errors=${errorCount}`);
          
          const apiUrl = buildApiUrl(phaseType, filters, currentOffset, optimalBatchSize);
          const startTime = Date.now();
          
          try {
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
                  retry_count: 0, // Reset on success
                  last_error: null, // Clear error on success
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

              console.log(`Phase ${phaseType} success: ${processed} records in ${responseTime}ms`);
            } else {
              await supabaseClient
                .from('sync_state')
                .upsert({
                  sync_type: phaseType,
                  is_complete: true,
                  last_sync_date: new Date().toISOString(),
                  retry_count: 0,
                  last_error: null,
                  updated_at: new Date().toISOString()
                });
              
              console.log(`Phase ${phaseType} complete: no more data`);
            }
          } catch (error) {
            console.error(`Phase ${phaseType} failed:`, error.message);
            
            // Update sync state with error
            await supabaseClient
              .from('sync_state')
              .upsert({
                sync_type: phaseType,
                last_error: error.message,
                retry_count: errorCount + 1,
                updated_at: new Date().toISOString()
              });
            
            // Don't fail entire strategic plan on one phase error
            results.push({
              phase: phaseType,
              processed: 0,
              responseTime: Date.now() - startTime,
              batchSize: optimalBatchSize,
              error: error.message,
              isComplete: false
            });
          }

          // Longer delay between phases to be more respectful
          await sleep(3000);
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
            circuitBreakerState: circuitBreakerState.state,
            message: `Strategic plan executed. Processed ${totalProcessed} records across ${results.length} phases. Circuit breaker: ${circuitBreakerState.state}`
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
      const errorCount = syncState?.retry_count || 0;
      const optimalBatchSize = preview ? batchSize : getOptimalBatchSize(
        syncType, 
        3000, 
        errorCount
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
            circuitBreakerState: circuitBreakerState.state,
            isApiHealthy,
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
            retry_count: 0,
            last_error: null,
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
            isComplete: true,
            circuitBreakerState: circuitBreakerState.state
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
          retry_count: 0, // Reset on success
          last_error: null, // Clear error on success
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
          circuitBreakerState: circuitBreakerState.state,
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
      JSON.stringify({ 
        error: error.message,
        circuitBreakerState: circuitBreakerState.state,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
