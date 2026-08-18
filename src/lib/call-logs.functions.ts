import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { THEME_VALUES, SEVERITY_VALUES, ENTITY_TYPES, THEME_META, detectThemes, themeLabel } from "./themes";
import { recordThemes } from "./patterns.server";

export const CATEGORY_VALUES = [
  "saved", "closed", "resign", "reactivation", "lead", "cancel_pending", "pending_cancel",
  "reschedule", "reservice", "payment", "payment_promise", "billing_update", "freeze", "refund",
  "back_on_schedule", "inquiry", "escalation", "escalated_to_cem", "other",
] as const;

const CategoryZ = z.enum(CATEGORY_VALUES);

const AnalysisSchema = z.object({
  // A single call can have multiple outcomes (e.g. one save + one resign, or two closes on a
  // multi-subscription household). Always return at least one entry.
  categories: z.array(CategoryZ).nullish().default([]),
  // Primary outcome — first/most prominent one — kept for backward compatibility & display.
  category: CategoryZ.default("inquiry"),
  customer_name: z.string().nullish().default(null),
  customer_id: z.string().nullish().default(null),
  summary: z.string().nullish().default(""),
  agreement_length_months: z.number().nullish().default(null),
  price_per_service: z.number().nullish().default(null),
  service_name: z.string().nullish().default(null),
  coupon: z.string().nullish().default(null),
  coupon_value: z.string().nullish().default(null),
  coupon_amount: z.number().nullish().default(null),
  // CES commission tracking — payment collected on the call (outstanding balance cleared).
  payment_amount: z.number().nullish().default(null),
  // Refunds granted on the call.
  refund_amount: z.number().nullish().default(null),
  // Which property/account these outcomes belong to (a customer can own several accounts).
  account_label: z.string().nullish().default(null),
  // CES flagged a pending cancel and handed the account to a manager.
  escalated_to_cem: z.boolean().nullish().default(false),
  // A lead sent to sales that actually sold (commission bonus).
  lead_sold: z.boolean().nullish().default(false),
  follow_up_needed: z.boolean().nullish().default(false),
  follow_up_notes: z.string().nullish().default(null),
  sentiment: z.string().nullish().default(null),
  key_points: z.array(z.string()).nullish().default([]),
  // ISO date string YYYY-MM-DD if the notes clearly mention when the call happened
  detected_date: z.string().nullish().default(null),
  // True when neither the model nor the keyword parser could confidently classify the call.
  needs_review: z.boolean().nullish().default(false),
  // Voice-of-customer themes: WHY the customer called / why they want to leave, from a fixed
  // vocabulary so recurring issues can be counted across calls.
  themes: z
    .array(
      z.object({
        theme: z.enum(THEME_VALUES),
        severity: z.enum(SEVERITY_VALUES).nullish().default("mentioned"),
        is_cancel_driver: z.boolean().nullish().default(false),
        quote: z.string().nullish().default(null),
        entity_type: z.enum(ENTITY_TYPES).nullish().default(null),
        entity_name: z.string().nullish().default(null),
      }),
    )
    .nullish()
    .default([]),
});

type Analysis = z.infer<typeof AnalysisSchema>;

function getModel() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return createLovableAiGatewayProvider(key)("google/gemini-2.5-flash-lite");
}

