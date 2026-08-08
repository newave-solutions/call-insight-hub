ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS account_label text,
  ADD COLUMN IF NOT EXISTS escalated_to_cem boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_sold boolean NOT NULL DEFAULT false;