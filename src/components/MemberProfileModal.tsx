
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { 
  MapPin, 
  Calendar, 
  MessageSquare, 
  Vote, 
  ExternalLink, 
  User,
  Building,
  Clock,
  X
} from "lucide-react";

interface MemberProfileModalProps {
  iid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MemberProfileModal = ({ iid, open, onOpenChange }: MemberProfileModalProps) => {
  const { data: member, isLoading: memberLoading } = useQuery({
    queryKey: ['member', iid],
    queryFn: async ({ signal }) => {
      if (!iid) return null;
      const { data } = await supabase
        .from('ledamoter')
        .select('*')
        .eq('iid', iid)
        .abortSignal(signal)
        .single();
      return data;
    },
    enabled: !!iid && open
  });

  const { data: uppdrag, isLoading: uppdragLoading } = useQuery({
    queryKey: ['uppdrag', iid],
    queryFn: async ({ signal }) => {
      if (!iid) return [];
      const { data } = await supabase
        .from('uppdrag')
        .select('*')
        .eq('iid', iid)
        .order('from_datum', { ascending: false })
        .abortSignal(signal);
      return data || [];
    },
    enabled: !!iid && open
  });

  const { data: anforanden, isLoading: anforandenLoading } = useQuery({
    queryKey: ['member-anforanden', iid],
    queryFn: async ({ signal }) => {
      if (!iid) return [];
      const { data } = await supabase
        .from('anforanden')
        .select('*')
        .eq('intressent_id', iid)
        .order('datum', { ascending: false })
        .limit(10)
        .abortSignal(signal);
      return data || [];
    },
    enabled: !!iid && open
  });

  const { data: voteringar, isLoading: voteringarLoading } = useQuery({
    queryKey: ['member-voteringar', iid],
    queryFn: async ({ signal }) => {
      if (!iid) return [];
      const { data } = await supabase
        .from('voteringar')
        .select('*')
        .eq('intressent_id', iid)
        .order('votering_datum', { ascending: false })
        .limit(10)
        .abortSignal(signal);
      return data || [];
    },
    enabled: !!iid && open
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

  if (!member && !memberLoading) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {memberLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : member ? (
          <>
            <DialogHeader>
              <DialogTitle className="sr-only">
                {member.tilltalsnamn} {member.efternamn} - Profil
              </DialogTitle>
            </DialogHeader>

            {/* Huvudprofil */}
            <div className="flex flex-col md:flex-row gap-6 mb-6">
              <Avatar className="h-24 w-24 border-4 border-gray-200 mx-auto md:mx-0">
                <AvatarImage 
                  src={member.bild_url || undefined} 
                  alt={`${member.tilltalsnamn} ${member.efternamn}`}
                  className="object-cover"
                />
                <AvatarFallback className="bg-blue-100 text-blue-800 text-2xl font-bold">
                  {member.tilltalsnamn?.[0]}{member.efternamn?.[0]}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {member.tilltalsnamn} {member.efternamn}
                </h2>
                
                <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-3">
                  {member.parti && (
                    <Badge className={`${getPartyColor(member.parti)} font-medium`}>
                      {member.parti}
                    </Badge>
                  )}
                  <Badge 
                    variant={member.status === 'Tjänstgörande riksdagsledamot' ? 'default' : 'secondary'}
                  >
                    {member.status === 'Tjänstgörande riksdagsledamot' ? 'Aktiv' : 'Tidigare'}
                  </Badge>
                  {member.kon && (
                    <Badge variant="outline">
                      {member.kon === 'man' ? 'Man' : 'Kvinna'}
                    </Badge>
                  )}
                </div>

                <div className="space-y-1 text-sm text-gray-600">
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

            <Separator />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Senaste anföranden */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Senaste anföranden ({anforanden?.length || 0})
                </h3>
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
                  <div className="space-y-3 max-h-48 overflow-y-auto">
                    {anforanden.slice(0, 5).map((anforande) => (
                      <div key={anforande.anforande_id} className="border-l-4 border-blue-500 pl-3 py-2">
                        <h4 className="font-medium text-sm text-gray-900 mb-1">
                          {anforande.rubrik || anforande.dok_titel || 'Anförande'}
                        </h4>
                        {anforande.text && (
                          <p className="text-xs text-gray-600 mb-2">
                            {truncateText(anforande.text, 80)}
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
                  <p className="text-gray-500 text-sm">Inga anföranden hittades</p>
                )}
              </div>

              {/* Uppdrag */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Building className="h-5 w-5" />
                  Uppdrag ({uppdrag?.length || 0})
                </h3>
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
                  <div className="space-y-3 max-h-48 overflow-y-auto">
                    {uppdrag.slice(0, 5).map((uppdragItem, index) => (
                      <div key={index} className="border-l-4 border-green-500 pl-3 py-2">
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="font-medium text-sm text-gray-900">
                            {uppdragItem.roll || uppdragItem.typ || 'Uppdrag'}
                          </h4>
                          {uppdragItem.status && (
                            <Badge variant="outline" className="text-xs">
                              {uppdragItem.status}
                            </Badge>
                          )}
                        </div>
                        {uppdragItem.organ && (
                          <p className="text-xs text-gray-600 mb-1">{uppdragItem.organ}</p>
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
                  <p className="text-gray-500 text-sm">Inga uppdrag hittades</p>
                )}
              </div>
            </div>

            {/* Röstningsstatistik */}
            {voteringar && voteringar.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Vote className="h-5 w-5" />
                    Senaste röstningar ({voteringar.length})
                  </h3>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
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
                </div>
              </>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <User className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold mb-2">Ledamot hittades inte</h3>
            <p className="text-gray-600">Den begärda ledamoten kunde inte hittas.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
