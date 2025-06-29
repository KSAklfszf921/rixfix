
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, FileText, MessageSquare, Vote, TrendingUp, Calendar } from "lucide-react";
import { MemberDirectory } from "@/components/MemberDirectory";
import { RecentDebates } from "@/components/RecentDebates";
import { VotingStats } from "@/components/VotingStats";
import { DocumentBrowser } from "@/components/DocumentBrowser";

const Index = () => {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['parliamentary-stats'],
    queryFn: async () => {
      const [membersResult, debatesResult, documentsResult, votesResult] = await Promise.all([
        supabase.from('ledamoter').select('*', { count: 'exact' }),
        supabase.from('anforanden').select('*', { count: 'exact' }),
        supabase.from('dokument').select('*', { count: 'exact' }),
        supabase.from('voteringar').select('*', { count: 'exact' })
      ]);

      return {
        members: membersResult.count || 0,
        debates: debatesResult.count || 0,
        documents: documentsResult.count || 0,
        votes: votesResult.count || 0
      };
    }
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: async () => {
      const { data } = await supabase
        .from('anforanden')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    }
  });

  if (statsLoading || activityLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Laddar riksdagsdata...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-yellow-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
                <Vote className="h-7 w-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Riksdagskoll</h1>
                <p className="text-gray-600">Svenska riksdagens öppna data</p>
              </div>
            </div>
            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
              <Calendar className="h-3 w-3 mr-1" />
              Live Data
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Statistics Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-white hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Riksdagsledamöter</CardTitle>
              <Users className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{stats?.members}</div>
              <p className="text-xs text-gray-500 mt-1">Aktiva ledamöter</p>
            </CardContent>
          </Card>

          <Card className="bg-white hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Anföranden</CardTitle>
              <MessageSquare className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{stats?.debates?.toLocaleString()}</div>
              <p className="text-xs text-gray-500 mt-1">Totalt antal tal</p>
            </CardContent>
          </Card>

          <Card className="bg-white hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Dokument</CardTitle>
              <FileText className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{stats?.documents?.toLocaleString()}</div>
              <p className="text-xs text-gray-500 mt-1">Parlamentariska handlingar</p>
            </CardContent>
          </Card>

          <Card className="bg-white hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Voteringar</CardTitle>
              <TrendingUp className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{stats?.votes?.toLocaleString()}</div>
              <p className="text-xs text-gray-500 mt-1">Registrerade röster</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:w-[600px] mx-auto">
            <TabsTrigger value="overview">Översikt</TabsTrigger>
            <TabsTrigger value="members">Ledamöter</TabsTrigger>
            <TabsTrigger value="debates">Debatter</TabsTrigger>
            <TabsTrigger value="documents">Dokument</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-blue-600" />
                    Senaste anföranden
                  </CardTitle>
                  <CardDescription>De mest aktuella talen i riksdagen</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {recentActivity?.slice(0, 3).map((debate, index) => (
                      <div key={debate.anforande_id} className="border-l-4 border-blue-500 pl-4 py-2">
                        <p className="font-medium text-gray-900">{debate.talare}</p>
                        <p className="text-sm text-gray-600">{debate.parti} • {debate.dok_titel}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {debate.datum ? new Date(debate.datum).toLocaleDateString('sv-SE') : 'Okänt datum'}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <VotingStats />
            </div>
          </TabsContent>

          <TabsContent value="members">
            <MemberDirectory />
          </TabsContent>

          <TabsContent value="debates">
            <RecentDebates />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentBrowser />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
