import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PatternSignal = {
  theme: string;
  label: string;
  count30: number;
  countPrev30: number;
  count7: number;
  cancelDrivers: number;
  trend: "up" | "down" | "flat";
  quotes: string[];
  accounts: string[];
  entities: { name: string; type: string | null; count: number }[];
};

export const listPatternSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { themeLabel, canonicalTheme } = await import("./themes");
    const now = Date.now();
    const since = new Date(now - 120 * 86400000).toISOString();

    const [{ data: themes, error }, { data: alerts }] = await Promise.all([
      context.supabase
        .from("call_log_themes")
        .select("theme,severity,is_cancel_driver,quote,entity_type,entity_name,customer_id,occurred_at,call_log_id")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false }),
      context.supabase
        .from("pattern_alerts")
        .select("*")
        .in("status", ["open", "ack"])
        .order("updated_at", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);

    const rows = themes ?? [];
    const t7 = now - 7 * 86400000;
    const t30 = now - 30 * 86400000;
    const t60 = now - 60 * 86400000;

    // Fold legacy theme keys into the current cancellation-reason vocabulary so history counts.
    const byTheme = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = canonicalTheme(r.theme) ?? r.theme;
      const list = byTheme.get(key) ?? [];
      list.push(r);
      byTheme.set(key, list);
    }


    const signals: PatternSignal[] = [...byTheme.entries()]
      .map(([theme, list]) => {
        const at = (r: (typeof rows)[number]) => new Date(r.occurred_at).getTime();
        const cur = list.filter((r) => at(r) >= t30);
        const prev = list.filter((r) => at(r) >= t60 && at(r) < t30);
        const entityCounts = new Map<string, { name: string; type: string | null; count: number }>();
        for (const r of cur) {
          if (!r.entity_name) continue;
          const k = r.entity_name.toLowerCase();
          const e = entityCounts.get(k) ?? { name: r.entity_name, type: r.entity_type, count: 0 };
          e.count += 1;
          entityCounts.set(k, e);
        }
        return {
          theme,
          label: themeLabel(theme),
          count30: cur.length,
          countPrev30: prev.length,
          count7: list.filter((r) => at(r) >= t7).length,
          cancelDrivers: cur.filter((r) => r.is_cancel_driver).length,
          trend:
            cur.length > prev.length * 1.5 && cur.length >= 2
              ? ("up" as const)
              : cur.length * 1.5 < prev.length
                ? ("down" as const)
                : ("flat" as const),
          quotes: cur.map((r) => r.quote).filter((q): q is string => Boolean(q)).slice(0, 3),
          accounts: [...new Set(cur.map((r) => r.customer_id).filter((c): c is string => Boolean(c)))].slice(0, 10),
          entities: [...entityCounts.values()].sort((a, b) => b.count - a.count),
        };
      })
      .filter((s) => s.count30 > 0)
      .sort((a, b) => b.cancelDrivers - a.cancelDrivers || b.count30 - a.count30);

    // Weekly stacked series (last 8 weeks) for the churn-reason chart.
    const weeks: { week: string; start: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const start = now - i * 7 * 86400000;
      weeks.push({ week: new Date(start).toISOString().slice(5, 10), start });
    }
    const weekly = weeks.map((w, i) => {
      const end = i === weeks.length - 1 ? now + 86400000 : weeks[i + 1].start;
      const point: Record<string, string | number> = { week: w.week };
      for (const [theme, list] of byTheme) {
        const n = list.filter((r) => {
          const ts = new Date(r.occurred_at).getTime();
          return ts >= w.start && ts < end;
        }).length;
        if (n > 0) point[theme] = n;
      }
      return point;
    });

    return { signals, weekly, alerts: alerts ?? [], totalThemes: rows.length };
  });

export const updateAlertStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["open", "ack", "muted", "resolved"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("pattern_alerts")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// One-time (repeatable) scan of already-logged calls so the watchlist has history to work with.
// Deterministic detector only — no AI cost.
export const backfillThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { detectThemes } = await import("./themes");
    const { recordThemes } = await import("./patterns.server");

    const [{ data: logs, error }, { data: done }] = await Promise.all([
      context.supabase
        .from("call_logs")
        .select("id,raw_notes,summary,customer_id,call_date,created_at")
        .order("call_date", { ascending: false, nullsFirst: false })
        .limit(1000),
      context.supabase.from("call_log_themes").select("call_log_id"),
    ]);
    if (error) throw new Error(error.message);
    const already = new Set((done ?? []).map((d) => d.call_log_id));

    const entries = (logs ?? [])
      .filter((l) => !already.has(l.id))
      .map((l) => ({
        callLogId: l.id,
        customerId: l.customer_id,
        occurredAt: l.call_date ?? l.created_at,
        themes: detectThemes(`${l.raw_notes ?? ""}\n${l.summary ?? ""}`),
      }))
      .filter((e) => e.themes.length > 0);

    if (entries.length === 0) return { scanned: logs?.length ?? 0, tagged: 0 };
    await recordThemes(context.supabase, context.userId, entries);
    return { scanned: logs?.length ?? 0, tagged: entries.length };
  });
