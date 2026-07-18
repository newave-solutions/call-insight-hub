import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const AnalysisSchema = z.object({
  // A single call can have multiple outcomes (e.g. one save + one resign, or two closes on a
  // multi-subscription household). Always return at least one entry.
  categories: z
    .array(z.enum(["saved", "closed", "resign", "lead", "cancel_pending", "other"]))
    .nullish()
    .default([]),
  // Primary outcome — first/most prominent one — kept for backward compatibility & display.
  category: z.enum(["saved", "closed", "resign", "lead", "cancel_pending", "other"]).default("other"),
  customer_name: z.string().nullish().default(null),
  customer_id: z.string().nullish().default(null),
  summary: z.string().nullish().default(""),
  agreement_length_months: z.number().nullish().default(null),
  price_per_service: z.number().nullish().default(null),
  service_name: z.string().nullish().default(null),
  coupon: z.string().nullish().default(null),
  coupon_value: z.string().nullish().default(null),
  coupon_amount: z.number().nullish().default(null),
  follow_up_needed: z.boolean().nullish().default(false),
  follow_up_notes: z.string().nullish().default(null),
  sentiment: z.string().nullish().default(null),
  key_points: z.array(z.string()).nullish().default([]),
  // ISO date string YYYY-MM-DD if the notes clearly mention when the call happened
  detected_date: z.string().nullish().default(null),
});

type Analysis = z.infer<typeof AnalysisSchema>;

function getModel() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return createLovableAiGatewayProvider(key)("google/gemini-2.5-flash-lite");
}

