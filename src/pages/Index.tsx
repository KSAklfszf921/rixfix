
import { DocumentBrowser } from "@/components/DocumentBrowser";
import { MemberDirectory } from "@/components/MemberDirectory";
import { RecentDebates } from "@/components/RecentDebates";
import { VotingStats } from "@/components/VotingStats";
import { BatchExplorer } from "@/components/BatchExplorer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Database, 
  Users, 
  FileText, 
  MessageSquare,
  BarChart3,
  Search,
  Zap,
  Target,
  TrendingUp,
  Shield,
  Cpu
} from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Riksdagskoll
          </h1>
          <p className="text-xl text-gray-600 mb-6">
            Strategisk datahämtning och utforskning av Sveriges riksdag
          </p>
          <div className="flex justify-center gap-2 flex-wrap">
            <Badge variant="outline" className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              Strategisk hämtning
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              Intelligent batching
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              Automatisk felhantering
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Real-time övervakning
            </Badge>
          </div>
        </div>

        {/* Main content tabs */}
        <Tabs defaultValue="explorer" className="w-full">
          <TabsList className="grid w-full grid-cols-6 mb-8">
            <TabsTrigger value="explorer" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Strategisk Explorer
            </TabsTrigger>
            <TabsTrigger value="members" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Ledamöter
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Dokument
            </TabsTrigger>
            <TabsTrigger value="debates" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Anföranden
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Statistik
            </TabsTrigger>
            <TabsTrigger value="admin" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Admin
            </TabsTrigger>
          </TabsList>

          <TabsContent value="explorer">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Strategisk Datahämtning & API Explorer
                </CardTitle>
                <CardDescription>
                  Genomför komplett strategisk datahämtning med intelligent batch-optimering, 
                  automatisk fasindelning och real-time övervakning av hela processen.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold text-blue-900">Strategisk Plan</h3>
                    </div>
                    <p className="text-sm text-blue-800">
                      Automatisk hämtning i optimal ordning: Ledamöter → Utskott → Dokument → Anföranden → Voteringar
                    </p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Cpu className="h-5 w-5 text-green-600" />
                      <h3 className="font-semibold text-green-900">Intelligent Batching</h3>
                    </div>
                    <p className="text-sm text-green-800">
                      Dynamisk anpassning av batch-storlek baserat på responstid och API-prestanda
                    </p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="h-5 w-5 text-purple-600" />
                      <h3 className="font-semibold text-purple-900">Robust Felhantering</h3>
                    </div>
                    <p className="text-sm text-purple-800">
                      Automatisk retry med exponential backoff, rate limiting och intelligenta felåterställningar
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <BatchExplorer />
          </TabsContent>

          <TabsContent value="members">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Riksdagsledamöter
                </CardTitle>
                <CardDescription>
                  Utforska alla riksdagsledamöter, deras partitillhörighet, valkretsar och bakgrund.
                </CardDescription>
              </CardHeader>
            </Card>
            <MemberDirectory />
          </TabsContent>

          <TabsContent value="documents">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Riksdagsdokument
                </CardTitle>
                <CardDescription>
                  Sök och bläddra bland propositioner, motioner, betänkanden och andra riksdagsdokument.
                </CardDescription>
              </CardHeader>
            </Card>
            <DocumentBrowser />
          </TabsContent>

          <TabsContent value="debates">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Senaste anföranden
                </CardTitle>
                <CardDescription>
                  Följ de senaste debatterna och anförandena från riksdagens kammare.
                </CardDescription>
              </CardHeader>
            </Card>
            <RecentDebates />
          </TabsContent>

          <TabsContent value="stats">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Röstningsstatistik
                </CardTitle>
                <CardDescription>
                  Analysera röstmönster och statistik från riksdagens voteringar.
                </CardDescription>
              </CardHeader>
            </Card>
            <VotingStats />
          </TabsContent>

          <TabsContent value="admin">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Administrationsverktyg
                </CardTitle>
                <CardDescription>
                  Avancerade verktyg för datahantering och systemadministration.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  För fullständiga administrationsverktyg, besök{" "}
                  <a href="/admin" className="text-primary hover:underline">
                    Admin-panelen
                  </a>
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Index;
