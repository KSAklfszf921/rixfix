
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Users, MapPin } from "lucide-react";

export const MemberDirectory = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedParty, setSelectedParty] = useState<string>("all");

  const { data: members, isLoading } = useQuery({
    queryKey: ['members', searchTerm, selectedParty],
    queryFn: async () => {
      let query = supabase
        .from('ledamoter')
        .select('*')
        .order('efternamn', { ascending: true });

      if (searchTerm) {
        query = query.or(`tilltalsnamn.ilike.%${searchTerm}%,efternamn.ilike.%${searchTerm}%`);
      }

      if (selectedParty !== "all") {
        query = query.eq('parti', selectedParty);
      }

      const { data } = await query;
      return data || [];
    }
  });

  const { data: parties } = useQuery({
    queryKey: ['parties'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ledamoter')
        .select('parti')
        .not('parti', 'is', null);
      
      const uniqueParties = [...new Set(data?.map(p => p.parti))].filter(Boolean);
      return uniqueParties.sort();
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p>Laddar ledamöter...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Riksdagsledamöter ({members?.length})
        </CardTitle>
        <div className="flex flex-col sm:flex-row gap-4 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Sök ledamot..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedParty} onValueChange={setSelectedParty}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Välj parti" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla partier</SelectItem>
              {parties?.map((party) => (
                <SelectItem key={party} value={party}>
                  {party}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members?.map((member) => (
            <div key={member.iid} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start space-x-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={member.bild_url || undefined} alt={`${member.tilltalsnamn} ${member.efternamn}`} />
                  <AvatarFallback className="bg-blue-100 text-blue-800">
                    {member.tilltalsnamn?.[0]}{member.efternamn?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 truncate">
                    {member.tilltalsnamn} {member.efternamn}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    {member.parti && (
                      <Badge className={getPartyColor(member.parti)}>
                        {member.parti}
                      </Badge>
                    )}
                    {member.kon && (
                      <Badge variant="outline" className="text-xs">
                        {member.kon === 'man' ? 'M' : 'K'}
                      </Badge>
                    )}
                  </div>
                  {member.valkrets && (
                    <div className="flex items-center gap-1 mt-2 text-sm text-gray-600">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate">{member.valkrets}</span>
                    </div>
                  )}
                  {member.fodd_ar && (
                    <p className="text-xs text-gray-500 mt-1">
                      Född: {member.fodd_ar}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {members?.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            Inga ledamöter hittades för din sökning.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