const SYSTEM_PROMPT = `You read customer service / retention call notes for SAELA PEST CONTROL and extract structured data.

ROLES using this app (the same person moves between them depending on traffic):
- CES (Customer Experience Specialist) — front-line retention and service. Must make at least 3 retention
  attempts using GEOC (Gratitude, Empathy, Ownership, Clarity) before flagging an account as a Pending
  Cancel and escalating it to a CEM. Independent authority (no Team Lead approval): PP minimum $124.99,
  up to 30% off the next regular (REG) service, reschedule up to 2 weeks out inside the current month,
  change service frequency OR contract length, switchover PP $109.99 ($99.99 only to match a competitor),
  PTI / 3-day ROR PP minimum $114.99. Team Lead approval needed for: PP $109.99 (or $104.97 convenient
  billing), discounts above 30% up to 50%, rescheduling to any other day of the current month, changing
  frequency AND contract length together.
- CEM (Customer Experience Manager) — higher-level escalation point for accounts a CES could not save.
  Independent authority: PP minimum $109.99, up to 50% off OR a flat $80 discount on the next REG service,
  reschedule to any day in the current month, change frequency OR contract length, switchover PP $104.99
  ($80 discount only when matching a competitor), 3-day ROR PP $109.99 plus a free service, and
  reactivation of a subscription closed/frozen within the last 6 months. Team Lead approval needed for:
  a completely free next REG service, rescheduling outside the current month, changing frequency AND
  contract length together.
Commissions: CES earns on payments collected, signed resigns, and leads sent to sales (bonus if sold).
CEM earns all of those PLUS saves.

ACCOUNTS AND SUBSCRIPTIONS:
One customer may own multiple properties, and each property is its own account. One account may carry
multiple subscriptions, and each subscription has its own outcome. When the notes clearly describe more
than one property/account, set account_label to a short identifier for the one the outcomes belong to
(e.g. "Main St", "rental property", "account 2"); otherwise leave it null. Return one outcome entry per
subscription result.
COMPLETED vs OFFERED / DECLINED / FUTURE (READ THIS FIRST — most common mistake):
An outcome is tagged ONLY when the notes show it actually HAPPENED ON THIS CALL. Something that was
merely offered, quoted, discussed, presented as an option, declined by the customer, or left for the
future is NOT an outcome. Wording like "offered", "quoted", "presented", "discussed", "let them know
they can…", "they have the option to…", "if they call back", "within the next X months", "will call
back", "will pay later", "thinking about it", "declined", "refused", "not interested", "said no",
"did not accept/agree/sign", "sent for signature / waiting on signature" NEVER produces that tag.
In those cases record what actually happened instead — usually the real retention result
("cancel_pending", "pending_cancel", "closed") or "inquiry" if nothing changed on the account.
Concrete rules:
- "Offered 50% off, customer declined and cancelled" -> ["closed"] (no coupon applied, no save).
- "Told the customer they can call back within 6 months to reactivate" -> NOT a reactivation. That is
  a future option only. Tag the real result of the call (e.g. "closed" or "inquiry").
- "Sent the agreement, waiting on signature" -> NOT a resign. Set follow_up_needed = true instead.
- "Customer will pay next week" -> NOT a payment. It is an "inquiry" plus a follow-up note.
- A discount that was quoted but not applied -> leave coupon fields null.
When you are unsure whether something was completed, do NOT tag it — set needs_review = true.

CRITICAL: EVERY call gets at least one real outcome. NEVER return "other". If nothing else fits,
the call is an "inquiry" (customer had questions / doubts / wanted clarification). Pick EVERY
applicable outcome from the list below — multiple outcomes per call are normal and expected.

NOTE FORMATS you will receive (both are valid — read whichever you get):
1. A long call summary with sections (Summary / Resolution / Result).
2. A terse agent shorthand line, e.g.:
   "1585346 / John Doe / PPEOM / resign 119 / 50% off"
   "1585346 PP EOM Kansas East — save, coupon 1 free service ($139)"
   Parse a leading 7-ish-digit number as customer_id, a person name as customer_name, a service
   shorthand as service_name (expanded), a bare number after "resign"/"reduced to"/"$" as
   price_per_service, and "50%" / "100%" / "free service" / a dollar figure as the coupon.
   "119" or "reduced to 119" means the new price per service is $119 (that is a resign/price
   reduction, not a coupon, unless it says off/discount/free).

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

Categories — pick every outcome that applies (the same call can have several):
- "saved": the subscription was retained — the customer agreed to continue for AT LEAST 2 more services.
  This can be IMPLIED from the conversation (they accepted an offer and kept the plan) unless the customer
  explicitly said otherwise. If the customer only agreed to ONE more service and then wants to stop, that
  is "cancel_pending", NOT a save.
- "closed": account/subscription was closed, cancelled, or frozen (same retention result).
- "resign": the customer SIGNED a new agreement (or accepted new terms that were signed) on this call.
  Proof required: "signed", "agreement signed", "e-sign completed", "resigned at $X", "accepted and
  signed the new agreement". An agreement that was only sent, offered, quoted, or is awaiting a
  signature is NOT a resign — leave the tag off and set follow_up_needed = true.
- "reactivation": a previously closed/frozen/cancelled subscription was REOPENED ON THIS CALL. Manager
  authority, and only allowed within 6 months of the day it was closed/frozen. Telling a customer they
  may reactivate later (e.g. "you can call back within 6 months and reactivate") is a future option, NOT
  a reactivation — never tag it. If a real reactivation happened outside the 6-month window, still use
  "reactivation" and mention the gap in the summary.
- "lead": call was sent to Inside Sales for new subscription, upsell, or new service.
  Set lead_sold = true only if the notes say the lead actually sold.
- "cancel_pending": the customer said on THIS call that they'll take the next service and then cancel — cancellation is scheduled/pending after the next visit.
- "pending_cancel": the account was flagged as pending cancel on the retention doc BEFORE this call, and the agent is following up to offer options. If the notes mention "from the doc", "the doc", "retention doc", or list the customer as an existing pending cancel, use this — NOT cancel_pending.
- "reschedule": a service was rescheduled or scheduled (new appointment date).
- "reservice": a free re-service was scheduled between regular services (no charge to customer).
- "payment": a payment / outstanding balance was actually TAKEN on the call (card ran, balance cleared).
  Populate payment_amount with the dollar amount collected (numeric). A promise to pay later is NOT a
  payment: leave the tag off, use "inquiry", and set follow_up_needed = true with a short note.
- "payment_promise": FORBIDDEN. Never return this value (see the payment rule above).
- "billing_update": billing information (card, address, autopay) was updated. If a payment was ALSO taken, include BOTH "billing_update" and "payment".
- FROZEN / PAUSED accounts: a frozen, paused, or seasonal-hold account is the SAME retention result as a
  close. Return "closed" for it (never "freeze") and mention the freeze in the summary.
- "refund": a refund was issued to the customer. Populate refund_amount with the refunded dollar amount (numeric).
- "back_on_schedule": customer was on "the doc" and could not be reached after 3 attempts, so they were placed back on regular schedule. Notes may say "transferred from the doc", "back on schedule", "put back on schedule".
- "inquiry": customer had doubts/questions, wanted clarification, general info, a complaint, or product/value education — nothing else changed on the account. Use this instead of "other".
- "escalation": call was escalated / transferred to a branch, field manager, or another department.
- "escalated_to_cem": the agent made their retention attempts (3+ GEOC attempts), could not save the
  subscription, flagged it as a pending cancel, and handed it to a Customer Experience Manager. Include
  "cancel_pending" or "pending_cancel" alongside it when that applies, and set escalated_to_cem = true.
- "other": FORBIDDEN. Never return this value.

MULTI-OUTCOME CALLS (CRITICAL — do not skip):
A single call can produce MORE THAN ONE outcome and each outcome must be tallied separately.
Return every outcome in the "categories" array, in the order they occurred. Also set
"category" to the single most-important primary outcome (for display). Examples:
- Household has two subscriptions. Agent saves one, closes the other. -> categories: ["saved","closed"], category: "saved".
- Two subscriptions both closed. -> categories: ["closed","closed"], category: "closed".
- Two subscriptions both saved. -> categories: ["saved","saved"], category: "saved".
- Agent saves the customer AND signs a new agreement on the same call. -> categories: ["saved","resign"], category: "resign" (resign leads if it happened; otherwise "saved"). Both count for commission.
- Save + lead sent to Inside Sales for additional service -> categories: ["saved","lead"].
- Billing card updated + payment of $185 taken on outstanding balance -> categories: ["billing_update","payment"], payment_amount: 185.
- Offered a resign at $119, customer wants to think about it -> categories: ["inquiry"], no resign tag, follow_up_needed: true.
- Reschedule + free re-service scheduled -> categories: ["reschedule","reservice"].
- Pending cancel from the doc, agent froze the account -> categories: ["pending_cancel","closed"] (frozen = closed).
- Customer refunded $60 and rescheduled -> categories: ["refund","reschedule"], refund_amount: 60.
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
- payment_amount: dollars collected on this call for an outstanding balance / past-due payment. Only set when a payment was actually taken.
- refund_amount: dollars refunded to the customer on this call. Only set when a refund was actually issued.
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

THEMES — WHY the customer called / why they are leaving (voice of customer):
Separately from the outcome, return every applicable theme so recurring problems can be counted
across calls. Use ONLY these theme keys:
${Object.entries(THEME_META).map(([k, v]) => `- ${k}: ${v.hint}`).join("\n")}
For each theme return:
- severity: "mentioned" (stated in passing), "frustrated" (clearly upset about it), or
  "cancel_driver" (this is the reason they want to cancel / did cancel).
- is_cancel_driver: true only when this theme is the stated reason for cancelling or wanting to.
- quote: a SHORT verbatim phrase from the notes that proves the theme (max ~25 words). Never invent.
- entity_type + entity_name when the notes name a person, branch, route, or plan tied to the
  complaint (e.g. tech "Jose", "Kansas East" route). Leave both null when nothing is named.
Themes are about the customer's experience and reasons, NOT about the outcome. A call can have
zero themes (return []) — do not force one. Do not invent a theme from an agent action.

Return JSON matching the schema exactly. Use null for missing text; 0 for coupon_amount when no discount; false for follow_up_needed when nothing is truly pending.`;

