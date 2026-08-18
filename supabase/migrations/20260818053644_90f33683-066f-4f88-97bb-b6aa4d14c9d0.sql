CREATE TABLE public.call_log_themes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_log_id UUID NOT NULL REFERENCES public.call_logs(id) ON DELETE CASCADE,
  theme TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'mentioned',
  is_cancel_driver BOOLEAN NOT NULL DEFAULT false,
  quote TEXT,
  entity_type TEXT,
  entity_name TEXT,
  customer_id TEXT,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_log_themes TO authenticated;
GRANT ALL ON public.call_log_themes TO service_role;

ALTER TABLE public.call_log_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_call_log_themes" ON public.call_log_themes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX call_log_themes_user_occurred_idx ON public.call_log_themes (user_id, occurred_at DESC);
CREATE INDEX call_log_themes_user_theme_idx ON public.call_log_themes (user_id, theme);
CREATE INDEX call_log_themes_call_log_idx ON public.call_log_themes (call_log_id);

CREATE TABLE public.pattern_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  window_start DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, alert_key, window_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pattern_alerts TO authenticated;
GRANT ALL ON public.pattern_alerts TO service_role;

ALTER TABLE public.pattern_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_pattern_alerts" ON public.pattern_alerts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX pattern_alerts_user_status_idx ON public.pattern_alerts (user_id, status, updated_at DESC);

CREATE TRIGGER pattern_alerts_set_updated_at
  BEFORE UPDATE ON public.pattern_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "own_call_logs" ON public.call_logs;
CREATE POLICY "own_call_logs" ON public.call_logs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS call_logs_user_call_date_idx ON public.call_logs (user_id, call_date DESC);
CREATE INDEX IF NOT EXISTS call_logs_user_customer_idx ON public.call_logs (user_id, customer_id);