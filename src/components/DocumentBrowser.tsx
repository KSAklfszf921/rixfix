
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Search, ExternalLink, Calendar, Building } from "lucide-react";

export const DocumentBrowser = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 10;

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', searchTerm, selectedType, page],
    queryFn: async () => {
      let query = supabase
        .from('dokument')
        .select('*')
        .order('datum', { ascending: false })
        .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

      if (searchTerm) {
        query = query.or(`titel.ilike.%${searchTerm}%,doktyp.ilike.%${searchTerm}%`);
      }

      if (selectedType !== "all") {
        query = query.eq('doktyp', selectedType);
      }

      const { data } = await query;
      return data || [];
    }
  });

  const { data: docTypes } = useQuery({
    queryKey: ['document-types'],
    queryFn: async () => {
      const { data } = await supabase
        .from('dokument')
        .select('doktyp')
        .not('doktyp', 'is', null);
      
      const uniqueTypes = [...new Set(data?.map(d => d.doktyp))].filter(Boolean);
      return uniqueTypes.sort();
    }
  });

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      'Beslutad': 'bg-green-100 text-green-800',
      'Föredragen': 'bg-blue-100 text-blue-800',
      'Avslutad': 'bg-gray-100 text-gray-800',
      'Pågående': 'bg-yellow-100 text-yellow-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p>Laddar dokument...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Parlamentariska dokument ({documents?.length})
        </CardTitle>
        <div className="flex flex-col sm:flex-row gap-4 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Sök dokument..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(0);
              }}
              className="pl-10"
            />
          </div>
          <Select value={selectedType} onValueChange={(value) => {
            setSelectedType(value);
            setPage(0);
          }}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Välj dokumenttyp" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla typer</SelectItem>
              {docTypes?.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {documents?.map((document) => (
            <div key={document.dok_id} className="border rounded-lg p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-2">
                    {document.titel || `Dokument ${document.dok_id}`}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {document.doktyp && (
                      <Badge variant="outline">
                        {document.doktyp}
                      </Badge>
                    )}
                    {document.status && (
                      <Badge className={getStatusColor(document.status)}>
                        {document.status}
                      </Badge>
                    )}
                    {document.organ && (
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Building className="h-3 w-3" />
                        <span>{document.organ}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    {document.datum && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(document.datum).toLocaleDateString('sv-SE')}</span>
                      </div>
                    )}
                    {document.rm && (
                      <span>RM: {document.rm}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {document.dokument_url_html && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={document.dokument_url_html} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" />
                      HTML
                    </a>
                  </Button>
                )}
                {document.dokument_url_pdf && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={document.dokument_url_pdf} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" />
                      PDF
                    </a>
                  </Button>
                )}
                {document.dokument_url_text && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={document.dokument_url_text} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Text
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {documents?.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            Inga dokument hittades för din sökning.
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
            disabled={documents && documents.length < ITEMS_PER_PAGE}
          >
            Nästa
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
