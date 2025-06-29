
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
  RefreshCw, 
  Database, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Activity,
  Users,
  FileText,
  Vote,
  BookOpen
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

interface SyncProgress {
  sync_session_id: string;
  sync_type: string;
  total_records: number;
  processed_records: number;
  failed_records: number;
  current_status: string;
  updated_at: string;
}

export const AdminPanel = () => {
  const [selectedSyncType, setSelectedSyncType] = useState<string>("all");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
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

  // Fetch sync logs
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
    refetchInterval: 3000
  });

  // Fetch real-time sync progress
  const { data: syncProgress } = useQuery({
    queryKey: ['sync-progress', currentSessionId],
    queryFn: async () => {
      if (!currentSessionId) return [];
      const { data } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('sync_session_id', currentSessionId)
        .order('updated_at', { ascending: false });
      return data as SyncProgress[];
    },
    enabled: !!currentSessionId,
    refetchInterval: 1000
  });

  // Check for running syncs
  const hasRunningSyncs = syncLogs?.some(log => log.status === 'running');

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: async (syncType: string) => {
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
      setCurrentSessionId(data.sessionId);
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
      queryClient.invalidateQueries({ queryKey: ['sync-configs'] });
    },
    onError: (error: any) => {
      toast.error(`Synkronisering misslyckades: ${error.message}`);
      setCurrentSessionId(null);
    },
    onSettled: () => {
      // Clear session after a delay to show final results
      setTimeout(() => setCurrentSessionId(null), 10000);
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

  const getSyncTypeIcon = (syncType: string) => {
    switch (syncType) {
      case 'ledamoter':
        return <Users className="h-4 w-4" />;
      case 'anforanden':
        return <FileText className="h-4 w-4" />;
      case 'voteringar':
        return <Vote className="h-4 w-4" />;
      case 'dokument':
        return <BookOpen className="h-4 w-4" />;
      default:
        return <Database className="h-4 w-4" />;
    }
  };

  const getProgressPercentage = (progress: SyncProgress) => {
    if (progress.total_records === 0) return 0;
    return Math.round((progress.processed_records / progress.total_records) * 100);
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
            {hasRunningSyncs && (
              <Badge variant="secondary" className="animate-pulse">
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                Synkronisering pågår
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
      </Card>

      <Tabs defaultValue="sync" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="sync">Manuell Synkronisering</TabsTrigger>
          <TabsTrigger value="progress">Live Progress</TabsTrigger>
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
              
              <Button
                onClick={() => syncMutation.mutate(selectedSyncType)}
                disabled={syncMutation.isPending || hasRunningSyncs}
                className="w-full"
              >
                {syncMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Startar synkronisering...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Starta synkronisering
                  </>
                )}
              </Button>

              {syncMutation.isPending && (
                <div className="text-sm text-gray-600">
                  <p>Synkronisering har startats. Gå till "Live Progress" för att följa framstegen.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="progress" className="space-y-4">
          {syncProgress && syncProgress.length > 0 ? (
            <div className="space-y-4">
              {syncProgress.map((progress) => (
                <Card key={progress.sync_type}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getSyncTypeIcon(progress.sync_type)}
                        <span className="capitalize">{progress.sync_type}</span>
                      </div>
                      <Badge className={getStatusColor(progress.current_status)}>
                        {progress.current_status}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Framsteg: {progress.processed_records} / {progress.total_records}</span>
                        <span>{getProgressPercentage(progress)}%</span>
                      </div>
                      <Progress value={getProgressPercentage(progress)} className="w-full" />
                      {progress.failed_records > 0 && (
                        <p className="text-sm text-red-600">
                          {progress.failed_records} poster misslyckades
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      Senast uppdaterad: {new Date(progress.updated_at).toLocaleString('sv-SE')}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <Activity className="h-8 w-8 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600">Ingen aktiv synkronisering pågår</p>
                <p className="text-sm text-gray-500 mt-2">
                  Starta en synkronisering för att se framstegen här
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          {syncConfigs?.map((config) => (
            <Card key={config.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getSyncTypeIcon(config.sync_type)}
                    <span className="capitalize">{config.sync_type}</span>
                  </div>
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
                        if (sync_interval_hours > 0) {
                          updateConfigMutation.mutate({ ...config, sync_interval_hours });
                        }
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
                        if (max_records_per_batch > 0) {
                          updateConfigMutation.mutate({ ...config, max_records_per_batch });
                        }
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
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {syncLogs?.map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(log.status)}
                      <div>
                        <div className="flex items-center gap-2">
                          {getSyncTypeIcon(log.sync_type)}
                          <p className="font-medium capitalize">{log.sync_type}</p>
                        </div>
                        <p className="text-sm text-gray-600">
                          Startad: {new Date(log.started_at).toLocaleString('sv-SE')}
                        </p>
                        {log.completed_at && (
                          <p className="text-sm text-gray-600">
                            Slutförd: {new Date(log.completed_at).toLocaleString('sv-SE')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge className={getStatusColor(log.status)}>
                        {log.status === 'running' ? 'Pågår' : 
                         log.status === 'completed' ? 'Klar' : 
                         log.status === 'failed' ? 'Misslyckad' : log.status}
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