async function runExtraction(notes: string): Promise<Analysis> {
  try {
    const model = getModel();
    const res = await generateObject({ model, schema: AnalysisSchema, system: SYSTEM_PROMPT, prompt: `Call notes:\n\n${notes}` });
    return normalize(mergeHeuristics(res.object, notes));
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      const raw = (err as { text?: string }).text ?? "";
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = match ? safeJson(match[0]) : null;
      if (parsed) {
        const lenient = AnalysisSchema.safeParse(parsed);
        if (lenient.success) return normalize(mergeHeuristics(lenient.data, notes));
      }
    }
    // Never lose a call: fall back to a heuristic read of the notes.
    return normalize(heuristicExtract(notes));
  }
}

// When the model answered, still let the deterministic parser add outcomes it clearly missed,
// and fall back entirely when the model produced nothing usable.
function mergeHeuristics(a: Analysis, notes: string): Analysis {
  const modelCats = (Array.isArray(a.categories) && a.categories.length > 0 ? a.categories : [a.category])
    .filter((c): c is Analysis["category"] => Boolean(c) && c !== "other");
  const { cats: keywordCats } = keywordCategories(notes);

  if (modelCats.length === 0) {
    const fallback = heuristicExtract(notes);
    return { ...a, categories: fallback.categories, category: fallback.category, needs_review: fallback.needs_review };
  }

  const merged = [...modelCats];
  for (const c of keywordCats) {
    // "inquiry" is the catch-all; never add it on top of a real outcome.
    if (c !== "inquiry" && !merged.includes(c)) merged.push(c);
  }
  const real = merged.filter((c) => c !== "inquiry");
  // Themes: keep everything the model found, and add keyword-detected themes it missed.
  const modelThemes = a.themes ?? [];
  const themes = [...modelThemes];
  for (const t of detectThemes(notes)) {
    if (!themes.some((m) => m.theme === t.theme)) themes.push(t);
  }
  return {
    ...a,
    themes,
    categories: real.length > 0 ? real : merged,
    category: (real.length > 0 ? real : merged)[0],
    needs_review: real.length === 0 && keywordCats.length === 0,
  };
}

