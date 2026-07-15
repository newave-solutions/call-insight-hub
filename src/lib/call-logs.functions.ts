import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

// Every field is nullish + defaulted so a slightly-off model response
// still parses instead of throwing AI_NoObjectGeneratedError.
const AnalysisSchema = z.object({
  category: z
    .enum(["saved", "closed", "resign", "lead", "other"])
    .default("other"),
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
});

type Analysis = z.infer<typeof AnalysisSchema>;

function getModel() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  // Flash-lite is the fastest current Gemini tier for structured extraction.
  return gateway("google/gemini-2.5-flash-lite");
}

const SYSTEM_PROMPT = `You are an assistant that reads customer service / retention call notes and extracts structured data.

Categorize the call into exactly one of:
- "saved": customer was going to cancel but was retained / saved from cancellation.
- "closed": account or subscription was closed / canceled.
- "resign": customer signed a new agreement or renewed with new terms.
- "lead": call was forwarded/sent to Inside Sales for more information on a new subscription, upsell, or new service (a sales lead).
- "other": none of the above (general inquiry, complaint, info call, etc.).

Extract, when discussed:
- customer_name (person or account name, null if unknown)
- customer_id (external account/customer ID or number mentioned in the notes, null if none)
- agreement_length_months (integer months; convert "1 year"=12, "2 years"=24)
- price_per_service (monthly/service price as a number; null if not stated)
- service_name (plan/service name)
- coupon (coupon code or promo name if discussed, null otherwise). In this business a "coupon" is a discount/credit applied on the Field Routes platform toward a future service.
- coupon_value (human-readable form, e.g. "50% off next service", "$25 credit")
- coupon_amount (the discount as a dollar NUMBER the rep will enter on Field Routes. If the notes say "50% off next regular service" and price_per_service is 120, coupon_amount = 60. If "$25 off", coupon_amount = 25. If no coupon/discount was discussed, return 0.)
- follow_up_needed (true only if the notes indicate a callback, action item, or unresolved issue; otherwise false)
- follow_up_notes (short description of what to follow up on, null if none)
- sentiment (short: "positive"/"neutral"/"negative"/"frustrated"/"happy")
- summary (2-3 sentence summary)
- key_points (array of 3-6 short bullet points highlighting what mattered)

CRITICAL: Return a JSON object that exactly matches the schema. Use null for text fields not present in the notes; use 0 for coupon_amount when there is no discount; use false for follow_up_needed when nothing needs to be followed up. Do not invent values.`;

export const analyzeAndSaveCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ notes: z.string().min(3) }).parse(input))
  .handler(async ({ data, context }) => {
    const model = getModel();

    let output: Analysis;
    try {
      const res = await generateObject({
        model,
        schema: AnalysisSchema,
        system: SYSTEM_PROMPT,
        prompt: `Call notes:\n\n${data.notes}`,
      });
      output = res.object;
    } catch (err) {
      // Fallback: salvage whatever JSON the model produced, then parse
      // with our lenient schema so we never crash the request.
      if (NoObjectGeneratedError.isInstance(err)) {
        const raw = (err as { text?: string }).text ?? "";
        const match = raw.match(/\{[\s\S]*\}/);
        const parsed = match ? safeJson(match[0]) : null;
        output = AnalysisSchema.parse(parsed ?? {});
      } else {
        throw err;
      }
    }

    const { data: row, error } = await context.supabase
      .from("call_logs")
      .insert({
        user_id: context.userId,
        raw_notes: data.notes,
        category: output.category,
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
        follow_up_notes: output.follow_up_notes,
        sentiment: output.sentiment,
        key_points: output.key_points,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const listCallLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("call_logs")
      .select("*")
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

export const generateInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: logs, error } = await context.supabase
      .from("call_logs")
      .select("category,customer_name,summary,agreement_length_months,price_per_service,service_name,coupon,coupon_value,sentiment,key_points,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    if (!logs || logs.length === 0) {
      return { insights: "Log at least one call to unlock AI insights." };
    }

    const model = getModel();
    const { text } = await generateText({
      model,
      system:
        "You are a retention analyst. Given a list of call log summaries, produce concise, actionable insights formatted as GitHub-flavored MARKDOWN. Use `##` section headings, `**bold**` for key terms, `-` bullet lists, and short paragraphs. Include: overall trends, patterns in saves vs closes vs resigns vs leads, common reasons customers cancel, what's working to save them, coupon effectiveness, lead pipeline volume, and 3 concrete recommendations. Be specific and reference numbers where possible. Keep it under 400 words. Do not wrap the whole reply in a code fence.",
      prompt: `Here are the last ${logs.length} calls as JSON:\n\n${JSON.stringify(logs, null, 2)}`,
    });

    return { insights: text };
  });