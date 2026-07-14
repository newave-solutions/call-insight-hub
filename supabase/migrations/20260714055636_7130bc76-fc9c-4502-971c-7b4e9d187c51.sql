ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS follow_up_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_notes text,
  ADD COLUMN IF NOT EXISTS coupon_amount numeric;