const SYSTEM_PROMPT = `You read customer service / retention call notes for SAELA PEST CONTROL and extract structured data.

DOMAIN — Saela Pest Control services (shorthand you WILL see):
- PP = Protection Program
- PPEOM / PP EOM = Protection Program Every Other Month
- PPEOM Conv / PP Conv = Protection Program convenience billing
- MOS = Mosquito Bundled
- PPMOS / PPM = Perimeter Plus Mosquito
- PPMPS = Perimeter Plus Mosquito Peak Season
- PP Rodent Plus = Protection Program Rodent Plus
- RYG = Rodent Yard Guard
When a shorthand code appears, populate service_name with the FULL name (e.g. "PPEOM" -> "Protection Program Every Other Month").

Common note shorthand:
- Cx = customer/client
- RS = re-service
- SS = Service Specialist, FM = Field Manager, BM = Branch Manager
- FHI = Free Home Inspection
- ROR = Right of Rescission
- PTI = Prior To Initial
- ETF = Early Termination Fee
- Initial = first service of an agreement (for a resign, this is the customer's next regular service)

Branches / regions (Kansas, Kansas East, Kansas West, Utah, Utah Central, Portland Main, Portland North, Dallas, etc.) are internal documentation. Include a branch when mentioned inside the summary; don't invent one.

Example note line: "1585346 PPEOM / Patrick Blue / Dallas / RS scheduled for 07/03"
 -> customer_id "1585346", customer_name "Patrick Blue", service_name "Protection Program Every Other Month", branch mention "Dallas", RS scheduled for 07/03.

Category (pick exactly one):
- "saved": customer wanted to cancel but was retained.
- "closed": account/subscription was closed or canceled.
- "resign": customer signed a new agreement or renewed with new terms.
- "lead": call was sent to Inside Sales for new subscription, upsell, or new service.
- "cancel_pending": cancellation is pending / not yet finalized (also "Pending Cancel"). Use this when the customer has requested cancellation but a decision, effective date, or final step is still outstanding.
- "other": general inquiry, complaint, info call, etc.

MULTI-OUTCOME CALLS (CRITICAL — do not skip):
A single call can produce MORE THAN ONE outcome and each outcome must be tallied separately.
Return every outcome in the "categories" array, in the order they occurred. Also set
"category" to the single most-important primary outcome (for display). Examples:
- Household has two subscriptions. Agent saves one, closes the other. -> categories: ["saved","closed"], category: "saved".
- Two subscriptions both closed. -> categories: ["closed","closed"], category: "closed".
- Two subscriptions both saved. -> categories: ["saved","saved"], category: "saved".
- Agent saves the customer AND signs a new agreement on the same call. -> categories: ["saved","resign"], category: "resign" (resign leads if it happened; otherwise "saved"). Both count for commission.
- Save + lead sent to Inside Sales for additional service -> categories: ["saved","lead"].
If only one outcome occurred, return a single-element array.

COUPONS / DISCOUNTS / FREE SERVICES (they are the same thing):
The words "coupon", "discount", and "free service" are used INTERCHANGEABLY. Treat any of
them as a coupon and populate coupon_amount in dollars:
- "one free service" / "1 free service" / "free regular service" = coupon_amount equals the
  full price of a regular service. If the notes give the price (e.g. $120), coupon_amount = 120.
  If two free services are given, coupon_amount = 2 * price.
- "50% off next service" on a $120 service -> coupon_amount = 60.
- "$25 off" -> coupon_amount = 25.
- "$0 initial" / "waived initial" -> coupon_amount = the waived dollar amount if stated.
If a price is not stated but a free service is clearly offered, still set coupon = "1 free service"
(or similar) and coupon_value = "one free regular service", and leave coupon_amount = null
ONLY when no price is anywhere in the notes. Otherwise compute it.

IMPORTANT — the notes may contain multiple sections. A "Summary" section is auto-generated by another copilot and can be inaccurate. Trust the agent-written sections MORE: pay special attention to any "Resolution", "Result", "Outcome", "Disposition", or "Action Taken" section. When those conflict with the Summary, the Resolution/Result wins.

Extract when discussed:
- customer_name, customer_id (Saela IDs are typically 7 digits; also treat any leading numeric token before a "/" separator as the customer_id)
- agreement_length_months (integer months; "1 year"=12, "2 years"=24)
- price_per_service (number; null if not stated)
- service_name (expand any shorthand to full Saela service name)
- coupon (code/name), coupon_value (human readable e.g. "50% off next service"), coupon_amount (dollar number; "50% off" of a $120 service = 60; "$25 off" = 25; 0 if no discount)
- sentiment ("positive"/"neutral"/"negative"/"frustrated"/"happy")
- summary (2-3 sentences; reflect the Resolution/Result, not the copilot summary if they disagree)
- key_points (3-6 short bullets)
- detected_date: if the notes clearly mention when the call happened (e.g. "called 3/12/2025", "yesterday's call on Feb 4"), return ISO YYYY-MM-DD. Otherwise null. Do NOT guess.

follow_up_needed rules — be STRICT. Set true ONLY when:
- The call was escalated to a branch / manager / office and someone must call the customer back later, OR
- The customer explicitly asked to be called back at a later time, OR
- The notes explicitly state a specific pending action tied to this account in the near future.

Set follow_up_needed = false for ALL of these (they are normal work, not follow-ups):
- Applying a coupon / discount / credit
- Making a price change or resign
- Saving a customer with a standard offer
- Closing an account
- Sending a lead to Inside Sales (unless the notes also say to personally call back)
- Any completed action

If follow_up_needed is false, follow_up_notes must be null.

Return JSON matching the schema exactly. Use null for missing text; 0 for coupon_amount when no discount; false for follow_up_needed when nothing is truly pending.`;

async function runExtraction(notes: string): Promise<Analysis> {
  const model = getModel();
  try {
    const res = await generateObject({ model, schema: AnalysisSchema, system: SYSTEM_PROMPT, prompt: `Call notes:\n\n${notes}` });
    return normalize(res.object);
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      const raw = (err as { text?: string }).text ?? "";
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = match ? safeJson(match[0]) : null;
      return normalize(AnalysisSchema.parse(parsed ?? {}));
    }
    throw err;
  }
}