// Last-resort local parser so a call ALWAYS gets logged even if the model is unavailable.
const SERVICE_MAP: [RegExp, string][] = [
  [/\bppeom\b|\bpp\s*eom\b/i, "Protection Program Every Other Month"],
  [/\bppmps\b/i, "Perimeter Plus Mosquito Peak Season"],
  [/\bppmos\b|\bppm\b/i, "Perimeter Plus Mosquito"],
  [/\bryg\b/i, "Rodent Yard Guard"],
  [/\bmos\b/i, "Mosquito Bundled"],
  [/\bpp\s*rodent\s*plus\b/i, "Protection Program Rodent Plus"],
  [/\bpp\b/i, "Protection Program"],
];

// Wording that means an outcome was only OFFERED, declined, or left for the future —
// never a completed outcome. A keyword sitting in such a clause must not become a tag.
const OFFERED_OR_FUTURE =
  /\b(offer(s|ed|ing)?|quote[ds]?|quoting|propos(e|ed|al)|present(ed)?|mention(ed)?|explain(ed)?|advis(e|ed)|inform(ed)?|let (them|him|her) know|told (them|him|her)|option(s)? to|eligible to|able to|can (call|reach|come|do|get|reactivate|resume|restart)|could|may|might|if (they|he|she|the cx)|should (they|he|she)|whenever|any ?time|in the future|within (the )?(next )?\d+\s*(day|week|month)|next (\d+\s*)?months?|will (call|reach|pay|think|let|get back)|going to (call|think|pay)|plans? to|thinking (about|it over)|consider(ing)?|declin(e|ed|es)|refus(e|ed|es)|reject(ed)?|not interested|no interest|said no|would ?n[o']?t|did ?n[o']?t (accept|agree|sign|want|take)|does ?n[o']?t want|turned (it )?down|pending (signature|approval)|waiting (on|for) (the )?(signature|signed|approval|callback)|unsigned|not (yet )?signed|no answer|left (a )?(voicemail|vm|message)|nva\b|no voice ?mail)\b/i;

// Split notes into clauses so an "offered X" phrase can't taint a nearby completed outcome.
function clauses(notes: string): string[] {
  return notes
    .split(/(?:[.!?;\n,]|\bbut\b|\bhowever\b|\bthen\b|\band then\b)+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Deterministic keyword classifier — the safety net that guarantees a call is never lost.
// Only outcomes that actually HAPPENED on the call are returned.
function keywordCategories(notes: string): { cats: Analysis["category"][]; matched: boolean } {
  const cats: Analysis["category"][] = [];
  const parts = clauses(notes);
  // Refusal wording. A refusal kills the OFFERED thing, but the cancellation that follows it
  // ("offered 50% off, customer declined and cancelled") really did happen.
  const REFUSED =
    /\b(declin(e|ed|es)|refus(e|ed|es)|reject(ed)?|not interested|no interest|said no|would ?n[o']?t|turned (it )?down|did ?n[o']?t (accept|agree|want|take))\b/i;
  const has = (re: RegExp) => re.test(notes);
  // True only when the keyword appears in a clause that is not an offer / refusal / future plan.
  const did = (re: RegExp) => parts.some((p) => re.test(p) && !OFFERED_OR_FUTURE.test(p));
  // Same, but a refusal in the clause is allowed — used for the losing outcomes.
  const didAfterRefusal = (re: RegExp) =>
    parts.some((p) => {
      if (!re.test(p)) return false;
      if (!OFFERED_OR_FUTURE.test(p)) return true;
      // Strip the refusal words and re-check: if the only "offer/future" signal was the refusal
      // itself, the outcome still happened.
      return REFUSED.test(p) && !OFFERED_OR_FUTURE.test(p.replace(new RegExp(REFUSED.source, "gi"), " "));
    });
  const add = (c: Analysis["category"]) => {
    if (!cats.includes(c)) cats.push(c);
  };

  // Precedence: the two pending flavors win over a bare "cancel".
  const cancelPending = has(/\bcancel\s*pending\b|next (service|svc)[^.]{0,40}then cancel/i);
  const pendingCancel = has(/\bpending\s*cancel\b|\b(the|retention)\s*doc\b|\bon the doc\b/i);
  if (cancelPending) add("cancel_pending");
  if (pendingCancel) add("pending_cancel");

  // A negated cancellation is a save, not a close.
  const keptService = has(/\bnot\s+cancel\w*|\bdid\s?n[o']?t\s+cancel|\bkept\s+(the\s+)?(service|plan|account)|\bdecided to (stay|keep|continue)|\bagreed to (stay|keep|continue|\d+ more)/i);
  if (keptService || did(/\bsaved?\b|\bsave[sd]\b|\bretain(ed|ing)\b|\bretention save\b/i)) add("saved");

  // Resign only counts when the agreement was actually signed / accepted on the call.
  const resignSubject = did(/\bre-?sign(ed|ing|s)?\b|\bnew agreement\b|\brenew(ed|al)?\b|reduc\w*\s+(price\s+)?to\b|\bprice reduction\b/i);
  const signedProof = did(/\bsigned\b|\bre-?signed\b|\be-?sign(ed|ature)? (complete|done|received|back)\b|\bagreement (was )?signed\b|\baccepted (the )?(new )?agreement\b|\bsigned (the )?(new )?agreement\b|\bresign(ed)? (at|for)\b/i);
  if (resignSubject && signedProof) add("resign");

  if (did(/\blead\b|\bleads\b|inside sales|\bsent to sales\b|\bIS\s+lead\b/i)) add("lead");
  // Reactivation counts only when the subscription was reopened on THIS call — not when the
  // customer was merely told they can reactivate later.
  if (did(/\breactivat(ed|ing|ion)\b/i)) add("reactivation");
  // Frozen is the same retention result as a close.
  // A close/freeze mentioned only to describe what is being reopened is not a new close.
  const reactivated = cats.includes("reactivation");
  if (!reactivated && didAfterRefusal(/\bfroze\b|\bfroze[n]?\b|\bfreez(e|ing)\b|\bseasonal (hold|pause)\b|\bpaused\b/i)) add("closed");
  if (
    !keptService &&
    !reactivated &&
    didAfterRefusal(/\bclos(e|ed|ing|ure)\b|\bcancell?(ed|ation)\b|\bcancell?ing\b|\bterminated\b/i) &&
    !cancelPending &&
    !pendingCancel
  )
    add("closed");
  if (did(/\bre-?schedul(e|ed|ing)\b|\bpush(ed)? (the )?(service|appointment|appt)\b|\bmov(e|ed) (the )?(service|appointment|appt)\b/i)) add("reschedule");
  if (did(/\bre-?service\b|\bre-?svc\b|\bRS\b/)) add("reservice");
  if (did(/\brefund(ed|s)?\b/i)) add("refund");
  if (did(/\bpayment\b|\bpaid\b|\bcard ran\b|\bran (the )?card\b|\bcollected\b|\bbalance (paid|cleared)\b|\btook (a )?payment\b/i)) add("payment");
  if (has(/back on schedule|put back on (the )?schedule|transferred from the doc/i)) add("back_on_schedule");
  if (did(/\bbilling (info|information|update|address)\b|\bupdated (the )?card\b|\bnew card\b|\bautopay\b|\bcard on file\b/i)) add("billing_update");
  if (has(/escalat\w*\s+to\s+(a\s+)?(cem|manager|retention manager)|\bto cem\b|\bhanded (it |the account )?to (a )?cem\b/i)) add("escalated_to_cem");
  if (has(/\bescalat\w*|transferred to (the )?(branch|fm|bm|field manager|branch manager)/i)) add("escalation");
  if (has(/\binquir\w*|\bquestion\w*|\bdoubts?\b|\bclarif\w*|\basked about\b|\bcomplain\w*/i)) add("inquiry");

  const matched = cats.length > 0;
  return { cats, matched };
}

function heuristicExtract(notes: string): Analysis {
  const { cats: found, matched } = keywordCategories(notes);
  const cats: Analysis["category"][] = matched ? found : ["inquiry"];
  const id = notes.match(/\b(\d{6,9})\b/)?.[1] ?? null;
  const price = notes.match(/\$?\s?(\d{2,4}(?:\.\d{2})?)\s*(?:\/|per)?\s*(?:service|svc)?/i)?.[1];
  const service = SERVICE_MAP.find(([re]) => re.test(notes))?.[1] ?? null;

  return AnalysisSchema.parse({
    categories: cats,
    category: cats[0],
    customer_id: id,
    service_name: service,
    price_per_service: price ? Number(price) : null,
    summary: notes.slice(0, 400),
    key_points: [],
    // Nothing explicit matched — ask the user to confirm the tags.
    needs_review: !matched,
  });
}

function normalize(a: Analysis): Analysis {
  const raw = Array.isArray(a.categories) && a.categories.length > 0 ? a.categories : [a.category];
  // "other" is never allowed — an unclassified call is an inquiry.
  // A frozen account is the same retention result as a close.
  const hadClosed = raw.includes("closed");
  const mapped: Analysis["category"][] = [];
  for (const c of raw) {
    if (c === "other") { if (!mapped.includes("inquiry")) mapped.push("inquiry"); continue; }
    // "Payment promised" is retired — a promise to pay is an inquiry plus a follow-up.
    if (c === "payment_promise") { if (!mapped.includes("inquiry")) mapped.push("inquiry"); continue; }
    // Frozen folds into closed; don't double-count when the list already had a close.
    if (c === "freeze") { if (!hadClosed) mapped.push("closed"); continue; }
    mapped.push(c);
  }
  const cats = mapped.length > 0 ? mapped : (["inquiry"] as Analysis["category"][]);
  return {
    ...a,
    categories: cats,
    category: cats[0],
    // Keep the boolean in sync with the outcome list — one source of truth.
    escalated_to_cem: (a.escalated_to_cem ?? false) || cats.includes("escalated_to_cem"),
    lead_sold: (a.lead_sold ?? false) && cats.includes("lead"),
    needs_review: a.needs_review ?? false,
  };
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
        payment_amount: output.payment_amount,
        refund_amount: output.refund_amount,
        account_label: output.account_label ?? null,
        escalated_to_cem: output.escalated_to_cem ?? false,
        lead_sold: output.lead_sold ?? false,
        follow_up_needed: output.follow_up_needed ?? false,
        follow_up_notes: (output.follow_up_needed ?? false) ? output.follow_up_notes : null,
        sentiment: output.sentiment,
        key_points: output.key_points,
        call_date,
        date_source,
        needs_review: output.needs_review ?? false,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

// Analyze only — no write. The UI can confirm ambiguous outcomes before anything is saved.
export const analyzeCallNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ notes: z.string().min(3) }).parse(input))
  .handler(async ({ data }) => {
    const output = await runExtraction(data.notes);
    return output;
  });

// Persist a draft produced by analyzeCallNotes (optionally with user-corrected outcomes).
export const saveDraftCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      notes: z.string().min(3),
      callDate: z.string().nullish(),
      draft: AnalysisSchema,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const output = normalize(data.draft);
    const { call_date, date_source } = resolveDate(data.callDate ?? null, output.detected_date ?? null);
    const cats = output.categories ?? [output.category];
    const { data: row, error } = await context.supabase
      .from("call_logs")
      .insert({
        user_id: context.userId,
        raw_notes: data.notes,
        category: cats[0],
        categories: cats,
        customer_name: output.customer_name,
        customer_id: output.customer_id,
        summary: output.summary,
        agreement_length_months: output.agreement_length_months,
        price_per_service: output.price_per_service,
        service_name: output.service_name,
        coupon: output.coupon,
        coupon_value: output.coupon_value,
        coupon_amount: output.coupon_amount,
        payment_amount: output.payment_amount,
        refund_amount: output.refund_amount,
        account_label: output.account_label ?? null,
        escalated_to_cem: output.escalated_to_cem ?? false,
        lead_sold: output.lead_sold ?? false,
        follow_up_needed: output.follow_up_needed ?? false,
        follow_up_notes: (output.follow_up_needed ?? false) ? output.follow_up_notes : null,
        sentiment: output.sentiment,
        key_points: output.key_points,
        call_date,
        date_source,
        needs_review: output.needs_review ?? false,
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
          results[idx] = normalize(heuristicExtract(data.items[idx].notes));
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
        payment_amount: out.payment_amount,
        refund_amount: out.refund_amount,
        account_label: out.account_label ?? null,
        escalated_to_cem: out.escalated_to_cem ?? false,
        lead_sold: out.lead_sold ?? false,
        follow_up_needed: out.follow_up_needed ?? false,
        follow_up_notes: (out.follow_up_needed ?? false) ? out.follow_up_notes : null,
        sentiment: out.sentiment,
        key_points: out.key_points,
        call_date,
        date_source,
        needs_review: out.needs_review ?? false,
      };
    });

    const { error, data: inserted } = await context.supabase.from("call_logs").insert(rows).select();
    if (error) throw new Error(error.message);
    return {
      inserted: inserted?.length ?? 0,
      // Rows the parser could not classify — the UI walks the user through tagging them.
      review: (inserted ?? []).filter((r) => r.needs_review),
    };
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

const CategoryEnum = CategoryZ;

const UpdateSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      customer_name: z.string().nullish(),
      customer_id: z.string().nullish(),
      category: CategoryEnum.optional(),
      categories: z.array(CategoryEnum).optional(),
      summary: z.string().nullish(),
      service_name: z.string().nullish(),
      price_per_service: z.number().nullish(),
      agreement_length_months: z.number().int().nullish(),
      coupon: z.string().nullish(),
      coupon_value: z.string().nullish(),
      coupon_amount: z.number().nullish(),
      payment_amount: z.number().nullish(),
      refund_amount: z.number().nullish(),
      account_label: z.string().nullish(),
      escalated_to_cem: z.boolean().optional(),
      lead_sold: z.boolean().optional(),
      follow_up_needed: z.boolean().optional(),
      follow_up_notes: z.string().nullish(),
      sentiment: z.string().nullish(),
      call_date: z.string().nullish(),
      needs_review: z.boolean().optional(),
    })
    .partial(),
});

