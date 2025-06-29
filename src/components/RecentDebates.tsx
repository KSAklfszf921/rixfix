
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Search, ExternalLink, Calendar, User } from "lucide-react";

export const RecentDebates = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 10;

  const { data: debates, isLoading } = useQuery({
    queryKey: ['debates', searchTerm, page],
    queryFn: async () => {
      let query = supabase
        .from('anforanden')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

      if (searchTerm) {
        query = query.or(`anforande.ilike.%${searchTerm}%,talare.ilike.%${searchTerm}%,rubrik.ilike.%${searchTerm}%`);
      }

      const { data } = await query;
      return data || [];
    }
  });

  const getPartyColor = (party: string) => {
    const colors: { [key: string]: string } = {
      'S': 'bg-red-100 text-red-800',
      'M': 'bg-blue-100 text-blue-800',
      'SD': 'bg-yellow-100 text-yellow-800',
      'C': 'bg-green-100 text-green-800',
      'V': 'bg-red-200 text-red-900',
      'KD': 'bg-blue-200 text-blue-900',
      'L': 'bg-blue-50 text-blue-700',
      'MP': 'bg-green-200 text-green-900',
    };
    return colors[party] || 'bg-gray-100 text-gray-800';
  };

  const truncateText = (text: string, maxLength: number) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p>Laddar debatter...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Senaste anföranden
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Sök i anföranden..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(0);
            }}
            className="pl-10"
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {debates?.map((debate) => (
            <div key={debate.anforande_id} className="border rounded-lg p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-2">
                    {debate.rubrik || debate.dok_titel || 'Anförande'}
                  </h3>
                  <div className="flex items-center gap-3 text-sm text-gray-600 mb-3">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      <span className="font-medium">{debate.talare}</span>
                    </div>
                    {debate.parti && (
                      <Badge className={getPartyColor(debate.parti)}>
                        {debate.parti}
                      </Badge>
                    )}
                    {debate.dok_datum && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(debate.dok_datum).toLocaleDateString('sv-SE')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {debate.anforande && (
                <div className="bg-gray-50 rounded-md p-4 mb-4">
                  <p className="text-gray-700 leading-relaxed">
                    {truncateText(debate.anforande, 300)}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {debate.anforandetyp && (
                    <Badge variant="outline" className="text-xs">
                      {debate.anforandetyp}
                    </Badge>
                  )}
                  {debate.nummer && (
                    <span>Nr: {debate.nummer}</span>
                  )}
                </div>
                {debate.protokoll_url_xml && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={debate.protokoll_url_xml} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Protokoll
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {debates?.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            Inga anföranden hittades för din sökning.
          </div>
        )}

        <div className="flex justify-center gap-2 mt-6">
          <Button
            variant="outline"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
          >
            Föregående
          </Button>
          <Button
            variant="outline"
            onClick={() => setPage(page + 1)}
            disabled={debates && debates.length < ITEMS_PER_PAGE}
          >
            Nästa
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
