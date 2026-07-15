ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS call_date timestamptz,
  ADD COLUMN IF NOT EXISTS date_source text NOT NULL DEFAULT 'auto';