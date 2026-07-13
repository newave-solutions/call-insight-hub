
CREATE TABLE public.call_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  raw_notes TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('saved','closed','resign','other')),
  customer_name TEXT,
  summary TEXT,
  agreement_length_months INTEGER,
  price_per_service NUMERIC(10,2),
  service_name TEXT,
  coupon TEXT,
  coupon_value TEXT,
  sentiment TEXT,
  key_points JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_logs TO authenticated;
GRANT ALL ON public.call_logs TO service_role;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_call_logs" ON public.call_logs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX call_logs_user_created ON public.call_logs (user_id, created_at DESC);
CREATE INDEX call_logs_user_category ON public.call_logs (user_id, category);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER call_logs_updated_at BEFORE UPDATE ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
