import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Play, 
  Square, 
  RefreshCw, 
  Database, 
  Users, 
  FileText, 
  MessageSquare, 
  Vote,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RotateCcw,
  ArrowRight
} from "lucide-react";

export const AdminPanel = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentSync, setCurrentSync] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryAbortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Cleanup function för att avbryta alla pågående operationer
  const cleanupAllOperations = () => {
    console.log('Cleaning up all operations...');
    
    // Avbryt Edge Function-anrop
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Avbryt Supabase-queries
    if (queryAbortControllerRef.current) {
      queryAbortControllerRef.current.abort();
      queryAbortControllerRef.current = null;
    }
    
    // Avbryt alla pågående queries
    queryClient.cancelQueries();
    
    setIsRunning(false);
    setCurrentSync(null);
  };

  // Cleanup vid component unmount
  useEffect(() => {
    return () => {
      cleanupAllOperations();
    };
  }, []);

  // Fetch admin stats med abort signal
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async ({ signal }) => {
      console.log('Fetching admin stats...');
      
      const [membersResult, debatesResult, documentsResult, votesResult] = await Promise.all([
        supabase.from('ledamoter').select('*', { count: 'exact' }).abortSignal(signal),
        supabase.from('anforanden').select('*', { count: 'exact' }).abortSignal(signal),
        supabase.from('dokument').select('*', { count: 'exact' }).abortSignal(signal),
        supabase.from('voteringar').select('*', { count: 'exact' }).abortSignal(signal)
      ]);

      return {
        members: membersResult.count || 0,
        debates: debatesResult.count || 0,
        documents: documentsResult.count || 0,
        votes: votesResult.count || 0
      };
    },
    refetchInterval: isRunning ? 5000 : false,
    retry: false
  });

  // Fetch sync state med abort signal
  const { data: syncStates } = useQuery({
    queryKey: ['sync-states'],
    queryFn: async ({ signal }) => {
      console.log('Fetching sync states...');
      const { data } = await supabase
        .from('sync_state')
        .select('*')
        .abortSignal(signal);
      return data || [];
    },
    refetchInterval: 5000,
    retry: false
  });

  // Fetch sync logs med abort signal
  const { data: syncLogs, refetch: refetchLogs } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: async ({ signal }) => {
      console.log('Fetching sync logs...');
      const { data } = await supabase
        .from('api_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10)
        .abortSignal(signal);
      return data || [];
    },
    refetchInterval: isRunning ? 3000 : false,
    retry: false
  });

  // Fetch real-time sync progress med abort signal
  const { data: syncProgress } = useQuery({
    queryKey: ['sync-progress'],
    queryFn: async ({ signal }) => {
      console.log('Fetching sync progress...');
      const { data } = await supabase
        .from('sync_progress')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .abortSignal(signal)
        .maybeSingle();
      return data;
    },
    refetchInterval: isRunning ? 2000 : false,
    retry: false
  });

  const getSyncState = (syncType: string) => {
    return syncStates?.find(state => state.sync_type === syncType);
  };

  const startBatchSync = async (syncType: string) => {
    try {
      // Avbryt alla tidigare operationer först
      cleanupAllOperations();
      
      setIsRunning(true);
      setCurrentSync(syncType);
      
      // Skapa ny AbortController för denna operation
      abortControllerRef.current = new AbortController();
      queryAbortControllerRef.current = new AbortController();
      
      console.log(`Starting batch sync for ${syncType} with proper abort handling...`);
      
      // Anropa Edge Function med timeout och abort signal
      const timeoutId = setTimeout(() => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          console.log('Operation timed out after 5 minutes');
        }
      }, 300000); // 5 minuter timeout

      const { data, error } = await supabase.functions.invoke('riksdag-api-sync', {
        body: { 
          syncType,
          batchSize: 50
        }
      });

      clearTimeout(timeoutId);

      if (error) {
        console.error('Batch sync error:', error);
        toast({
          title: "Batch-synkroniseringsfel",
          description: `Ett fel inträffade vid hämtning av ${syncType}: ${error.message}`,
          variant: "destructive",
        });
      } else {
        console.log('Batch sync completed successfully:', data);
        toast({
          title: "Batch hämtad",
          description: `Hämtade ${data.recordsProcessed} poster för ${syncType}.`,
        });
      }
      
      // Invalidera queries för att uppdatera UI
      await queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['sync-states'] });
      await refetchLogs();
      
    } catch (error: any) {
      console.error('Batch sync error:', error);
      
      if (error.name === 'AbortError') {
        toast({
          title: "Batch-synkronisering avbruten",
          description: `${syncType} hämtning avbröts.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Batch-synkroniseringsfel",
          description: `Ett oväntat fel inträffade: ${error.message}`,
          variant: "destructive",
        });
      }
    } finally {
      setIsRunning(false);
      setCurrentSync(null);
      abortControllerRef.current = null;
      queryAbortControllerRef.current = null;
    }
  };

  const resetSyncState = async (syncType: string) => {
    try {
      console.log(`Resetting sync state for ${syncType}...`);
      
      const { error } = await supabase
        .from('sync_state')
        .update({ 
          last_offset: 0, 
          total_fetched: 0, 
          is_complete: false,
          updated_at: new Date().toISOString()
        })
        .eq('sync_type', syncType);

      if (error) {
        console.error('Reset error:', error);
        toast({
          title: "Fel vid återställning",
          description: "Kunde inte återställa synkroniseringsstatus.",
          variant: "destructive",
        });
      } else {
        console.log(`Successfully reset sync state for ${syncType}`);
        toast({
          title: "Återställt",
          description: `Synkroniseringsstatus för ${syncType} har återställts.`,
        });
        await queryClient.invalidateQueries({ queryKey: ['sync-states'] });
      }
    } catch (error) {
      console.error('Reset error:', error);
      toast({
        title: "Fel vid återställning",
        description: "Ett oväntat fel inträffade vid återställning.",
        variant: "destructive",
      });
    }
  };

  const abortSync = () => {
    console.log('User requested sync abort...');
    cleanupAllOperations();
    toast({
      title: "Avbryter batch-hämtning",
      description: "Alla pågående operationer avbryts...",
    });
  };

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

  const formatDuration = (started: string, completed?: string) => {
    const start = new Date(started);
    const end = completed ? new Date(completed) : new Date();
    const duration = Math.round((end.getTime() - start.getTime()) / 1000);
    
    if (duration < 60) return `${duration}s`;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}m ${seconds}s`;
  };

  return (
    <div className="space-y-6">
      {/* Emergency stop button */}
      {isRunning && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              Pågående operation - Nödstopp tillgänglig
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              variant="destructive" 
              onClick={abortSync}
              className="w-full"
            >
              <Square className="h-4 w-4 mr-2" />
              AVBRYT ALLA OPERATIONER
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Batch-kontroller */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { type: 'members', icon: Users, title: 'Ledamöter', count: stats?.members },
          { type: 'debates', icon: MessageSquare, title: 'Anföranden', count: stats?.debates },
          { type: 'documents', icon: FileText, title: 'Dokument', count: stats?.documents },
          { type: 'votes', icon: Vote, title: 'Voteringar', count: stats?.votes }
        ].map(({ type, icon: Icon, title, count }) => {
          const syncState = getSyncState(type);
          return (
            <Card key={type}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {title}
                </CardTitle>
                <div className="space-y-1">
                  <div className="text-2xl font-bold">{count?.toLocaleString() || 0}</div>
                  {syncState && (
                    <div className="text-xs text-gray-500">
                      Hämtade: {syncState.total_fetched} | Offset: {syncState.last_offset}
                      {syncState.is_complete && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Komplett
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    className="flex-1" 
                    onClick={() => startBatchSync(type)}
                    disabled={isRunning}
                  >
                    {isRunning && currentSync === type ? (
                      <>
                        <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                        Hämtar...
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-3 w-3 mr-1" />
                        Nästa 50
                      </>
                    )}
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => resetSyncState(type)}
                    disabled={isRunning}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Avbryt-kontroller */}
      {isRunning && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-orange-600" />
              Pågående batch-hämtning
            </CardTitle>
            <CardDescription>
              Hämtar nästa batch för {currentSync}... Du kan avbryta operationen nedan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {syncProgress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Framsteg</span>
                  <span>{syncProgress.processed_records}/{syncProgress.total_records}</span>
                </div>
                <Progress 
                  value={syncProgress.total_records > 0 ? (syncProgress.processed_records / syncProgress.total_records) * 100 : 0} 
                  className="h-2"
                />
              </div>
            )}
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Square className="h-3 w-3 mr-1" />
                    Avbryt hämtning
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Avbryt batch-hämtning?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Är du säker på att du vill avbryta den pågående batch-hämtningen? 
                      Du kan fortsätta från där du slutade nästa gång.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Avbryt</AlertDialogCancel>
                    <AlertDialogAction onClick={abortSync}>
                      Ja, avbryt hämtning
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Synkroniseringsloggar */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Senaste batch-hämtningar
          </CardTitle>
          <CardDescription>
            Historik över API-hämtningar från Riksdagens öppna data (50 poster åt gången)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {syncLogs?.map((log) => (
              <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {getStatusIcon(log.status || 'unknown')}
                  <div>
                    <div className="font-medium capitalize">{log.sync_type}</div>
                    <div className="text-sm text-gray-500 flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      {new Date(log.started_at || '').toLocaleString('sv-SE')}
                      {log.completed_at && (
                        <span className="ml-2">
                          ({formatDuration(log.started_at || '', log.completed_at)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={log.status === 'completed' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}>
                    {log.status === 'completed' ? 'Slutförd' : 
                     log.status === 'failed' ? 'Misslyckad' : 
                     log.status === 'running' ? 'Pågår' : 'Okänd'}
                  </Badge>
                  {log.records_processed !== null && (
                    <span className="text-sm text-gray-500">
                      {log.records_processed.toLocaleString()} poster
                    </span>
                  )}
                </div>
              </div>
            ))}
            {!syncLogs?.length && (
              <div className="text-center py-8 text-gray-500">
                <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>Inga batch-hämtningar genomförda ännu</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
