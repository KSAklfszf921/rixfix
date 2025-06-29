
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Play, 
  Pause, 
  RotateCcw,
  Target,
  TrendingUp,
  Clock,
  Database,
  Users,
  FileText,
  MessageSquare,
  BarChart3,
  Building,
  CheckCircle,
  AlertCircle,
  RefreshCw
} from "lucide-react";

interface PhaseConfig {
  priority: number;
  maxBatchSize: number;
  defaultBatchSize: number;
  estimatedTotal: number;
}

interface PhaseInfo {
  type: string;
  name: string;
  icon: React.ReactNode;
  config: PhaseConfig;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  totalFetched: number;
  lastSync?: string;
  estimatedTimeRemaining?: number;
}

const PHASE_DEFINITIONS: Record<string, { name: string; icon: React.ReactNode; config: PhaseConfig }> = {
  members: {
    name: 'Ledamöter',
    icon: <Users className="h-5 w-5" />,
    config: { priority: 1, maxBatchSize: 200, defaultBatchSize: 100, estimatedTotal: 500 }
  },
  committees: {
    name: 'Utskott',
    icon: <Building className="h-5 w-5" />,
    config: { priority: 2, maxBatchSize: 50, defaultBatchSize: 25, estimatedTotal: 100 }
  },
  documents: {
    name: 'Dokument',
    icon: <FileText className="h-5 w-5" />,
    config: { priority: 3, maxBatchSize: 100, defaultBatchSize: 50, estimatedTotal: 2000 }
  },
  debates: {
    name: 'Anföranden',
    icon: <MessageSquare className="h-5 w-5" />,
    config: { priority: 4, maxBatchSize: 75, defaultBatchSize: 40, estimatedTotal: 1500 }
  },
  votes: {
    name: 'Voteringar',
    icon: <BarChart3 className="h-5 w-5" />,
    config: { priority: 5, maxBatchSize: 150, defaultBatchSize: 75, estimatedTotal: 3000 }
  }
};

