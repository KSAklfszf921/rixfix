
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  Settings, 
  Play, 
  Pause, 
  RefreshCw, 
  Database, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Activity
} from "lucide-react";

interface SyncConfig {
  id: number;
  sync_type: string;
  enabled: boolean;
  last_sync_date: string | null;
  sync_interval_hours: number;
  max_records_per_batch: number;
}

interface SyncLog {
  id: number;
  sync_type: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  records_processed: number;
  error_message: string | null;
}

export const AdminPanel = () => {
  const [selectedSyncType, setSelectedSyncType] = useState<string>("all");
  const [syncProgress, setSyncProgress] = useState<{[key: string]: number}>({});
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);
  const queryClient = useQueryClient();

  // Fetch sync configurations
  const { data: syncConfigs, isLoading: configsLoading } = useQuery({
    queryKey: ['sync-configs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sync_config')
        .select('*')
        .order('sync_type');
      return data as SyncConfig[];
    }
  });

  // Fetch sync logs with auto-refresh during sync
  const { data: syncLogs, isLoading: logsLoading } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('api_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);
      return data as SyncLog[];
    },
    refetchInterval: isLiveUpdating ? 2000 : false
  });

  // Check for running syncs and enable live updates
  useEffect(() => {
    const hasRunningSyncs = syncLogs?.some(log => log.status === 'running');
    setIsLiveUpdating(!!hasRunningSyncs);
  }, [syncLogs]);

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: async (syncType: string) => {
      setIsLiveUpdating(true);
      
      const response = await supabase.functions.invoke('riksdag-api-sync', {
        body: { type: syncType, manual: true }
      });
      
      if (response.error) {
        throw new Error(response.error.message);
      }
      
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`Synkronisering slutförd! ${data.totalProcessed} poster bearbetade.`);
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
      queryClient.invalidateQueries({ queryKey: ['sync-configs'] });
      setIsLiveUpdating(false);
      setSyncProgress({});
    },
    onError: (error: any) => {
      toast.error(`Synkronisering misslyckades: ${error.message}`);
      setIsLiveUpdating(false);
      setSyncProgress({});
    }
  });

  // Update config mutation
  const updateConfigMutation = useMutation({
    mutationFn: async (config: Partial<SyncConfig> & { id: number }) => {
      const { data, error } = await supabase
        .from('sync_config')
        .update({
          enabled: config.enabled,
          sync_interval_hours: config.sync_interval_hours,
          max_records_per_batch: config.max_records_per_batch,
          updated_at: new Date().toISOString()
        })
        .eq('id', config.id);
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Konfiguration uppdaterad");
      queryClient.invalidateQueries({ queryKey: ['sync-configs'] });
    },
    onError: (error: any) => {
      toast.error(`Fel vid uppdatering: ${error.message}`);
    }
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'running':
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'running':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getCurrentProgress = () => {
    const runningSync = syncLogs?.find(log => log.status === 'running');
    if (!runningSync) return 0;
    
    // Simulate progress based on time elapsed
    const elapsed = Date.now() - new Date(runningSync.started_at).getTime();
    const estimatedDuration = 120000; // 2 minutes estimate
    return Math.min(95, (elapsed / estimatedDuration) * 100);
  };

  if (configsLoading || logsLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p>Laddar adminpanel...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Riksdagens API - Adminpanel
            {isLiveUpdating && (
              <Badge variant="secondary" className="animate-pulse">
                Live uppdatering aktiv
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
      </Card>

      <Tabs defaultValue="sync" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sync">Manuell Synkronisering</TabsTrigger>
          <TabsTrigger value="config">Konfiguration</TabsTrigger>
          <TabsTrigger value="logs">Synkroniseringsloggar</TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5" />
                Starta manuell synkronisering
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Label htmlFor="sync-type">Välj datatyp:</Label>
                <select
                  id="sync-type"
                  value={selectedSyncType}
                  onChange={(e) => setSelectedSyncType(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                  disabled={syncMutation.isPending}
                >
                  <option value="all">Alla datatyper</option>
                  <option value="ledamoter">Ledamöter</option>
                  <option value="anforanden">Anföranden</option>
                  <option value="voteringar">Voteringar</option>
                  <option value="dokument">Dokument</option>
                </select>
              </div>
              
              {syncMutation.isPending && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Synkronisering pågår...</span>
                    <span>{Math.round(getCurrentProgress())}%</span>
                  </div>
                  <Progress value={getCurrentProgress()} className="w-full" />
                </div>
              )}
              
              <Button
                onClick={() => syncMutation.mutate(selectedSyncType)}
                disabled={syncMutation.isPending}
                className="w-full"
              >
                {syncMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Synkroniserar {selectedSyncType}...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Starta synkronisering
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          {syncConfigs?.map((config) => (
            <Card key={config.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="capitalize">{config.sync_type}</span>
                  <Switch
                    checked={config.enabled}
                    onCheckedChange={(enabled) => 
                      updateConfigMutation.mutate({ ...config, enabled })
                    }
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor={`interval-${config.id}`}>Intervall (timmar)</Label>
                    <Input
                      id={`interval-${config.id}`}
                      type="number"
                      value={config.sync_interval_hours}
                      onChange={(e) => {
                        const sync_interval_hours = parseInt(e.target.value);
                        updateConfigMutation.mutate({ ...config, sync_interval_hours });
                      }}
                      onBlur={(e) => {
                        const sync_interval_hours = parseInt(e.target.value);
                        updateConfigMutation.mutate({ ...config, sync_interval_hours });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`batch-${config.id}`}>Max per batch</Label>
                    <Input
                      id={`batch-${config.id}`}
                      type="number"
                      value={config.max_records_per_batch}
                      onChange={(e) => {
                        const max_records_per_batch = parseInt(e.target.value);
                        updateConfigMutation.mutate({ ...config, max_records_per_batch });
                      }}
                      onBlur={(e) => {
                        const max_records_per_batch = parseInt(e.target.value);
                        updateConfigMutation.mutate({ ...config, max_records_per_batch });
                      }}
                    />
                  </div>
                </div>
                {config.last_sync_date && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock className="h-4 w-4" />
                    Senast synkroniserad: {new Date(config.last_sync_date).toLocaleString('sv-SE')}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Senaste synkroniseringar
                {isLiveUpdating && (
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {syncLogs?.map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(log.status)}
                      <div>
                        <p className="font-medium capitalize">{log.sync_type}</p>
                        <p className="text-sm text-gray-600">
                          Startad: {new Date(log.started_at).toLocaleString('sv-SE')}
                        </p>
                        {log.completed_at && (
                          <p className="text-sm text-gray-600">
                            Slutförd: {new Date(log.completed_at).toLocaleString('sv-SE')}
                          </p>
                        )}
                        {log.status === 'running' && (
                          <div className="mt-2">
                            <Progress value={getCurrentProgress()} className="w-32 h-2" />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge className={getStatusColor(log.status)}>
                        {log.status === 'running' ? 'Pågår' : log.status}
                      </Badge>
                      {log.records_processed > 0 && (
                        <p className="text-sm text-gray-600 mt-1">
                          {log.records_processed} poster
                        </p>
                      )}
                      {log.error_message && (
                        <p className="text-sm text-red-600 mt-1 max-w-xs truncate" title={log.error_message}>
                          {log.error_message}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
