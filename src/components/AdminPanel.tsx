import { useState, useRef } from "react";
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
  AlertCircle
} from "lucide-react";

export const AdminPanel = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentSync, setCurrentSync] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch admin stats
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async ({ signal }) => {
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
    refetchInterval: isRunning ? 5000 : false
  });

  // Fetch sync logs
  const { data: syncLogs, refetch: refetchLogs } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: async ({ signal }) => {
      const { data } = await supabase
        .from('api_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10)
        .abortSignal(signal);
      return data || [];
    },
    refetchInterval: isRunning ? 3000 : false
  });

  // Fetch real-time sync progress
  const { data: syncProgress } = useQuery({
    queryKey: ['sync-progress'],
    queryFn: async ({ signal }) => {
      const { data } = await supabase
        .from('sync_progress')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .abortSignal(signal)
        .single();
      return data;
    },
    refetchInterval: isRunning ? 2000 : false
  });

  const startSync = async (syncType: string) => {
    try {
      setIsRunning(true);
      setCurrentSync(syncType);
      
      // Create new AbortController for this sync operation
      abortControllerRef.current = new AbortController();
      
      console.log(`Starting ${syncType} sync...`);
      
      const { data, error } = await supabase.functions.invoke('riksdag-api-sync', {
        body: { 
          syncType,
          signal: abortControllerRef.current.signal 
        }
      });

      if (error) {
        console.error('Sync error:', error);
        toast({
          title: "Synkroniseringsfel",
          description: `Ett fel inträffade vid synkronisering av ${syncType}: ${error.message}`,
          variant: "destructive",
        });
      } else {
        console.log('Sync completed:', data);
        toast({
          title: "Synkronisering slutförd",
          description: `${syncType} synkronisering slutförd framgångsrikt.`,
        });
      }
      
      await queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      await refetchLogs();
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast({
          title: "Synkronisering avbruten",
          description: `${syncType} synkronisering avbröts av användaren.`,
          variant: "destructive",
        });
      } else {
        console.error('Sync error:', error);
        toast({
          title: "Synkroniseringsfel",
          description: `Ett oväntat fel inträffade: ${error.message}`,
          variant: "destructive",
        });
      }
    } finally {
      setIsRunning(false);
      setCurrentSync(null);
      abortControllerRef.current = null;
    }
  };

  const abortSync = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      toast({
        title: "Avbryter synkronisering",
        description: "Synkroniseringen avbryts...",
      });
    }
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
      {/* Huvudkontroller */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Ledamöter
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-2xl font-bold">{stats?.members?.toLocaleString() || 0}</div>
            <Button 
              size="sm" 
              className="w-full" 
              onClick={() => startSync('members')}
              disabled={isRunning}
            >
              {isRunning && currentSync === 'members' ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                  Synkar...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Synka
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Anföranden
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-2xl font-bold">{stats?.debates?.toLocaleString() || 0}</div>
            <Button 
              size="sm" 
              className="w-full" 
              onClick={() => startSync('debates')}
              disabled={isRunning}
            >
              {isRunning && currentSync === 'debates' ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                  Synkar...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Synka
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Dokument
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-2xl font-bold">{stats?.documents?.toLocaleString() || 0}</div>
            <Button 
              size="sm" 
              className="w-full" 
              onClick={() => startSync('documents')}
              disabled={isRunning}
            >
              {isRunning && currentSync === 'documents' ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                  Synkar...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Synka
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Vote className="h-4 w-4" />
              Voteringar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-2xl font-bold">{stats?.votes?.toLocaleString() || 0}</div>
            <Button 
              size="sm" 
              className="w-full" 
              onClick={() => startSync('votes')}
              disabled={isRunning}
            >
              {isRunning && currentSync === 'votes' ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                  Synkar...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Synka
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Avbryt-kontroller */}
      {isRunning && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-orange-600" />
              Pågående synkronisering
            </CardTitle>
            <CardDescription>
              Synkroniserar {currentSync}... Du kan avbryta operationen nedan.
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
                    Avbryt synkronisering
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Avbryt synkronisering?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Är du säker på att du vill avbryta den pågående synkroniseringen? 
                      Detta kan leda till att data inte är komplett.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Avbryt</AlertDialogCancel>
                    <AlertDialogAction onClick={abortSync}>
                      Ja, avbryt synkronisering
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
            Senaste synkroniseringar
          </CardTitle>
          <CardDescription>
            Historik över API-synkroniseringar med Riksdagens öppna data
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
                <p>Inga synkroniseringar genomförda ännu</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