export const StrategicPlanManager = () => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [phases, setPhases] = useState<PhaseInfo[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch sync states for all phases
  const { data: syncStates, refetch: refetchSyncStates } = useQuery({
    queryKey: ['strategic-sync-states'],
    queryFn: async () => {
      const { data } = await supabase.from('sync_state').select('*');
      return data || [];
    },
    refetchInterval: isExecuting ? 2000 : 5000
  });

  // Fetch recent logs
  const { data: recentLogs } = useQuery({
    queryKey: ['strategic-logs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('api_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);
      return data || [];
    },
    refetchInterval: isExecuting ? 3000 : 10000
  });

  // Calculate phase information
  useEffect(() => {
    const phaseInfos: PhaseInfo[] = Object.entries(PHASE_DEFINITIONS)
      .sort(([,a], [,b]) => a.config.priority - b.config.priority)
      .map(([type, definition]) => {
        const syncState = syncStates?.find(state => state.sync_type === type);
        const totalFetched = syncState?.total_fetched || 0;
        const progress = Math.min(100, (totalFetched / definition.config.estimatedTotal) * 100);
        
        let status: PhaseInfo['status'] = 'pending';
        if (syncState?.is_complete) {
          status = 'completed';
        } else if (syncState?.last_error) {
          status = 'failed';
        } else if (totalFetched > 0) {
          status = 'running';
        }

        // Estimate time remaining based on current progress
        const estimatedTimeRemaining = status === 'completed' ? 0 : 
          Math.max(0, (definition.config.estimatedTotal - totalFetched) / definition.config.defaultBatchSize * 30); // 30s per batch estimate

        return {
          type,
          name: definition.name,
          icon: definition.icon,
          config: definition.config,
          status,
          progress,
          totalFetched,
          lastSync: syncState?.last_sync_date,
          estimatedTimeRemaining
        };
      });

    setPhases(phaseInfos);
  }, [syncStates]);

  const executeStrategicPlan = async () => {
    setIsExecuting(true);
    try {
      const { data, error } = await supabase.functions.invoke('riksdag-api-sync', {
        body: { 
          strategicPlan: true,
          syncType: 'strategic_plan'
        }
      });

      if (error) throw error;

      toast({
        title: "Strategisk plan genomförd",
        description: `${data.totalProcessed} poster bearbetade över ${data.results?.length || 0} faser.`,
      });

      await queryClient.invalidateQueries({ queryKey: ['strategic-sync-states'] });
      await queryClient.invalidateQueries({ queryKey: ['strategic-logs'] });
      
    } catch (error: any) {
      console.error('Strategic plan error:', error);
      toast({
        title: "Strategisk planfel",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsExecuting(false);
      setCurrentPhase(null);
    }
  };

  const resetPhase = async (phaseType: string) => {
    try {
      await supabase
        .from('sync_state')
        .update({
          last_offset: 0,
          total_fetched: 0,
          is_complete: false,
          last_error: null,
          retry_count: 0,
          updated_at: new Date().toISOString()
        })
        .eq('sync_type', phaseType);

      toast({
        title: "Fas återställd",
        description: `${PHASE_DEFINITIONS[phaseType]?.name} har återställts.`,
      });

      refetchSyncStates();
    } catch (error: any) {
      toast({
        title: "Återställningsfel",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: PhaseInfo['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case 'running':
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: PhaseInfo['status']) => {
    const variants = {
      pending: 'secondary',
      running: 'default',
      completed: 'default',
      failed: 'destructive'
    } as const;

    const labels = {
      pending: 'Väntar',
      running: 'Pågår',
      completed: 'Klar',
      failed: 'Misslyckad'
    };

    return (
      <Badge variant={variants[status]} className="ml-2">
        {labels[status]}
      </Badge>
    );
  };

  const formatTimeRemaining = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  const totalProgress = phases.reduce((sum, phase) => sum + phase.progress, 0) / phases.length;
  const completedPhases = phases.filter(p => p.status === 'completed').length;
  const totalRecords = phases.reduce((sum, phase) => sum + phase.totalFetched, 0);

  return (
    <div className="space-y-6">
      {/* Overview Dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategisk Datahämtningsplan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{totalProgress.toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground">Total framsteg</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{completedPhases}/{phases.length}</div>
              <div className="text-sm text-muted-foreground">Klara faser</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{totalRecords.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">Hämtade poster</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {phases.reduce((sum, p) => sum + (p.estimatedTimeRemaining || 0), 0) > 0 
                  ? formatTimeRemaining(phases.reduce((sum, p) => sum + (p.estimatedTimeRemaining || 0), 0))
                  : '0s'
                }
              </div>
              <div className="text-sm text-muted-foreground">Beräknad tid kvar</div>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Total framsteg</span>
              <span className="text-sm text-muted-foreground">{totalProgress.toFixed(1)}%</span>
            </div>
            <Progress value={totalProgress} className="h-3" />
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={executeStrategicPlan} 
              disabled={isExecuting}
              className="flex-1"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Genomför strategisk plan...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Starta strategisk plan
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="phases" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="phases">Faser</TabsTrigger>
          <TabsTrigger value="logs">Loggar</TabsTrigger>
        </TabsList>

        <TabsContent value="phases" className="space-y-4">
          {phases.map((phase) => (
            <Card key={phase.type}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {phase.icon}
                    <div>
                      <h3 className="font-semibold">{phase.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Prioritet {phase.config.priority} • Max {phase.config.maxBatchSize} per batch
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(phase.status)}
                    {getStatusBadge(phase.status)}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Framsteg</span>
                    <span className="text-sm text-muted-foreground">
                      {phase.totalFetched.toLocaleString()} / {phase.config.estimatedTotal.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={phase.progress} className="h-2" />
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Senaste sync: </span>
                      <span>{phase.lastSync ? new Date(phase.lastSync).toLocaleString('sv-SE') : 'Aldrig'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Beräknad tid kvar: </span>
                      <span>{phase.estimatedTimeRemaining ? formatTimeRemaining(phase.estimatedTimeRemaining) : '0s'}</span>
                    </div>
                  </div>

                  {phase.status === 'failed' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetPhase(phase.type)}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Återställ
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          {recentLogs?.map((log) => (
            <Card key={log.id}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className="h-4 w-4" />
                    <div>
                      <div className="font-medium">{log.sync_type}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(log.started_at || '').toLocaleString('sv-SE')}
                        {log.completed_at && (
                          <span className="ml-2">
                            ({Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at || '').getTime()) / 1000)}s)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(log.status as any)}
                    <Badge variant={
                      log.status === 'completed' ? 'default' : 
                      log.status === 'failed' ? 'destructive' : 
                      'secondary'
                    }>
                      {log.status}
                    </Badge>
                    {log.records_processed !== null && (
                      <span className="text-sm text-muted-foreground">
                        {log.records_processed.toLocaleString()} poster
                      </span>
                    )}
                  </div>
                </div>
                {log.error_message && (
                  <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                    {log.error_message}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
};
