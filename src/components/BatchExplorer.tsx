
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { StrategicPlanManager } from "@/components/StrategicPlanManager";
import { 
  Play, 
  Eye, 
  Settings, 
  History, 
  Filter,
  Calendar,
  Database,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Target,
  Zap
} from "lucide-react";

interface BatchConfig {
  syncType: string;
  batchSize: number;
  filters: Record<string, string>;
  dateFrom?: string;
  dateTo?: string;
}

interface PreviewResult {
  apiUrl: string;
  estimatedBatch: number;
  currentOffset: number;
  filters: Record<string, string>;
  phaseInfo?: {
    priority: number;
    maxBatchSize: number;
    defaultBatchSize: number;
    estimatedTotal: number;
  };
}

export const BatchExplorer = () => {
  const [config, setConfig] = useState<BatchConfig>({
    syncType: 'members',
    batchSize: 50,
    filters: {}
  });
  const [isRunning, setIsRunning] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch kodlistor
  const { data: partier } = useQuery({
    queryKey: ['parti-kodlista'],
    queryFn: async () => {
      const { data } = await supabase.from('parti_kodlista').select('*').order('namn');
      return data || [];
    }
  });

  const { data: doktyper } = useQuery({
    queryKey: ['doktyp-kodlista'],
    queryFn: async () => {
      const { data } = await supabase.from('doktyp_kodlista').select('*').order('namn');
      return data || [];
    }
  });

  const { data: valkretsar } = useQuery({
    queryKey: ['valkrets-kodlista'],
    queryFn: async () => {
      const { data } = await supabase.from('valkrets_kodlista').select('*').order('namn');
      return data || [];
    }
  });

  // Fetch batch history
  const { data: batchHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['batch-history'],
    queryFn: async () => {
      const { data } = await supabase
        .from('api_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(15);
      return data || [];
    },
    refetchInterval: isRunning ? 3000 : false
  });

  // Fetch sync states
  const { data: syncStates } = useQuery({
    queryKey: ['sync-states'],
    queryFn: async () => {
      const { data } = await supabase.from('sync_state').select('*');
      return data || [];
    },
    refetchInterval: 5000
  });

  const getSyncState = (syncType: string) => {
    return syncStates?.find(state => state.sync_type === syncType);
  };

  const handlePreview = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('riksdag-api-sync', {
        body: { 
          ...config,
          preview: true
        }
      });

      if (error) throw error;
      
      setPreview(data);
      toast({
        title: "Förhandsvisning klar",
        description: `API-URL genererad för ${config.syncType}`,
      });
    } catch (error: any) {
      console.error('Preview error:', error);
      toast({
        title: "Förhandsvisningsfel",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleRunBatch = async () => {
    if (!preview) {
      toast({
        title: "Kör förhandsvisning först",
        description: "Du måste köra en förhandsvisning innan du startar batch-hämtningen.",
        variant: "destructive",
      });
      return;
    }

    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('riksdag-api-sync', {
        body: config
      });

      if (error) throw error;

      toast({
        title: "Batch-hämtning slutförd",
        description: `Hämtade ${data.recordsProcessed} poster för ${config.syncType}. ${data.isComplete ? 'Fas komplett!' : 'Fler data tillgängliga.'}`,
      });

      await queryClient.invalidateQueries({ queryKey: ['batch-history'] });
      await queryClient.invalidateQueries({ queryKey: ['sync-states'] });
      await refetchHistory();
      
    } catch (error: any) {
      console.error('Batch error:', error);
      toast({
        title: "Batch-hämtningsfel",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
      setPreview(null);
    }
  };

  const renderFilters = () => {
    const syncType = config.syncType;
    
    return (
      <div className="space-y-4">
        {/* Common filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="dateFrom">Från datum (YYYY-MM-DD)</Label>
            <Input
              id="dateFrom"
              type="date"
              value={config.dateFrom || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, dateFrom: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="dateTo">Till datum (YYYY-MM-DD)</Label>
            <Input
              id="dateTo"
              type="date"
              value={config.dateTo || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, dateTo: e.target.value }))}
            />
          </div>
        </div>

        {/* Sync type specific filters */}
        {(syncType === 'members' || syncType === 'debates' || syncType === 'votes') && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="parti">Parti</Label>
              <Select
                onValueChange={(value) => setConfig(prev => ({
                  ...prev,
                  filters: { ...prev.filters, parti: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Välj parti" />
                </SelectTrigger>
                <SelectContent>
                  {partier?.map((parti) => (
                    <SelectItem key={parti.kod} value={parti.kod}>
                      {parti.namn} ({parti.kod})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="valkrets">Valkrets</Label>
              <Select
                onValueChange={(value) => setConfig(prev => ({
                  ...prev,
                  filters: { ...prev.filters, valkrets: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Välj valkrets" />
                </SelectTrigger>
                <SelectContent>
                  {valkretsar?.map((valkrets) => (
                    <SelectItem key={valkrets.kod} value={valkrets.kod}>
                      {valkrets.namn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {syncType === 'documents' && (
          <div>
            <Label htmlFor="doktyp">Dokumenttyp</Label>
            <Select
              onValueChange={(value) => setConfig(prev => ({
                ...prev,
                filters: { ...prev.filters, doktyp: value }
              }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Välj dokumenttyp" />
              </SelectTrigger>
              <SelectContent>
                {doktyper?.map((doktyp) => (
                  <SelectItem key={doktyp.kod} value={doktyp.kod}>
                    {doktyp.namn} ({doktyp.kod})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {syncType === 'debates' && (
          <div>
            <Label htmlFor="anforandetyp">Anförandetyp</Label>
            <Select
              onValueChange={(value) => setConfig(prev => ({
                ...prev,
                filters: { ...prev.filters, anforandetyp: value }
              }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Välj anförandetyp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Nej">Nej</SelectItem>
                <SelectItem value="Ja">Ja</SelectItem>
                <SelectItem value="Anförande">Anförande</SelectItem>
                <SelectItem value="Svar">Svar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case 'running':
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-600" />;
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
      <Tabs defaultValue="strategic" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="strategic" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Strategisk Plan
          </TabsTrigger>
          <TabsTrigger value="configure" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Konfigurera
          </TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Förhandsvisning
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Historik
          </TabsTrigger>
        </TabsList>

        <TabsContent value="strategic">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Strategisk Datahämtningsplan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Zap className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-blue-900 mb-2">Intelligent Batch-hämtning</h4>
                    <p className="text-blue-800 text-sm mb-3">
                      Detta verktyg kör en optimerad sekvens för att hämta all Riksdagsdata i rätt ordning med 
                      intelligent anpassning av batch-storlek och automatisk felhantering.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                      <div className="bg-blue-100 px-2 py-1 rounded">1. Ledamöter (500st)</div>
                      <div className="bg-blue-100 px-2 py-1 rounded">2. Utskott (100st)</div>
                      <div className="bg-blue-100 px-2 py-1 rounded">3. Dokument (2000st)</div>
                      <div className="bg-blue-100 px-2 py-1 rounded">4. Anföranden (1500st)</div>
                      <div className="bg-blue-100 px-2 py-1 rounded">5. Voteringar (3000st)</div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <StrategicPlanManager />
        </TabsContent>

        <TabsContent value="configure" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Batch-konfiguration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="syncType">Datatyp</Label>
                  <Select
                    value={config.syncType}
                    onValueChange={(value) => setConfig(prev => ({ ...prev, syncType: value, filters: {} }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="members">Ledamöter</SelectItem>
                      <SelectItem value="committees">Utskott</SelectItem>
                      <SelectItem value="documents">Dokument</SelectItem>
                      <SelectItem value="debates">Anföranden</SelectItem>
                      <SelectItem value="votes">Voteringar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="batchSize">Batchstorlek</Label>
                  <Select
                    value={config.batchSize.toString()}
                    onValueChange={(value) => setConfig(prev => ({ ...prev, batchSize: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />
              
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filter
                </h3>
                {renderFilters()}
              </div>

              {/* Current sync state info */}
              {(() => {
                const syncState = getSyncState(config.syncType);
                return syncState && (
                  <div className="bg-muted p-4 rounded-lg">
                    <h4 className="font-medium mb-2">Aktuell synkroniseringsstatus</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>Hämtade poster: {syncState.total_fetched?.toLocaleString() || 0}</div>
                      <div>Senaste offset: {syncState.last_offset || 0}</div>
                      <div>Status: {syncState.is_complete ? 'Komplett' : 'Pågående'}</div>
                      <div>Senaste sync: {syncState.last_sync_date ? new Date(syncState.last_sync_date).toLocaleString('sv-SE') : 'Aldrig'}</div>
                    </div>
                    {syncState.last_error && (
                      <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                        Senaste fel: {syncState.last_error}
                      </div>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Förhandsvisning och Körning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button onClick={handlePreview} disabled={isRunning}>
                  <Eye className="h-4 w-4 mr-2" />
                  Förhandsgranska
                </Button>
                
                {preview && (
                  <Button onClick={handleRunBatch} disabled={isRunning}>
                    {isRunning ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Hämtar...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Kör batch
                      </>
                    )}
                  </Button>
                )}
              </div>

              {preview && (
                <Card>
                  <CardHeader>
                    <CardTitle>API-anrop förhandsvisning</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label>API-URL:</Label>
                      <code className="block bg-muted p-2 rounded text-sm mt-1 break-all">
                        {preview.apiUrl}
                      </code>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Batchstorlek:</Label>
                        <p className="font-mono">{preview.estimatedBatch}</p>
                      </div>
                      <div>
                        <Label>Nuvarande offset:</Label>
                        <p className="font-mono">{preview.currentOffset}</p>
                      </div>
                    </div>
                    
                    {preview.phaseInfo && (
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <Label className="text-blue-900">Fas-information:</Label>
                        <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-blue-800">
                          <div>Prioritet: {preview.phaseInfo.priority}</div>
                          <div>Max batch: {preview.phaseInfo.maxBatchSize}</div>
                          <div>Beräknat total: {preview.phaseInfo.estimatedTotal.toLocaleString()}</div>
                          <div>Standard batch: {preview.phaseInfo.defaultBatchSize}</div>
                        </div>
                      </div>
                    )}
                    
                    {Object.keys(preview.filters).length > 0 && (
                      <div>
                        <Label>Aktiva filter:</Label>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {Object.entries(preview.filters).map(([key, value]) => (
                            <Badge key={key} variant="outline">
                              {key}: {value}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Batch-historik</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {batchHistory?.map((log) => (
                  <Card key={log.id}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(log.status || 'unknown')}
                          <div>
                            <div className="font-medium capitalize">{log.sync_type}</div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              <Calendar className="h-3 w-3" />
                              {new Date(log.started_at || '').toLocaleString('sv-SE')}
                              {log.completed_at && (
                                <span className="ml-2">
                                  ({formatDuration(log.started_at || '', log.completed_at)})
                                </span>
                              )}
                            </div>
                            {log.error_message && (
                              <div className="text-sm text-red-600 mt-1 bg-red-50 p-1 rounded">
                                {log.error_message}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={
                            log.status === 'completed' ? 'default' : 
                            log.status === 'failed' ? 'destructive' : 
                            'secondary'
                          }>
                            {log.status === 'completed' ? 'Slutförd' : 
                             log.status === 'failed' ? 'Misslyckad' : 
                             log.status === 'running' ? 'Pågår' : 'Okänd'}
                          </Badge>
                          {log.records_processed !== null && (
                            <span className="text-sm text-muted-foreground">
                              {log.records_processed.toLocaleString()} poster
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                
                {!batchHistory?.length && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Inga batch-hämtningar genomförda ännu</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
