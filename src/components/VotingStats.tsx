
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp } from "lucide-react";

export const VotingStats = () => {
  const { data: partyVotes, isLoading: partyLoading } = useQuery({
    queryKey: ['party-votes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('voteringar')
        .select('parti, rost')
        .not('parti', 'is', null)
        .not('rost', 'is', null);

      if (!data) return [];

      const partyStats: { [key: string]: { ja: number, nej: number, frånvarande: number, avstår: number } } = {};
      
      data.forEach(vote => {
        if (!partyStats[vote.parti]) {
          partyStats[vote.parti] = { ja: 0, nej: 0, frånvarande: 0, avstår: 0 };
        }
        
        const voteType = vote.rost.toLowerCase();
        if (voteType.includes('ja')) partyStats[vote.parti].ja++;
        else if (voteType.includes('nej')) partyStats[vote.parti].nej++;
        else if (voteType.includes('frånvarande')) partyStats[vote.parti].frånvarande++;
        else partyStats[vote.parti].avstår++;
      });

      return Object.entries(partyStats).map(([parti, votes]) => ({
        parti,
        ...votes,
        total: votes.ja + votes.nej + votes.frånvarande + votes.avstår
      })).sort((a, b) => b.total - a.total);
    }
  });

  const { data: recentVotes } = useQuery({
    queryKey: ['recent-votes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('voteringar')
        .select('*')
        .order('votering_datum', { ascending: false })
        .limit(5);
      return data || [];
    }
  });

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

  if (partyLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p>Laddar röstningsstatistik...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-green-600" />
          Röstningsstatistik
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Top 5 Parties by Total Votes */}
          <div>
            <h4 className="font-medium mb-3">Mest aktiva partier</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={partyVotes?.slice(0, 5)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="parti" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill="#3B82F6" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Votes */}
          <div>
            <h4 className="font-medium mb-3">Senaste voteringar</h4>
            <div className="space-y-3">
              {recentVotes?.slice(0, 3).map((vote, index) => (
                <div key={vote.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <p className="font-medium text-sm text-gray-900">{vote.namn}</p>
                    <p className="text-xs text-gray-600">{vote.avser}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {vote.parti && (
                        <Badge variant="outline" className="text-xs">
                          {vote.parti}
                        </Badge>
                      )}
                      {vote.valkrets && (
                        <span className="text-xs text-gray-500">{vote.valkrets}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge 
                      className={`text-xs ${
                        vote.rost?.toLowerCase().includes('ja') 
                          ? 'bg-green-100 text-green-800' 
                          : vote.rost?.toLowerCase().includes('nej')
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {vote.rost}
                    </Badge>
                    {vote.votering_datum && (
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(vote.votering_datum).toLocaleDateString('sv-SE')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
