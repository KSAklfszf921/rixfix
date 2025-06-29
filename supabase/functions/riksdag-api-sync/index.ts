
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SyncConfig {
  sync_type: string;
  enabled: boolean;
  last_sync_date: string | null;
  sync_interval_hours: number;
  max_records_per_batch: number;
}

interface ApiResponse {
  dokumentlista?: {
    dokument?: any[];
  };
  personlista?: {
    person?: any[];
  };
  anforandelista?: {
    anforande?: any[];
  };
  votering?: {
    dokvotering?: any[];
  };
}

class RiksdagApiService {
  private baseUrl = 'https://data.riksdagen.se';
  private supabase: any;
  private sessionId: string;

  constructor(supabaseClient: any, sessionId: string) {
    this.supabase = supabaseClient;
    this.sessionId = sessionId;
  }

  async fetchWithRetry(url: string, maxRetries = 3, delay = 2000): Promise<Response> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Fetching: ${url} (attempt ${i + 1}/${maxRetries})`);
        
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Riksdagskoll/1.0 (https://riksdagskoll.se)'
          }
        });
        
        if (response.status === 429) {
          console.log('Rate limited, waiting before retry...');
          await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
          continue;
        }
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.log(`Warning: Response content-type is ${contentType}, expected JSON`);
        }
        
        return response;
      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error);
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
    throw new Error('Max retries exceeded');
  }

  async updateProgress(syncType: string, totalRecords: number, processedRecords: number, failedRecords: number, status: string) {
    try {
      await this.supabase
        .from('sync_progress')
        .upsert({
          sync_session_id: this.sessionId,
          sync_type: syncType,
          total_records: totalRecords,
          processed_records: processedRecords,
          failed_records: failedRecords,
          current_status: status,
          updated_at: new Date().toISOString()
        }, { onConflict: 'sync_session_id,sync_type' });
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  }

  async syncLedamoter(config: SyncConfig): Promise<number> {
    console.log('Starting ledamöter sync...');
    const url = `${this.baseUrl}/personlista/?utformat=json&rdlstatus=tjanstgorande`;
    
    try {
      const response = await this.fetchWithRetry(url);
      const data: ApiResponse = await response.json();
      
      const personer = data.personlista?.person || [];
      console.log(`Found ${personer.length} ledamöter to process`);

      await this.updateProgress('ledamoter', personer.length, 0, 0, 'processing');

      let processed = 0;
      let failed = 0;

      for (const person of personer) {
        try {
          console.log(`Processing ledamot ${processed + 1}/${personer.length}: ${person.tilltalsnamn} ${person.efternamn}`);
          
          // Process main ledamot record
          await this.supabase
            .from('ledamoter')
            .upsert({
              iid: person.intressent_id,
              tilltalsnamn: person.tilltalsnamn,
              efternamn: person.efternamn,
              parti: person.parti,
              valkrets: person.valkrets,
              kon: person.kon,
              fodd_ar: person.fodd_ar ? parseInt(person.fodd_ar) : null,
              bild_url: person.bild_url_192 || person.bild_url_80,
              status: person.status,
              webbplats_url: person.webbplats_url,
              biografi_url: person.biografi_url,
              senast_uppdaterad: new Date().toISOString()
            }, { onConflict: 'iid' });

          // Process uppdrag if available
          if (person.personuppdrag?.uppdrag) {
            const uppdragList = Array.isArray(person.personuppdrag.uppdrag) 
              ? person.personuppdrag.uppdrag 
              : [person.personuppdrag.uppdrag];
            
            for (const uppdrag of uppdragList) {
              await this.supabase
                .from('uppdrag')
                .upsert({
                  iid: person.intressent_id,
                  typ: uppdrag.typ,
                  organ: uppdrag.organ,
                  roll: uppdrag.roll_kod,
                  status: uppdrag.status,
                  from_datum: uppdrag.from ? uppdrag.from : null,
                  tom_datum: uppdrag.tom ? uppdrag.tom : null
                }, { onConflict: 'iid,typ,organ,roll' });
            }
          }

          processed++;
          
          // Update progress every 5 records
          if (processed % 5 === 0) {
            await this.updateProgress('ledamoter', personer.length, processed, failed, 'processing');
          }
          
        } catch (error) {
          console.error(`Error processing ledamot ${person.intressent_id}:`, error);
          failed++;
        }
      }

      await this.updateProgress('ledamoter', personer.length, processed, failed, 'completed');
      await this.updateSyncConfig(config.sync_type);
      
      console.log(`Ledamöter sync completed: ${processed} processed, ${failed} failed`);
      return processed;
      
    } catch (error) {
      console.error('Ledamöter sync failed:', error);
      await this.updateProgress('ledamoter', 0, 0, 0, 'failed');
      throw error;
    }
  }

  async syncAnforanden(config: SyncConfig): Promise<number> {
    console.log('Starting anföranden sync...');
    
    const fromDate = config.last_sync_date 
      ? new Date(config.last_sync_date).toISOString().split('T')[0]
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const url = `${this.baseUrl}/anforandelista/?utformat=json&from=${fromDate}&tom=${new Date().toISOString().split('T')[0]}`;
    
    try {
      const response = await this.fetchWithRetry(url);
      const data: ApiResponse = await response.json();
      
      const anforanden = data.anforandelista?.anforande || [];
      console.log(`Found ${anforanden.length} anföranden to process`);

      await this.updateProgress('anforanden', anforanden.length, 0, 0, 'processing');

      let processed = 0;
      let failed = 0;

      for (const anforande of anforanden) {
        try {
          console.log(`Processing anförande ${processed + 1}/${anforanden.length}: ${anforande.anforande_id}`);
          
          await this.supabase
            .from('anforanden')
            .upsert({
              anforande_id: anforande.anforande_id,
              intressent_id: anforande.intressent_id,
              talare: anforande.talare,
              parti: anforande.parti,
              text: anforande.anforande,
              anforandetyp: anforande.anforandetyp,
              datum: anforande.dok_datum,
              dok_titel: anforande.dok_titel,
              rubrik: anforande.rubrik,
              nummer: anforande.nummer,
              kon: anforande.kon,
              protokoll_url_xml: anforande.protokoll_url_xml,
              relaterat_dokument_url: anforande.relaterat_dokument_url
            }, { onConflict: 'anforande_id' });

          processed++;
          
          // Update progress every 10 records
          if (processed % 10 === 0) {
            await this.updateProgress('anforanden', anforanden.length, processed, failed, 'processing');
          }
          
        } catch (error) {
          console.error(`Error processing anförande ${anforande.anforande_id}:`, error);
          failed++;
        }
      }

      await this.updateProgress('anforanden', anforanden.length, processed, failed, 'completed');
      await this.updateSyncConfig(config.sync_type);
      
      console.log(`Anföranden sync completed: ${processed} processed, ${failed} failed`);
      return processed;
      
    } catch (error) {
      console.error('Anföranden sync failed:', error);
      await this.updateProgress('anforanden', 0, 0, 0, 'failed');
      throw error;
    }
  }

  async syncVoteringar(config: SyncConfig): Promise<number> {
    console.log('Starting voteringar sync...');
    
    const fromDate = config.last_sync_date 
      ? new Date(config.last_sync_date).toISOString().split('T')[0]
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const url = `${this.baseUrl}/votering/?utformat=json&from=${fromDate}&tom=${new Date().toISOString().split('T')[0]}`;
    
    try {
      const response = await this.fetchWithRetry(url);
      const data: ApiResponse = await response.json();
      
      const voteringar = data.votering?.dokvotering || [];
      console.log(`Found ${voteringar.length} voteringar to process`);

      await this.updateProgress('voteringar', voteringar.length, 0, 0, 'processing');

      let processed = 0;
      let failed = 0;

      for (const votering of voteringar) {
        try {
          console.log(`Processing votering ${processed + 1}/${voteringar.length}: ${votering.votering_id}`);
          
          await this.supabase
            .from('voteringar')
            .upsert({
              votering_id: votering.votering_id,
              intressent_id: votering.intressent_id,
              namn: votering.namn,
              parti: votering.parti,
              valkrets: votering.valkrets,
              rost: votering.rost,
              avser: votering.avser,
              votering_datum: votering.votering_datum,
              dok_id: votering.dok_id
            }, { onConflict: 'votering_id,intressent_id' });

          processed++;
          
          // Update progress every 20 records
          if (processed % 20 === 0) {
            await this.updateProgress('voteringar', voteringar.length, processed, failed, 'processing');
          }
          
        } catch (error) {
          console.error(`Error processing votering ${votering.votering_id}:`, error);
          failed++;
        }
      }

      await this.updateProgress('voteringar', voteringar.length, processed, failed, 'completed');
      await this.updateSyncConfig(config.sync_type);
      
      console.log(`Voteringar sync completed: ${processed} processed, ${failed} failed`);
      return processed;
      
    } catch (error) {
      console.error('Voteringar sync failed:', error);
      await this.updateProgress('voteringar', 0, 0, 0, 'failed');
      throw error;
    }
  }

  async syncDokument(config: SyncConfig): Promise<number> {
    console.log('Starting dokument sync...');
    
    const fromDate = config.last_sync_date 
      ? new Date(config.last_sync_date).toISOString().split('T')[0]
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const url = `${this.baseUrl}/dokumentlista/?utformat=json&from=${fromDate}&tom=${new Date().toISOString().split('T')[0]}`;
    
    try {
      const response = await this.fetchWithRetry(url);
      const data: ApiResponse = await response.json();
      
      const dokument = data.dokumentlista?.dokument || [];
      console.log(`Found ${dokument.length} dokument to process`);

      await this.updateProgress('dokument', dokument.length, 0, 0, 'processing');

      let processed = 0;
      let failed = 0;

      for (const dok of dokument) {
        try {
          console.log(`Processing dokument ${processed + 1}/${dokument.length}: ${dok.dok_id}`);
          
          await this.supabase
            .from('dokument')
            .upsert({
              dok_id: dok.dok_id,
              titel: dok.titel,
              doktyp: dok.doktyp,
              status: dok.status,
              datum: dok.datum,
              organ: dok.organ,
              rm: dok.rm,
              hangar_id: dok.hangar_id,
              relaterat_id: dok.relaterat_id,
              dokument_url_html: dok.dokument_url_html,
              dokument_url_pdf: dok.dokument_url_pdf,
              dokument_url_text: dok.dokument_url_text
            }, { onConflict: 'dok_id' });

          processed++;
          
          // Update progress every 15 records
          if (processed % 15 === 0) {
            await this.updateProgress('dokument', dokument.length, processed, failed, 'processing');
          }
          
        } catch (error) {
          console.error(`Error processing dokument ${dok.dok_id}:`, error);
          failed++;
        }
      }

      await this.updateProgress('dokument', dokument.length, processed, failed, 'completed');
      await this.updateSyncConfig(config.sync_type);
      
      console.log(`Dokument sync completed: ${processed} processed, ${failed} failed`);
      return processed;
      
    } catch (error) {
      console.error('Dokument sync failed:', error);
      await this.updateProgress('dokument', 0, 0, 0, 'failed');
      throw error;
    }
  }

  private async updateSyncConfig(syncType: string) {
    await this.supabase
      .from('sync_config')
      .update({ 
        last_sync_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('sync_type', syncType);
  }

  async refreshMaterializedViews() {
    console.log('Refreshing materialized views...');
    try {
      await this.supabase.rpc('refresh_materialized_views');
      console.log('Materialized views refreshed successfully');
    } catch (error) {
      console.error('Error refreshing materialized views:', error);
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { type: syncType = 'all', manual = false } = await req.json().catch(() => ({}));
    const sessionId = crypto.randomUUID();

    console.log(`Starting sync session ${sessionId} for type: ${syncType}, manual: ${manual}`);

    // Log sync start
    const { data: logEntry } = await supabaseClient
      .from('api_sync_log')
      .insert({ sync_type: syncType, status: 'running' })
      .select()
      .single();

    const apiService = new RiksdagApiService(supabaseClient, sessionId);
    let totalProcessed = 0;
    const results: any = {};

    try {
      // Get sync configurations
      const { data: configs } = await supabaseClient
        .from('sync_config')
        .select('*')
        .eq('enabled', true);

      if (!configs) {
        throw new Error('No sync configurations found');
      }

      const activeConfigs = manual 
        ? configs 
        : configs.filter(config => {
            if (!config.last_sync_date) return true;
            const hoursSinceLastSync = (Date.now() - new Date(config.last_sync_date).getTime()) / (1000 * 60 * 60);
            return hoursSinceLastSync >= config.sync_interval_hours;
          });

      console.log(`Found ${activeConfigs.length} configurations to sync`);

      for (const config of activeConfigs) {
        if (syncType !== 'all' && config.sync_type !== syncType) continue;

        try {
          let processed = 0;
          console.log(`\n=== Starting ${config.sync_type} sync ===`);
          
          switch (config.sync_type) {
            case 'ledamoter':
              processed = await apiService.syncLedamoter(config);
              break;
            case 'anforanden':
              processed = await apiService.syncAnforanden(config);
              break;
            case 'voteringar':
              processed = await apiService.syncVoteringar(config);
              break;
            case 'dokument':
              processed = await apiService.syncDokument(config);
              break;
            default:
              console.log(`Unknown sync type: ${config.sync_type}`);
              continue;
          }
          
          results[config.sync_type] = { 
            processed,
            status: 'completed'
          };
          totalProcessed += processed;
          console.log(`=== Completed ${config.sync_type}: ${processed} records ===\n`);
          
        } catch (error) {
          console.error(`Error syncing ${config.sync_type}:`, error);
          results[config.sync_type] = { 
            error: error.message,
            status: 'failed'
          };
        }
      }

      // Refresh materialized views after successful sync
      if (totalProcessed > 0) {
        await apiService.refreshMaterializedViews();
      }

      // Update sync log
      await supabaseClient
        .from('api_sync_log')
        .update({
          completed_at: new Date().toISOString(),
          status: 'completed',
          records_processed: totalProcessed
        })
        .eq('id', logEntry.id);

      console.log(`Sync session ${sessionId} completed successfully`);

      return new Response(
        JSON.stringify({
          success: true,
          sessionId,
          totalProcessed,
          results,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );

    } catch (error) {
      console.error('Sync error:', error);
      
      // Update sync log with error
      await supabaseClient
        .from('api_sync_log')
        .update({
          completed_at: new Date().toISOString(),
          status: 'failed',
          error_message: error.message,
          records_processed: totalProcessed
        })
        .eq('id', logEntry.id);

      console.log(`Sync session ${sessionId} failed`);

      return new Response(
        JSON.stringify({
          success: false,
          sessionId,
          error: error.message,
          totalProcessed,
          results,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

  } catch (error) {
    console.error('Request error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
