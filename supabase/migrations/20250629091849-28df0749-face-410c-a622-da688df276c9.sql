
-- Skapa index för snabbare queries
CREATE INDEX IF NOT EXISTS idx_anforanden_datum ON anforanden(dok_datum);
CREATE INDEX IF NOT EXISTS idx_anforanden_parti ON anforanden(parti);
CREATE INDEX IF NOT EXISTS idx_anforanden_talare ON anforanden(talare);
CREATE INDEX IF NOT EXISTS idx_voteringar_datum ON voteringar(votering_datum);
CREATE INDEX IF NOT EXISTS idx_voteringar_parti ON voteringar(parti);
CREATE INDEX IF NOT EXISTS idx_ledamoter_parti ON ledamoter(parti);
CREATE INDEX IF NOT EXISTS idx_dokument_datum ON dokument(datum);
CREATE INDEX IF NOT EXISTS idx_dokument_typ ON dokument(doktyp);

-- Full-text search index för anföranden
CREATE INDEX IF NOT EXISTS idx_anforanden_fulltext ON anforanden 
  USING gin(to_tsvector('swedish', coalesce(anforande, '') || ' ' || coalesce(talare, '') || ' ' || coalesce(rubrik, '')));

-- Full-text search index för dokument
CREATE INDEX IF NOT EXISTS idx_dokument_fulltext ON dokument 
  USING gin(to_tsvector('swedish', coalesce(titel, '')));

-- Materialiserad vy för parti-statistik
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_parti_stats AS
SELECT 
  parti,
  COUNT(*) as totalt_antal_anforanden,
  COUNT(DISTINCT talare) as antal_talare,
  MIN(dok_datum) as forsta_anforande,
  MAX(dok_datum) as senaste_anforande,
  EXTRACT(YEAR FROM dok_datum) as ar
FROM anforanden 
WHERE parti IS NOT NULL AND dok_datum IS NOT NULL
GROUP BY parti, EXTRACT(YEAR FROM dok_datum);

-- Index för materialiserad vy
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_parti_stats_unique ON mv_parti_stats(parti, ar);

-- Materialiserad vy för månatlig aktivitet
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_activity AS
SELECT 
  DATE_TRUNC('month', dok_datum) as manad,
  COUNT(*) as antal_anforanden,
  COUNT(DISTINCT talare) as antal_talare,
  COUNT(DISTINCT parti) as antal_partier
FROM anforanden 
WHERE dok_datum IS NOT NULL
GROUP BY DATE_TRUNC('month', dok_datum)
ORDER BY manad DESC;

-- Index för månatlig aktivitet
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_monthly_activity_unique ON mv_monthly_activity(manad);

-- Materialiserad vy för röstningsstatistik
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_voting_stats AS
SELECT 
  parti,
  rost,
  COUNT(*) as antal,
  EXTRACT(YEAR FROM votering_datum) as ar
FROM voteringar 
WHERE parti IS NOT NULL AND rost IS NOT NULL AND votering_datum IS NOT NULL
GROUP BY parti, rost, EXTRACT(YEAR FROM votering_datum);

-- Index för röstningsstatistik
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_voting_stats_unique ON mv_voting_stats(parti, rost, ar);

-- Funktion för att uppdatera materialiserade vyer
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_parti_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_activity;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_voting_stats;
END;
$$ LANGUAGE plpgsql;

-- Tabell för att spåra API sync-status
CREATE TABLE IF NOT EXISTS api_sync_log (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'running',
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index för sync log
CREATE INDEX IF NOT EXISTS idx_api_sync_log_status ON api_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_api_sync_log_type ON api_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_api_sync_log_started ON api_sync_log(started_at DESC);

-- Tabell för att konfigurera sync-inställningar
CREATE TABLE IF NOT EXISTS sync_config (
  id SERIAL PRIMARY KEY,
  sync_type TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT true,
  last_sync_date TIMESTAMP WITH TIME ZONE,
  sync_interval_hours INTEGER DEFAULT 24,
  max_records_per_batch INTEGER DEFAULT 1000,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lägg till grundkonfiguration för sync
INSERT INTO sync_config (sync_type, sync_interval_hours, max_records_per_batch) 
VALUES 
  ('ledamoter', 168, 100),  -- Veckovis för ledamöter
  ('anforanden', 24, 500),  -- Daglig för anföranden
  ('voteringar', 24, 500),  -- Daglig för voteringar
  ('dokument', 24, 200)     -- Daglig för dokument
ON CONFLICT (sync_type) DO NOTHING;
