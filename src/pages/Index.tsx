
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
  Zap
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
            Utforska Sveriges riksdag genom öppen data
          </p>
          <div className="flex justify-center gap-2 flex-wrap">
            <Badge variant="outline" className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              Riksdagens öppna data
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              Realtidsuppdateringar
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <Search className="h-3 w-3" />
              Avancerad sökning
            </Badge>
          </div>
        </div>

        {/* Main content tabs */}
        <Tabs defaultValue="explorer" className="w-full">
          <TabsList className="grid w-full grid-cols-6 mb-8">
            <TabsTrigger value="explorer" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              API Explorer
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
                  <Zap className="h-5 w-5" />
                  Interaktiv API-explorer och Batch-hämtning
                </CardTitle>
                <CardDescription>
                  Konfigurera, förhandsgranska och kör batch-hämtningar från Riksdagens öppna data API. 
                  Testa olika filter och se resultatet innan du hämtar data.
                </CardDescription>
              </CardHeader>
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
