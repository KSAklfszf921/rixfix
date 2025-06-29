
-- First drop the materialized views that depend on the columns we need to change
DROP MATERIALIZED VIEW IF EXISTS mv_parti_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_activity CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_voting_stats CASCADE;

-- Update ledamoter table structure
ALTER TABLE ledamoter 
DROP COLUMN IF EXISTS bild_url_80,
DROP COLUMN IF EXISTS bild_url_192,
DROP COLUMN IF EXISTS biografi_xml_url;

ALTER TABLE ledamoter 
ADD COLUMN IF NOT EXISTS bild_url text,
ADD COLUMN IF NOT EXISTS biografi_url text;

-- Ensure mandatperioder has proper foreign key
ALTER TABLE mandatperioder 
DROP CONSTRAINT IF EXISTS mandatperioder_iid_fkey;

ALTER TABLE mandatperioder 
ADD CONSTRAINT mandatperioder_iid_fkey 
FOREIGN KEY (iid) REFERENCES ledamoter(iid);

-- Update uppdrag table structure
ALTER TABLE uppdrag 
DROP COLUMN IF EXISTS from_date,
DROP COLUMN IF EXISTS tom_date;

ALTER TABLE uppdrag 
ADD COLUMN IF NOT EXISTS from_datum date,
ADD COLUMN IF NOT EXISTS tom_datum date;

-- Ensure uppdrag has proper foreign key
ALTER TABLE uppdrag 
DROP CONSTRAINT IF EXISTS uppdrag_iid_fkey;

ALTER TABLE uppdrag 
ADD CONSTRAINT uppdrag_iid_fkey 
FOREIGN KEY (iid) REFERENCES ledamoter(iid);

-- Update kontaktuppgifter to have proper structure
ALTER TABLE kontaktuppgifter 
DROP CONSTRAINT IF EXISTS kontaktuppgifter_pkey;

ALTER TABLE kontaktuppgifter 
DROP CONSTRAINT IF EXISTS kontaktuppgifter_iid_fkey;

DROP TABLE IF EXISTS kontaktuppgifter;

CREATE TABLE kontaktuppgifter (
  iid text PRIMARY KEY REFERENCES ledamoter(iid),
  adress text,
  telefon text,
  epost text,
  created_at timestamp with time zone DEFAULT now()
);

-- Update anforanden table structure (now safe to drop columns)
ALTER TABLE anforanden 
DROP COLUMN IF EXISTS dok_datum,
DROP COLUMN IF EXISTS anforande;

ALTER TABLE anforanden 
ADD COLUMN IF NOT EXISTS datum date,
ADD COLUMN IF NOT EXISTS text text;

-- Ensure anforanden has proper foreign key
ALTER TABLE anforanden 
DROP CONSTRAINT IF EXISTS anforanden_intressent_id_fkey;

ALTER TABLE anforanden 
ADD CONSTRAINT anforanden_intressent_id_fkey 
FOREIGN KEY (intressent_id) REFERENCES ledamoter(iid);

-- Update voteringar table structure
ALTER TABLE voteringar 
DROP CONSTRAINT IF EXISTS voteringar_dok_id_fkey,
DROP CONSTRAINT IF EXISTS voteringar_intressent_id_fkey;

ALTER TABLE voteringar 
ADD CONSTRAINT voteringar_dok_id_fkey 
FOREIGN KEY (dok_id) REFERENCES dokument(dok_id),
ADD CONSTRAINT voteringar_intressent_id_fkey 
FOREIGN KEY (intressent_id) REFERENCES ledamoter(iid);

-- Recreate materialized views with updated column names
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_parti_stats AS
SELECT 
  parti,
  COUNT(*) as totalt_antal_anforanden,
  COUNT(DISTINCT talare) as antal_talare,
  MIN(datum) as forsta_anforande,
  MAX(datum) as senaste_anforande,
  EXTRACT(YEAR FROM datum) as ar
FROM anforanden 
WHERE parti IS NOT NULL AND datum IS NOT NULL
GROUP BY parti, EXTRACT(YEAR FROM datum);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_parti_stats_unique ON mv_parti_stats(parti, ar);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_activity AS
SELECT 
  DATE_TRUNC('month', datum) as manad,
  COUNT(*) as antal_anforanden,
  COUNT(DISTINCT talare) as antal_talare,
  COUNT(DISTINCT parti) as antal_partier
FROM anforanden 
WHERE datum IS NOT NULL
GROUP BY DATE_TRUNC('month', datum)
ORDER BY manad DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_monthly_activity_unique ON mv_monthly_activity(manad);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_voting_stats AS
SELECT 
  parti,
  rost,
  COUNT(*) as antal,
  EXTRACT(YEAR FROM votering_datum) as ar
FROM voteringar 
WHERE parti IS NOT NULL AND rost IS NOT NULL AND votering_datum IS NOT NULL
GROUP BY parti, rost, EXTRACT(YEAR FROM votering_datum);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_voting_stats_unique ON mv_voting_stats(parti, rost, ar);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_mandatperioder_iid ON mandatperioder(iid);
CREATE INDEX IF NOT EXISTS idx_uppdrag_iid ON uppdrag(iid);
CREATE INDEX IF NOT EXISTS idx_anforanden_intressent_id ON anforanden(intressent_id);
CREATE INDEX IF NOT EXISTS idx_voteringar_intressent_id ON voteringar(intressent_id);
CREATE INDEX IF NOT EXISTS idx_voteringar_dok_id ON voteringar(dok_id);
CREATE INDEX IF NOT EXISTS idx_anforanden_datum ON anforanden(datum);

-- Add table for tracking individual sync progress
CREATE TABLE IF NOT EXISTS sync_progress (
  id SERIAL PRIMARY KEY,
  sync_session_id TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  total_records INTEGER DEFAULT 0,
  processed_records INTEGER DEFAULT 0,
  failed_records INTEGER DEFAULT 0,
  current_status TEXT DEFAULT 'starting',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_sync_progress_session ON sync_progress(sync_session_id);
CREATE INDEX IF NOT EXISTS idx_sync_progress_type ON sync_progress(sync_type);
