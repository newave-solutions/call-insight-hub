import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const AnalysisSchema = z.object({
  category: z.enum(["saved", "closed", "resign", "other"]),
  customer_name: z.string().nullable(),
  customer_id: z.string().nullable(),
  summary: z.string(),
  agreement_length_months: z.number().nullable(),
  price_per_service: z.number().nullable(),
  service_name: z.string().nullable(),
  coupon: z.string().nullable(),
  coupon_value: z.string().nullable(),
  coupon_amount: z.number().nullable(),
  follow_up_needed: z.boolean(),
  follow_up_notes: z.string().nullable(),
  sentiment: z.string().nullable(),
  key_points: z.array(z.string()),
});

function getModel() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  return gateway("google/gemini-3-flash-preview");
}

const SYSTEM_PROMPT = `You are an assistant that reads customer service / retention call notes and extracts structured data.

Categorize the call into exactly one of:
- "saved": customer was going to cancel but was retained / saved from cancellation.
- "closed": account or subscription was closed / canceled.
- "resign": customer signed a new agreement or renewed with new terms.
- "other": none of the above (general inquiry, complaint, info call, etc.).

Extract, when discussed:
- customer_name (person or account name, null if unknown)
- customer_id (external account/customer ID or number mentioned in the notes, null if none)
- agreement_length_months (integer months; convert "1 year"=12, "2 years"=24)
- price_per_service (monthly/service price as a number; null if not stated)
- service_name (plan/service name)
- coupon (coupon code or promo name if discussed, null otherwise). In this business a "coupon" is a discount/credit applied on the Field Routes platform toward a future service.
- coupon_value (human-readable form, e.g. "50% off next service", "$25 credit")
- coupon_amount (the discount as a dollar NUMBER the rep will enter on Field Routes. If the notes say "50% off next regular service" and price_per_service is 120, coupon_amount = 60. If "$25 off", coupon_amount = 25. Null if not computable.)
- follow_up_needed (true if the notes indicate a callback, action item, or unresolved issue)
- follow_up_notes (short description of what to follow up on, null if none)
- sentiment (short: "positive"/"neutral"/"negative"/"frustrated"/"happy")
- summary (2-3 sentence summary)
- key_points (array of 3-6 short bullet points highlighting what mattered)

Return null for fields not clearly present in the notes. Do not invent values.`;

export const analyzeAndSaveCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ notes: z.string().min(3) }).parse(input))
  .handler(async ({ data, context }) => {
    const model = getModel();
    const { output } = await generateText({
      model,
      output: Output.object({ schema: AnalysisSchema }),
      system: SYSTEM_PROMPT,
      prompt: `Call notes:\n\n${data.notes}`,
    });

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
        follow_up_needed: output.follow_up_needed,
        follow_up_notes: output.follow_up_notes,
        sentiment: output.sentiment,
        key_points: output.key_points,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

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
        "You are a retention analyst. Given a list of call log summaries, produce concise, actionable insights in markdown. Include: overall trends, patterns in saves vs closes vs resigns, common reasons customers cancel, what's working to save them, coupon effectiveness, and 3 concrete recommendations. Be specific and reference numbers where possible. Keep it under 400 words.",
      prompt: `Here are the last ${logs.length} calls as JSON:\n\n${JSON.stringify(logs, null, 2)}`,
    });

    return { insights: text };
  });