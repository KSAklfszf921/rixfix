
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Users, MapPin, Eye, UserCheck, Calendar } from "lucide-react";
import { MemberProfileModal } from "./MemberProfileModal";

export const MemberDirectory = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedParty, setSelectedParty] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);
  const [selectedMemberIid, setSelectedMemberIid] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const statusFilter = showAll ? undefined : 'Tjänstgörande riksdagsledamot';

  const { data: members, isLoading } = useQuery({
    queryKey: ['members', searchTerm, selectedParty, statusFilter],
    queryFn: async ({ signal }) => {
      let query = supabase
        .from('ledamoter')
        .select('*')
        .order('efternamn', { ascending: true })
        .abortSignal(signal);

      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

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
    queryFn: async ({ signal }) => {
      const { data } = await supabase
        .from('ledamoter')
        .select('parti')
        .not('parti', 'is', null)
        .abortSignal(signal);
      
      const uniqueParties = [...new Set(data?.map(p => p.parti))].filter(Boolean);
      return uniqueParties.sort();
    }
  });

  const getPartyColor = (party: string) => {
    const colors: { [key: string]: string } = {
      'S': 'bg-red-100 text-red-800 border-red-200',
      'M': 'bg-blue-100 text-blue-800 border-blue-200',
      'SD': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'C': 'bg-green-100 text-green-800 border-green-200',
      'V': 'bg-red-200 text-red-900 border-red-300',
      'KD': 'bg-blue-200 text-blue-900 border-blue-300',
      'L': 'bg-blue-50 text-blue-700 border-blue-200',
      'MP': 'bg-green-200 text-green-900 border-green-300',
    };
    return colors[party] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const handleMemberClick = (iid: string) => {
    setSelectedMemberIid(iid);
    setIsModalOpen(true);
  };

  const activeCount = members?.filter(m => m.status === 'Tjänstgörande riksdagsledamot').length || 0;
  const totalCount = members?.length || 0;

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
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Riksdagsledamöter
              <Badge variant="outline" className="ml-2">
                {showAll ? `${totalCount} totalt` : `${activeCount} aktiva`}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={showAll ? "outline" : "default"}
                size="sm"
                onClick={() => setShowAll(false)}
                className="flex items-center gap-1"
              >
                <UserCheck className="h-3 w-3" />
                Aktiva
              </Button>
              <Button
                variant={showAll ? "default" : "outline"}
                size="sm"
                onClick={() => setShowAll(true)}
                className="flex items-center gap-1"
              >
                <Calendar className="h-3 w-3" />
                Alla
              </Button>
            </div>
          </div>
          
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {members?.map((member) => (
              <div 
                key={member.iid} 
                className="border rounded-lg p-6 hover:shadow-lg transition-all duration-200 cursor-pointer hover:border-blue-300 group"
                onClick={() => handleMemberClick(member.iid)}
              >
                <div className="flex items-start space-x-4">
                  <Avatar className="h-16 w-16 border-2 border-gray-200 group-hover:border-blue-300 transition-colors">
                    <AvatarImage 
                      src={member.bild_url || undefined} 
                      alt={`${member.tilltalsnamn} ${member.efternamn}`}
                      className="object-cover"
                    />
                    <AvatarFallback className="bg-blue-100 text-blue-800 text-lg font-semibold">
                      {member.tilltalsnamn?.[0]}{member.efternamn?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors text-lg">
                      {member.tilltalsnamn} {member.efternamn}
                    </h3>
                    <div className="flex items-center gap-2 mt-2">
                      {member.parti && (
                        <Badge className={`${getPartyColor(member.parti)} font-medium`}>
                          {member.parti}
                        </Badge>
                      )}
                      {member.status !== 'Tjänstgörande riksdagsledamot' && (
                        <Badge variant="secondary" className="text-xs">
                          Tidigare
                        </Badge>
                      )}
                    </div>
                    {member.valkrets && (
                      <div className="flex items-center gap-1 mt-3 text-sm text-gray-600">
                        <MapPin className="h-3 w-3" />
                        <span className="truncate">{member.valkrets}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-4">
                      {member.fodd_ar && (
                        <p className="text-sm text-gray-500">
                          Född: {member.fodd_ar}
                        </p>
                      )}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Eye className="h-4 w-4 text-blue-600" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {members?.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg">Inga ledamöter hittades för din sökning.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <MemberProfileModal 
        iid={selectedMemberIid}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
      />
    </>
  );
};
