
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';
UPDATE public.call_logs SET categories = ARRAY[category] WHERE (categories IS NULL OR array_length(categories,1) IS NULL) AND category IS NOT NULL;
CREATE INDEX IF NOT EXISTS call_logs_categories_gin ON public.call_logs USING GIN (categories);
