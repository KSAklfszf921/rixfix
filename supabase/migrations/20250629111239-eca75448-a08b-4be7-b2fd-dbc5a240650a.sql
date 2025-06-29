
-- Skapa kodlistor för Riksdagens API
CREATE TABLE public.parti_kodlista (
  kod TEXT PRIMARY KEY,
  namn TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.doktyp_kodlista (
  kod TEXT PRIMARY KEY,
  namn TEXT NOT NULL,
  beskrivning TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.utskott_kodlista (
  kod TEXT PRIMARY KEY,
  namn TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.valkrets_kodlista (
  kod TEXT PRIMARY KEY,
  namn TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Lägg till kodlistdata för partier
INSERT INTO public.parti_kodlista (kod, namn) VALUES
('S', 'Socialdemokraterna'),
('M', 'Moderaterna'),
('SD', 'Sverigedemokraterna'),
('V', 'Vänsterpartiet'),
('C', 'Centerpartiet'),
('MP', 'Miljöpartiet'),
('L', 'Liberalerna'),
('KD', 'Kristdemokraterna');

-- Lägg till dokumenttyper
INSERT INTO public.doktyp_kodlista (kod, namn, beskrivning) VALUES
('mot', 'Motion', 'Förslag från riksdagsledamot'),
('prop', 'Proposition', 'Regeringsförslag'),
('bet', 'Betänkande', 'Utskottsbetänkande'),
('skr', 'Skrivelse', 'Regeringsskrivelse'),
('frs', 'Frågestund', 'Frågor till regeringen'),
('ip', 'Interpellation', 'Interpellation till minister'),
('sfs', 'Svensk författningssamling', 'Lagar och förordningar'),
('sou', 'Statens offentliga utredningar', 'Offentliga utredningar');

-- Lägg till utskott
INSERT INTO public.utskott_kodlista (kod, namn) VALUES
('AU', 'Arbetsmarknadsutskottet'),
('FiU', 'Finansutskottet'),
('KU', 'Konstitutionsutskottet'),
('SoU', 'Socialutskottet'),
('UU', 'Utrikesutskottet'),
('NU', 'Näringsutskottet'),
('MJU', 'Miljö- och jordbruksutskottet'),
('TU', 'Trafikutskottet'),
('UbU', 'Utbildningsutskottet'),
('CU', 'Civilutskottet'),
('FöU', 'Försvarsutskottet'),
('JuU', 'Justitieutskottet'),
('SkU', 'Skatteutskottet'),
('KrU', 'Kulturutskottet');

-- Lägg till valkretsar (förenklade exempel)
INSERT INTO public.valkrets_kodlista (kod, namn) VALUES
('Stockholms kommun', 'Stockholms kommun'),
('Stockholms län', 'Stockholms län'),
('Västra Götalands läns norra', 'Västra Götalands läns norra'),
('Västra Götalands läns södra', 'Västra Götalands läns södra'),
('Skåne läns västra', 'Skåne läns västra'),
('Skåne läns södra', 'Skåne läns södra'),
('Gotlands län', 'Gotlands län');

-- Förbättra synkroniseringstabell med API-specifika fält
ALTER TABLE public.sync_state 
ADD COLUMN IF NOT EXISTS api_endpoint TEXT,
ADD COLUMN IF NOT EXISTS filter_params JSONB,
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Lägg till tabell för batch-konfigurationer
CREATE TABLE public.batch_configs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  filters JSONB,
  batch_size INTEGER DEFAULT 50,
  date_from DATE,
  date_to DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Lägg till RLS policies för kodlistor (publik läsning)
ALTER TABLE public.parti_kodlista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doktyp_kodlista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utskott_kodlista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.valkrets_kodlista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to parti_kodlista" ON public.parti_kodlista FOR SELECT USING (true);
CREATE POLICY "Allow read access to doktyp_kodlista" ON public.doktyp_kodlista FOR SELECT USING (true);
CREATE POLICY "Allow read access to utskott_kodlista" ON public.utskott_kodlista FOR SELECT USING (true);
CREATE POLICY "Allow read access to valkrets_kodlista" ON public.valkrets_kodlista FOR SELECT USING (true);
CREATE POLICY "Allow read access to batch_configs" ON public.batch_configs FOR SELECT USING (true);

-- Optimera index för vanliga queries
CREATE INDEX IF NOT EXISTS idx_ledamoter_parti ON public.ledamoter(parti);
CREATE INDEX IF NOT EXISTS idx_ledamoter_valkrets ON public.ledamoter(valkrets);
CREATE INDEX IF NOT EXISTS idx_anforanden_intressent_id ON public.anforanden(intressent_id);
CREATE INDEX IF NOT EXISTS idx_anforanden_datum ON public.anforanden(datum);
CREATE INDEX IF NOT EXISTS idx_dokument_doktyp ON public.dokument(doktyp);
CREATE INDEX IF NOT EXISTS idx_dokument_datum ON public.dokument(datum);
CREATE INDEX IF NOT EXISTS idx_voteringar_intressent_id ON public.voteringar(intressent_id);
CREATE INDEX IF NOT EXISTS idx_voteringar_datum ON public.voteringar(votering_datum);
