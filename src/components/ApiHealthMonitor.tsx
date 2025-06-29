
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  Activity,
  Zap,
  Clock,
  RefreshCw
} from "lucide-react";

interface ApiHealthStatus {
  circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  isApiHealthy: boolean;
  lastHealthCheck?: string;
}

export const ApiHealthMonitor = () => {
  const [healthStatus, setHealthStatus] = useState<ApiHealthStatus>({
    circuitBreakerState: 'CLOSED',
    isApiHealthy: true
  });
  const { toast } = useToast();

  // Check API health status
  const { data: healthData, refetch: refetchHealth } = useQuery({
    queryKey: ['api-health-status'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('riksdag-api-sync', {
        body: { 
          syncType: 'members',
          preview: true
        }
      });

      if (error) throw error;
      
      return {
        circuitBreakerState: data.circuitBreakerState || 'CLOSED',
        isApiHealthy: data.isApiHealthy !== false,
        lastHealthCheck: new Date().toISOString()
      };
    },
    refetchInterval: 30000, // Check every 30 seconds
    retry: 1
  });

  useEffect(() => {
    if (healthData) {
      setHealthStatus(healthData);
    }
  }, [healthData]);

  const testApiConnection = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('riksdag-api-sync', {
        body: { 
          syncType: 'members',
          batchSize: 1,
          preview: true
        }
      });

      if (error) throw error;

      toast({
        title: "API-test slutförd",
        description: `Circuit breaker: ${data.circuitBreakerState}, API hälsa: ${data.isApiHealthy ? 'OK' : 'Problem'}`,
      });

      setHealthStatus({
        circuitBreakerState: data.circuitBreakerState || 'CLOSED',
        isApiHealthy: data.isApiHealthy !== false,
        lastHealthCheck: new Date().toISOString()
      });

    } catch (error: any) {
      toast({
        title: "API-test misslyckades",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getCircuitBreakerIcon = (state: string) => {
    switch (state) {
      case 'CLOSED':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'OPEN':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'HALF_OPEN':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      default:
        return <Shield className="h-5 w-5 text-gray-600" />;
    }
  };

  const getCircuitBreakerBadge = (state: string) => {
    const variants = {
      'CLOSED': 'default',
      'OPEN': 'destructive',
      'HALF_OPEN': 'secondary'
    } as const;

    const labels = {
      'CLOSED': 'Stängd (Normal)',
      'OPEN': 'Öppen (Blockerad)',
      'HALF_OPEN': 'Halvöppen (Test)'
    };

    return (
      <Badge variant={variants[state as keyof typeof variants] || 'secondary'}>
        {labels[state as keyof typeof labels] || state}
      </Badge>
    );
  };

  const getHealthIndicator = () => {
    if (!healthStatus.isApiHealthy) {
      return (
        <div className="flex items-center gap-2 text-red-600">
          <XCircle className="h-4 w-4" />
          <span>API Otillgängligt</span>
        </div>
      );
    }

    if (healthStatus.circuitBreakerState === 'OPEN') {
      return (
        <div className="flex items-center gap-2 text-red-600">
          <XCircle className="h-4 w-4" />
          <span>Säkerhetsbrytare Öppen</span>
        </div>
      );
    }

    if (healthStatus.circuitBreakerState === 'HALF_OPEN') {
      return (
        <div className="flex items-center gap-2 text-yellow-600">
          <AlertTriangle className="h-4 w-4" />
          <span>Återhämtning Pågår</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle className="h-4 w-4" />
        <span>API Tillgängligt</span>
      </div>
    );
  };

  const getOverallHealth = () => {
    if (!healthStatus.isApiHealthy || healthStatus.circuitBreakerState === 'OPEN') {
      return 0;
    }
    if (healthStatus.circuitBreakerState === 'HALF_OPEN') {
      return 50;
    }
    return 100;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          API Hälsoövervakning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Health */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">Övergripande hälsa</span>
            <span className="text-sm text-muted-foreground">{getOverallHealth()}%</span>
          </div>
          <Progress value={getOverallHealth()} className="h-3" />
          <div className="mt-2">
            {getHealthIndicator()}
          </div>
        </div>

        {/* Circuit Breaker Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-muted p-3 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              {getCircuitBreakerIcon(healthStatus.circuitBreakerState)}
              <span className="font-medium">Säkerhetsbrytare</span>
            </div>
            {getCircuitBreakerBadge(healthStatus.circuitBreakerState)}
            <p className="text-xs text-muted-foreground mt-2">
              {healthStatus.circuitBreakerState === 'CLOSED' && 'Normalt läge - API-anrop tillåtna'}
              {healthStatus.circuitBreakerState === 'OPEN' && 'Blockerat läge - för många fel upptäckta'}
              {healthStatus.circuitBreakerState === 'HALF_OPEN' && 'Testläge - försöker återhämta sig'}
            </p>
          </div>

          <div className="bg-muted p-3 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4" />
              <span className="font-medium">API Status</span>
            </div>
            <Badge variant={healthStatus.isApiHealthy ? 'default' : 'destructive'}>
              {healthStatus.isApiHealthy ? 'Tillgängligt' : 'Otillgängligt'}
            </Badge>
            {healthStatus.lastHealthCheck && (
              <p className="text-xs text-muted-foreground mt-2">
                Senaste kontroll: {new Date(healthStatus.lastHealthCheck).toLocaleString('sv-SE')}
              </p>
            )}
          </div>
        </div>

        {/* Status Descriptions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-900 mb-2">Robust API-hantering</h4>
          <div className="space-y-2 text-sm text-blue-800">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 mt-0.5 text-blue-600" />
              <div>
                <strong>Circuit Breaker:</strong> Skyddar mot API-överbelastning genom att blockera anrop efter upprepade fel
              </div>
            </div>
            <div className="flex items-start gap-2">
              <RefreshCw className="h-4 w-4 mt-0.5 text-blue-600" />
              <div>
                <strong>Intelligent Retry:</strong> Automatiska återförsök med exponentiell backoff
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 mt-0.5 text-blue-600" />
              <div>
                <strong>Timeout-hantering:</strong> Begränsar väntetid till 1 minut per anrop
              </div>
            </div>
          </div>
        </div>

        {/* Test Button */}
        <div className="flex gap-2">
          <Button onClick={testApiConnection} variant="outline" size="sm">
            <Activity className="h-4 w-4 mr-2" />
            Testa API-anslutning
          </Button>
          <Button onClick={() => refetchHealth()} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Uppdatera status
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
