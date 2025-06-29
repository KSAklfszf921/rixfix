
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { 
  ArrowLeft, 
  MapPin, 
  Calendar, 
  MessageSquare, 
  Vote, 
  ExternalLink, 
  User,
  Building,
  Clock
} from "lucide-react";

export const MemberProfile = () => {
  const { iid } = useParams<{ iid: string }>();
  const navigate = useNavigate();

  const { data: member, isLoading: memberLoading } = useQuery({
    queryKey: ['member', iid],
    queryFn: async () => {
      if (!iid) return null;
      const { data } = await supabase
        .from('ledamoter')
        .select('*')
        .eq('iid', iid)
        .single();
      return data;
    }
  });

  const { data: uppdrag, isLoading: uppdragLoading } = useQuery({
    queryKey: ['uppdrag', iid],
    queryFn: async () => {
      if (!iid) return [];
      const { data } = await supabase
        .from('uppdrag')
        .select('*')
        .eq('iid', iid)
        .order('from_datum', { ascending: false });
      return data || [];
    }
  });

  const { data: anforanden, isLoading: anforandenLoading } = useQuery({
    queryKey: ['member-anforanden', iid],
    queryFn: async () => {
      if (!iid) return [];
      const { data } = await supabase
        .from('anforanden')
        .select('*')
        .eq('intressent_id', iid)
        .order('datum', { ascending: false })
        .limit(10);
      return data || [];
    }
  });

  const { data: voteringar, isLoading: voteringarLoading } = useQuery({
    queryKey: ['member-voteringar', iid],
    queryFn: async () => {
      if (!iid) return [];
      const { data } = await supabase
        .from('voteringar')
        .select('*')
        .eq('intressent_id', iid)
        .order('votering_datum', { ascending: false })
        .limit(5);
      return data || [];
    }
  });

  const { data: kontakt } = useQuery({
    queryKey: ['kontakt', iid],
    queryFn: async () => {
      if (!iid) return null;
      const { data } = await supabase
        .from('kontaktuppgifter')
        .select('*')
        .eq('iid', iid)
        .single();
      return data;
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

  const truncateText = (text: string, maxLength: number) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (memberLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="h-64 bg-gray-200 rounded mb-6"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Button 
          variant="outline" 
          onClick={() => navigate('/ledamoter')}
          className="mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Tillbaka till ledamöter
        </Button>
        <Card>
          <CardContent className="p-12 text-center">
            <User className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold mb-2">Ledamot hittades inte</h2>
            <p className="text-gray-600">Den begärda ledamoten kunde inte hittas.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Button 
        variant="outline" 
        onClick={() => navigate('/ledamoter')}
        className="mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Tillbaka till ledamöter
      </Button>

      {/* Huvudprofil */}
      <Card className="mb-6">
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row gap-6">
            <Avatar className="h-32 w-32 border-4 border-gray-200 mx-auto md:mx-0">
              <AvatarImage 
                src={member.bild_url || undefined} 
                alt={`${member.tilltalsnamn} ${member.efternamn}`}
                className="object-cover"
              />
              <AvatarFallback className="bg-blue-100 text-blue-800 text-3xl font-bold">
                {member.tilltalsnamn?.[0]}{member.efternamn?.[0]}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1 text-center md:text-left">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {member.tilltalsnamn} {member.efternamn}
              </h1>
              
              <div className="flex flex-wrap justify-center md:justify-start gap-3 mb-4">
                {member.parti && (
                  <Badge className={`${getPartyColor(member.parti)} text-base px-3 py-1`}>
                    {member.parti}
                  </Badge>
                )}
                <Badge 
                  variant={member.status === 'Tjänstgörande riksdagsledamot' ? 'default' : 'secondary'}
                  className="text-base px-3 py-1"
                >
                  {member.status === 'Tjänstgörande riksdagsledamot' ? 'Aktiv' : 'Tidigare'}
                </Badge>
                {member.kon && (
                  <Badge variant="outline" className="text-base px-3 py-1">
                    {member.kon === 'man' ? 'Man' : 'Kvinna'}
                  </Badge>
                )}
              </div>

              <div className="space-y-2 text-gray-600">
                {member.valkrets && (
                  <div className="flex items-center justify-center md:justify-start gap-2">
                    <MapPin className="h-4 w-4" />
                    <span>{member.valkrets}</span>
                  </div>
                )}
                {member.fodd_ar && (
                  <div className="flex items-center justify-center md:justify-start gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>Född {member.fodd_ar}</span>
                  </div>
                )}
                {member.webbplats_url && (
                  <div className="flex items-center justify-center md:justify-start gap-2">
                    <ExternalLink className="h-4 w-4" />
                    <a 
                      href={member.webbplats_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Personlig webbplats
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Senaste anföranden */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Senaste anföranden ({anforanden?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {anforandenLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : anforanden?.length ? (
              <div className="space-y-4">
                {anforanden.slice(0, 5).map((anforande) => (
                  <div key={anforande.anforande_id} className="border-l-4 border-blue-500 pl-4 py-2">
                    <h4 className="font-medium text-gray-900 mb-1">
                      {anforande.rubrik || anforande.dok_titel || 'Anförande'}
                    </h4>
                    {anforande.text && (
                      <p className="text-sm text-gray-600 mb-2">
                        {truncateText(anforande.text, 100)}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock className="h-3 w-3" />
                      {anforande.datum ? new Date(anforande.datum).toLocaleDateString('sv-SE') : 'Okänt datum'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">Inga anföranden hittades</p>
            )}
          </CardContent>
        </Card>

        {/* Uppdrag */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building className="h-5 w-5" />
              Uppdrag ({uppdrag?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {uppdragLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : uppdrag?.length ? (
              <div className="space-y-4">
                {uppdrag.slice(0, 5).map((uppdragItem, index) => (
                  <div key={index} className="border-l-4 border-green-500 pl-4 py-2">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-medium text-gray-900">
                        {uppdragItem.roll || uppdragItem.typ || 'Uppdrag'}
                      </h4>
                      {uppdragItem.status && (
                        <Badge variant="outline" className="text-xs">
                          {uppdragItem.status}
                        </Badge>
                      )}
                    </div>
                    {uppdragItem.organ && (
                      <p className="text-sm text-gray-600 mb-1">{uppdragItem.organ}</p>
                    )}
                    <div className="text-xs text-gray-500">
                      {uppdragItem.from_datum && (
                        <>
                          Från: {new Date(uppdragItem.from_datum).toLocaleDateString('sv-SE')}
                          {uppdragItem.tom_datum && (
                            <> - Till: {new Date(uppdragItem.tom_datum).toLocaleDateString('sv-SE')}</>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">Inga uppdrag hittades</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Röstningsstatistik */}
      {voteringar && voteringar.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Vote className="h-5 w-5" />
              Senaste röstningar ({voteringar.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {voteringar.map((votering, index) => (
                <div key={index} className="flex justify-between items-center py-2 border-b last:border-b-0">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{votering.avser || 'Votering'}</p>
                    <p className="text-xs text-gray-500">
                      {votering.votering_datum ? new Date(votering.votering_datum).toLocaleDateString('sv-SE') : 'Okänt datum'}
                    </p>
                  </div>
                  <Badge 
                    variant={votering.rost === 'Ja' ? 'default' : votering.rost === 'Nej' ? 'destructive' : 'secondary'}
                    className="ml-2"
                  >
                    {votering.rost || 'Okänt'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