export const updateCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const patch: import("@/integrations/supabase/types").TablesUpdate<"call_logs"> = { ...data.patch };
    if (patch.follow_up_needed === false) patch.follow_up_notes = null;
    if (Array.isArray(patch.categories) && patch.categories.length > 0) {
      patch.category = patch.categories[0];
    } else if (patch.category && !patch.categories) {
      patch.categories = [patch.category];
    }
    if (Array.isArray(patch.categories)) {
      // Frozen folds into closed.
      patch.categories = patch.categories.map((c) => (c === "freeze" ? "closed" : c));
      patch.category = patch.categories[0];
      // Keep the escalation flag in sync with the outcome list.
      patch.escalated_to_cem = patch.categories.includes("escalated_to_cem") || patch.escalated_to_cem === true;
      if (!patch.categories.includes("lead")) patch.lead_sold = false;
      // Confirming outcomes clears the review flag unless explicitly set.
      if (patch.needs_review === undefined) patch.needs_review = false;
    }
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
      .select("category,categories,customer_name,summary,agreement_length_months,price_per_service,service_name,coupon,coupon_value,coupon_amount,payment_amount,refund_amount,account_label,escalated_to_cem,lead_sold,sentiment,follow_up_needed,key_points,call_date,created_at")
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
          "You are a retention analyst for SAELA PEST CONTROL producing an OVERALL PERFORMANCE REVIEW across the agent's entire logged history. Commission drivers: payments collected, signed resigns, leads sent to sales (bonus when sold), and — for managers — saves (a save means the customer committed to at least 2 more services); a subscription flagged pending cancel after 3 GEOC attempts should be escalated to a CEM. Grade the agent against the Saela Way customer-experience values: **building value**, **ownership**, **empathy**, **professionalism**, and **clear communication** — in addition to hard metrics. Use GitHub-flavored MARKDOWN with ## headings and - bullets. Sections REQUIRED: `## Trends over time` (month-over-month or week-over-week movement), `## Saela Way scorecard` (one bullet per value: building value, ownership, empathy, professionalism, communication — each with a short assessment and evidence from the notes), `## Strengths`, `## Weaknesses`, `## Coaching recommendations`. Then a final line exactly: `SCORE: <integer 0-100> — <one-line label>`. Score blends save rate, resign volume, coupon effectiveness, lead generation, follow-through, consistency AND Saela Way behavior. Under 360 words. Do not wrap in a code fence.",
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