function normalize(a: Analysis): Analysis {
  const cats = Array.isArray(a.categories) && a.categories.length > 0 ? a.categories : [a.category];
  return { ...a, categories: cats, category: cats[0] };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// Resolve a final call_date + date_source from user override, model detection, or fallback
function resolveDate(userDate: string | null | undefined, detected: string | null | undefined): { call_date: string; date_source: string } {
  if (userDate) {
    const d = new Date(userDate);
    if (!Number.isNaN(d.getTime())) return { call_date: d.toISOString(), date_source: "user_selected" };
  }
  if (detected) {
    const d = new Date(detected);
    if (!Number.isNaN(d.getTime())) return { call_date: d.toISOString(), date_source: "detected" };
  }
  return { call_date: new Date().toISOString(), date_source: "auto" };
}

export const analyzeAndSaveCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ notes: z.string().min(3), callDate: z.string().nullish() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const output = await runExtraction(data.notes);
    const { call_date, date_source } = resolveDate(data.callDate ?? null, output.detected_date ?? null);

    const { data: row, error } = await context.supabase
      .from("call_logs")
      .insert({
        user_id: context.userId,
        raw_notes: data.notes,
        category: output.category,
        categories: output.categories ?? [output.category],
        customer_name: output.customer_name,
        customer_id: output.customer_id,
        summary: output.summary,
        agreement_length_months: output.agreement_length_months,
        price_per_service: output.price_per_service,
        service_name: output.service_name,
        coupon: output.coupon,
        coupon_value: output.coupon_value,
        coupon_amount: output.coupon_amount,
        follow_up_needed: output.follow_up_needed ?? false,
        follow_up_notes: (output.follow_up_needed ?? false) ? output.follow_up_notes : null,
        sentiment: output.sentiment,
        key_points: output.key_points,
        call_date,
        date_source,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

export const bulkImportCallLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      items: z
        .array(z.object({ notes: z.string().min(3), callDate: z.string().nullish() }))
        .min(1)
        .max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Run extractions concurrently in small batches to stay fast without overwhelming the model.
    const results: Analysis[] = new Array(data.items.length);
    const concurrency = 6;
    let i = 0;
    async function worker() {
      while (i < data.items.length) {
        const idx = i++;
        try {
          results[idx] = await runExtraction(data.items[idx].notes);
        } catch {
          results[idx] = AnalysisSchema.parse({});
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, data.items.length) }, worker));

    const rows = data.items.map((item, idx) => {
      const out = results[idx];
      const { call_date, date_source } = resolveDate(item.callDate ?? null, out.detected_date ?? null);
      return {
        user_id: context.userId,
        raw_notes: item.notes,
        category: out.category,
        categories: out.categories ?? [out.category],
        customer_name: out.customer_name,
        customer_id: out.customer_id,
        summary: out.summary,
        agreement_length_months: out.agreement_length_months,
        price_per_service: out.price_per_service,
        service_name: out.service_name,
        coupon: out.coupon,
        coupon_value: out.coupon_value,
        coupon_amount: out.coupon_amount,
        follow_up_needed: out.follow_up_needed ?? false,
        follow_up_notes: (out.follow_up_needed ?? false) ? out.follow_up_notes : null,
        sentiment: out.sentiment,
        key_points: out.key_points,
        call_date,
        date_source,
      };
    });

    const { error, data: inserted } = await context.supabase.from("call_logs").insert(rows).select();
    if (error) throw new Error(error.message);
    return { inserted: inserted?.length ?? 0 };
  });

export const listCallLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("call_logs")
      .select("*")
      .order("call_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("call_logs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      customer_name: z.string().nullish(),
      customer_id: z.string().nullish(),
      category: z.enum(["saved", "closed", "resign", "lead", "cancel_pending", "other"]).optional(),
      summary: z.string().nullish(),
      service_name: z.string().nullish(),
      price_per_service: z.number().nullish(),
      agreement_length_months: z.number().int().nullish(),
      coupon: z.string().nullish(),
      coupon_value: z.string().nullish(),
      coupon_amount: z.number().nullish(),
      follow_up_needed: z.boolean().optional(),
      follow_up_notes: z.string().nullish(),
      sentiment: z.string().nullish(),
      call_date: z.string().nullish(),
    })
    .partial(),
});

