
-- Create sync_state table to track batch synchronization progress
CREATE TABLE public.sync_state (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL UNIQUE,
  last_offset INTEGER DEFAULT 0,
  last_sync_date TIMESTAMP WITH TIME ZONE,
  total_fetched INTEGER DEFAULT 0,
  is_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Insert initial state for each sync type
INSERT INTO public.sync_state (sync_type, last_offset, total_fetched) VALUES
('members', 0, 0),
('debates', 0, 0),
('documents', 0, 0),
('votes', 0, 0);

-- Add RLS policies
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

-- Allow read access to sync state (no user-specific data)
CREATE POLICY "Allow read access to sync_state" 
  ON public.sync_state 
  FOR SELECT 
  USING (true);

-- Add unique constraints to prevent duplicates in main tables
-- Using DO blocks to handle existing constraints gracefully
DO $$
BEGIN
    -- Add unique constraint for ledamoter if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledamoter_iid_unique') THEN
        ALTER TABLE public.ledamoter ADD CONSTRAINT ledamoter_iid_unique UNIQUE (iid);
    END IF;

    -- Add unique constraint for anforanden if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anforanden_anforande_id_unique') THEN
        ALTER TABLE public.anforanden ADD CONSTRAINT anforanden_anforande_id_unique UNIQUE (anforande_id);
    END IF;

    -- Add unique constraint for dokument if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dokument_dok_id_unique') THEN
        ALTER TABLE public.dokument ADD CONSTRAINT dokument_dok_id_unique UNIQUE (dok_id);
    END IF;

    -- Add composite unique constraint for voteringar if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voteringar_unique') THEN
        ALTER TABLE public.voteringar ADD CONSTRAINT voteringar_unique UNIQUE (votering_id, intressent_id);
    END IF;
END $$;
