import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { THEME_META, themeLabel, type DetectedTheme, type Theme } from "./themes";

type Client = SupabaseClient<Database>;

export type AlertHit = {
  kind: "theme" | "entity" | "account";
  key: string;
  label: string;
  count: number;
  message: string;
};

function monthStart(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * Persist the themes extracted from one call, then re-evaluate the recurring-issue thresholds.
 * Returns the alerts that just crossed a threshold so the UI can surface them immediately.
 */
export async function recordThemes(
  supabase: Client,
  userId: string,
  entries: {
    callLogId: string;
    customerId: string | null;
    occurredAt: string;
    themes: DetectedTheme[];
  }[],
): Promise<AlertHit[]> {
  const rows = entries.flatMap((e) =>
    (e.themes ?? []).map((t) => ({
      user_id: userId,
      call_log_id: e.callLogId,
      theme: t.theme,
      severity: t.severity ?? "mentioned",
      is_cancel_driver: t.is_cancel_driver ?? false,
      quote: t.quote ?? null,
      entity_type: t.entity_type ?? null,
      entity_name: t.entity_name ?? null,
      customer_id: e.customerId,
      occurred_at: e.occurredAt,
    })),
  );
  if (rows.length === 0) return [];

  const { error } = await supabase.from("call_log_themes").insert(rows);
  if (error) throw new Error(error.message);

  const windowStart = monthStart(entries[0]?.occurredAt ?? new Date().toISOString());
  const since = `${windowStart}T00:00:00.000Z`;

  const { data: recent } = await supabase
    .from("call_log_themes")
    .select("theme,severity,is_cancel_driver,quote,entity_type,entity_name,customer_id,call_log_id")
    .gte("occurred_at", since);

  const scope = recent ?? [];
  const touched = new Set(rows.map((r) => r.theme));
  const hits: AlertHit[] = [];

  // 1. Theme volume in the current month.
  for (const theme of touched) {
    const matches = scope.filter((r) => r.theme === theme);
    const drivers = matches.filter((r) => r.is_cancel_driver).length;
    if (matches.length < 3 && drivers < 2) continue;
    const label = themeLabel(theme);
    const upserted = await upsertAlert(supabase, userId, "theme", theme, windowStart, matches.length, {
      label,
      hint: THEME_META[theme as Theme]?.hint ?? null,
      cancel_drivers: drivers,
      quotes: matches.map((m) => m.quote).filter(Boolean).slice(0, 3),
      accounts: [...new Set(matches.map((m) => m.customer_id).filter(Boolean))].slice(0, 8),
    });
    if (upserted)
      hits.push({
        kind: "theme",
        key: theme,
        label,
        count: matches.length,
        message: `${ordinal(matches.length)} "${label}" mention this month${drivers > 0 ? ` — ${drivers} named it as the cancel reason` : ""}.`,
      });
  }

  // 2. The same account raising the same issue on more than one call.
  for (const r of rows) {
    if (!r.customer_id) continue;
    const calls = new Set(
      scope.filter((s) => s.customer_id === r.customer_id && s.theme === r.theme).map((s) => s.call_log_id),
    );
    if (calls.size < 2) continue;
    const label = themeLabel(r.theme);
    const key = `${r.customer_id}:${r.theme}`;
    const upserted = await upsertAlert(supabase, userId, "account", key, windowStart, calls.size, {
      label: `${r.customer_id} — ${label}`,
      customer_id: r.customer_id,
      theme: r.theme,
      quotes: [r.quote].filter(Boolean),
    });
    if (upserted)
      hits.push({
        kind: "account",
        key,
        label: `${r.customer_id} — ${label}`,
        count: calls.size,
        message: `Account ${r.customer_id} has raised "${label}" on ${calls.size} separate calls — at-risk account.`,
      });
  }

  // 3. A named technician / route repeatedly attached to coachable complaints.
  for (const r of rows) {
    if (!r.entity_name || !THEME_META[r.theme as Theme]?.coaching) continue;
    const name = r.entity_name.toLowerCase();
    const matches = scope.filter(
      (s) => (s.entity_name ?? "").toLowerCase() === name && THEME_META[s.theme as Theme]?.coaching,
    );
    if (matches.length < 3) continue;
    const key = `${r.entity_type ?? "person"}:${name}`;
    const label = `${r.entity_name} (${r.entity_type ?? "named"})`;
    const upserted = await upsertAlert(supabase, userId, "entity", key, windowStart, matches.length, {
      label,
      entity_type: r.entity_type,
      entity_name: r.entity_name,
      themes: [...new Set(matches.map((m) => m.theme))],
      quotes: matches.map((m) => m.quote).filter(Boolean).slice(0, 3),
    });
    if (upserted)
      hits.push({
        kind: "entity",
        key,
        label,
        count: matches.length,
        message: `${r.entity_name} is named in ${matches.length} service complaints this month — coaching flag.`,
      });
  }

  return hits;
}

// Insert or bump an alert. Returns true when the alert is actionable right now (open/new),
// false when the user already muted or resolved it — muted patterns must stop nagging.
async function upsertAlert(
  supabase: Client,
  userId: string,
  kind: string,
  alertKey: string,
  windowStart: string,
  count: number,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("pattern_alerts")
    .select("id,status,count")
    .eq("kind", kind)
    .eq("alert_key", alertKey)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (!existing) {
    await supabase
      .from("pattern_alerts")
      .insert({ user_id: userId, kind, alert_key: alertKey, window_start: windowStart, count, payload, status: "open" });
    return true;
  }
  await supabase.from("pattern_alerts").update({ count, payload }).eq("id", existing.id);
  // Only re-surface acknowledged alerts when the count actually grew; never re-surface muted ones.
  return existing.status === "open" || (existing.status === "ack" && count > (existing.count ?? 0));
}
