
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

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async fetchWithRetry(url: string, maxRetries = 3, delay = 1000): Promise<Response> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Fetching: ${url} (attempt ${i + 1}/${maxRetries})`);
        const response = await fetch(url);
        
        if (response.status === 429) {
          console.log('Rate limited, waiting before retry...');
          await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
          continue;
        }
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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

  async syncLedamoter(config: SyncConfig): Promise<number> {
    console.log('Starting ledamöter sync...');
    const url = `${this.baseUrl}/personlista/?format=json&rdlstatus=tjanstgorande`;
    
    const response = await this.fetchWithRetry(url);
    const data: ApiResponse = await response.json();
    
    const personer = data.personlista?.person || [];
    console.log(`Processing ${personer.length} ledamöter`);

    let processed = 0;
    for (const person of personer) {
      try {
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
            bild_url_80: person.bild_url_80,
            bild_url_192: person.bild_url_192,
            status: person.status,
            senast_uppdaterad: new Date().toISOString()
          }, { onConflict: 'iid' });
        
        processed++;
      } catch (error) {
        console.error(`Error processing person ${person.intressent_id}:`, error);
      }
    }

    await this.updateSyncConfig(config.sync_type);
    return processed;
  }

  async syncAnforanden(config: SyncConfig): Promise<number> {
    console.log('Starting anföranden sync...');
    
    const fromDate = config.last_sync_date 
      ? new Date(config.last_sync_date).toISOString().split('T')[0]
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 7 days ago default

    const url = `${this.baseUrl}/anforandelista/?format=json&from=${fromDate}&tom=${new Date().toISOString().split('T')[0]}`;
    
    const response = await this.fetchWithRetry(url);
    const data: ApiResponse = await response.json();
    
    const anforanden = data.anforandelista?.anforande || [];
    console.log(`Processing ${anforanden.length} anföranden`);

    let processed = 0;
    for (let i = 0; i < anforanden.length; i += config.max_records_per_batch) {
      const batch = anforanden.slice(i, i + config.max_records_per_batch);
      
      const processedBatch = batch.map(anforande => ({
        anforande_id: anforande.anforande_id,
        intressent_id: anforande.intressent_id,
        talare: anforande.talare,
        parti: anforande.parti,
        anforande: anforande.anforande,
        anforandetyp: anforande.anforandetyp,
        dok_datum: anforande.dok_datum,
        dok_titel: anforande.dok_titel,
        rubrik: anforande.rubrik,
        nummer: anforande.nummer,
        kon: anforande.kon,
        protokoll_url_xml: anforande.protokoll_url_xml,
        relaterat_dokument_url: anforande.relaterat_dokument_url
      }));

      try {
        await this.supabase
          .from('anforanden')
          .upsert(processedBatch, { onConflict: 'anforande_id' });
        
        processed += batch.length;
        console.log(`Processed batch ${Math.floor(i / config.max_records_per_batch) + 1}, total: ${processed}`);
      } catch (error) {
        console.error(`Error processing anföranden batch:`, error);
      }
    }

    await this.updateSyncConfig(config.sync_type);
    return processed;
  }

  async syncVoteringar(config: SyncConfig): Promise<number> {
    console.log('Starting voteringar sync...');
    
    const fromDate = config.last_sync_date 
      ? new Date(config.last_sync_date).toISOString().split('T')[0]
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const url = `${this.baseUrl}/votering/?format=json&from=${fromDate}&tom=${new Date().toISOString().split('T')[0]}`;
    
    const response = await this.fetchWithRetry(url);
    const data: ApiResponse = await response.json();
    
    const voteringar = data.votering?.dokvotering || [];
    console.log(`Processing ${voteringar.length} voteringar`);

    let processed = 0;
    for (const votering of voteringar) {
      try {
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
      } catch (error) {
        console.error(`Error processing votering ${votering.votering_id}:`, error);
      }
    }

    await this.updateSyncConfig(config.sync_type);
    return processed;
  }

  async syncDokument(config: SyncConfig): Promise<number> {
    console.log('Starting dokument sync...');
    
    const fromDate = config.last_sync_date 
      ? new Date(config.last_sync_date).toISOString().split('T')[0]
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const url = `${this.baseUrl}/dokumentlista/?format=json&from=${fromDate}&tom=${new Date().toISOString().split('T')[0]}`;
    
    const response = await this.fetchWithRetry(url);
    const data: ApiResponse = await response.json();
    
    const dokument = data.dokumentlista?.dokument || [];
    console.log(`Processing ${dokument.length} dokument`);

    let processed = 0;
    for (const dok of dokument) {
      try {
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
      } catch (error) {
        console.error(`Error processing dokument ${dok.dok_id}:`, error);
      }
    }

    await this.updateSyncConfig(config.sync_type);
    return processed;
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
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    const syncType = url.searchParams.get('type') || 'all';
    const manual = url.searchParams.get('manual') === 'true';

    console.log(`Starting sync for type: ${syncType}, manual: ${manual}`);

    // Log sync start
    const { data: logEntry } = await supabaseClient
      .from('api_sync_log')
      .insert({ sync_type: syncType, status: 'running' })
      .select()
      .single();

    const apiService = new RiksdagApiService(supabaseClient);
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
          }
          
          results[config.sync_type] = processed;
          totalProcessed += processed;
          console.log(`Completed ${config.sync_type}: ${processed} records`);
        } catch (error) {
          console.error(`Error syncing ${config.sync_type}:`, error);
          results[config.sync_type] = { error: error.message };
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

      return new Response(
        JSON.stringify({
          success: true,
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

      return new Response(
        JSON.stringify({
          success: false,
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