// ---------- Manual (structured) call entry ----------

const ManualSchema = z.object({
  categories: z.array(CategoryEnum).min(1),
  customer_name: z.string().nullish(),
  customer_id: z.string().nullish(),
  summary: z.string().nullish(),
  service_name: z.string().nullish(),
  price_per_service: z.number().nullish(),
  agreement_length_months: z.number().int().nullish(),
  coupon: z.string().nullish(),
  coupon_value: z.string().nullish(),
  coupon_amount: z.number().nullish(),
  payment_amount: z.number().nullish(),
  refund_amount: z.number().nullish(),
  account_label: z.string().nullish(),
  escalated_to_cem: z.boolean().default(false),
  lead_sold: z.boolean().default(false),
  follow_up_needed: z.boolean().default(false),
  follow_up_notes: z.string().nullish(),
  sentiment: z.string().nullish(),
  call_date: z.string().nullish(),
  raw_notes: z.string().nullish(),
});

export const createManualCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ManualSchema.parse(input))
  .handler(async ({ data, context }) => {
    const call_date = data.call_date ? new Date(data.call_date).toISOString() : new Date().toISOString();
    const { data: row, error } = await context.supabase
      .from("call_logs")
      .insert({
        user_id: context.userId,
        raw_notes: data.raw_notes?.trim() || `[Manual entry] ${data.summary ?? ""}`.trim(),
        category: data.categories[0],
        categories: data.categories,
        customer_name: data.customer_name ?? null,
        customer_id: data.customer_id ?? null,
        summary: data.summary ?? null,
        service_name: data.service_name ?? null,
        price_per_service: data.price_per_service ?? null,
        agreement_length_months: data.agreement_length_months ?? null,
        coupon: data.coupon ?? null,
        coupon_value: data.coupon_value ?? null,
        coupon_amount: data.coupon_amount ?? null,
        payment_amount: data.payment_amount ?? null,
        refund_amount: data.refund_amount ?? null,
        account_label: data.account_label ?? null,
        escalated_to_cem: data.escalated_to_cem || data.categories.includes("escalated_to_cem"),
        lead_sold: data.lead_sold && data.categories.includes("lead"),
        follow_up_needed: data.follow_up_needed,
        follow_up_notes: data.follow_up_needed ? data.follow_up_notes ?? null : null,
        sentiment: data.sentiment ?? null,
        key_points: [],
        call_date,
        date_source: "user_selected",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- User settings (role) ----------

const RoleEnum = z.enum(["ces", "cem"]);

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_settings")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { role: (data?.role ?? null) as "ces" | "cem" | null };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ role: RoleEnum }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_settings")
      .upsert({ user_id: context.userId, role: data.role }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { role: data.role };
  });