export const updateCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const patch: import("@/integrations/supabase/types").TablesUpdate<"call_logs"> = { ...data.patch };
    if (patch.follow_up_needed === false) patch.follow_up_notes = null;
    if (typeof patch.call_date === "string" && patch.call_date) {
      patch.date_source = "user_selected";
    }
    const { data: row, error } = await context.supabase
      .from("call_logs")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const generateInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: logs, error } = await context.supabase
      .from("call_logs")
      .select("category,customer_name,summary,agreement_length_months,price_per_service,service_name,coupon,coupon_value,coupon_amount,sentiment,follow_up_needed,key_points,call_date,created_at")
      .order("call_date", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    if (!logs || logs.length === 0) {
      return { daily: "Log at least one call to unlock AI insights.", overall: "", score: null as number | null, scoreLabel: "" };
    }

    const model = getModel();

    // Today window
    const todayKey = new Date().toISOString().slice(0, 10);
    const todaysLogs = logs.filter((l) => (l.call_date ?? l.created_at).slice(0, 10) === todayKey);

    const [dailyRes, overallRes] = await Promise.all([
      generateText({
        model,
        system:
          "You are a retention coach for SAELA PEST CONTROL giving a concise DAILY briefing. Evaluate calls through the Saela Way customer-experience values: building value, ownership, empathy, professionalism, and clear communication. Use GitHub-flavored MARKDOWN with ## sections, **bold**, and - bullets. Cover: today's totals by category, standout calls, Saela Way wins & misses (call out where the agent showed ownership/empathy/building value — or missed the chance to), and 2-3 tips for tomorrow. Keep under 240 words. Do not wrap in a code fence.",
        prompt: `Today (${todayKey}) — ${todaysLogs.length} calls:\n${JSON.stringify(todaysLogs, null, 2)}\n\nRecent context (last 30 calls):\n${JSON.stringify(logs.slice(0, 30), null, 2)}`,
      }),
      generateText({
        model,
        system:
          "You are a retention analyst for SAELA PEST CONTROL producing an OVERALL PERFORMANCE REVIEW across the agent's entire logged history. Grade the agent against the Saela Way customer-experience values: **building value**, **ownership**, **empathy**, **professionalism**, and **clear communication** — in addition to hard metrics. Use GitHub-flavored MARKDOWN with ## headings and - bullets. Sections REQUIRED: `## Trends over time` (month-over-month or week-over-week movement), `## Saela Way scorecard` (one bullet per value: building value, ownership, empathy, professionalism, communication — each with a short assessment and evidence from the notes), `## Strengths`, `## Weaknesses`, `## Coaching recommendations`. Then a final line exactly: `SCORE: <integer 0-100> — <one-line label>`. Score blends save rate, resign volume, coupon effectiveness, lead generation, follow-through, consistency AND Saela Way behavior. Under 360 words. Do not wrap in a code fence.",
        prompt: `Full history (${logs.length} calls):\n${JSON.stringify(logs, null, 2)}`,
      }),
    ]);

    // Parse score off the overall text
    const scoreMatch = overallRes.text.match(/SCORE:\s*(\d{1,3})\s*(?:—|-|:)?\s*([^\n]*)/i);
    const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : null;
    const scoreLabel = scoreMatch ? scoreMatch[2].trim() : "";
    const overallCleaned = overallRes.text.replace(/SCORE:\s*\d{1,3}\s*(?:—|-|:)?\s*[^\n]*/i, "").trim();

    return { daily: dailyRes.text, overall: overallCleaned, score, scoreLabel };
  });
