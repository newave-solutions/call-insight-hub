// Controlled vocabulary for "voice of customer" themes. Kept small and stable so counting
// across calls is reliable — free text would never aggregate.
export const THEME_VALUES = [
  "upselling_pressure",
  "price_increase",
  "contract_confusion",
  "billing_surprise",
  "pest_not_resolved",
  "missed_appointment",
  "tech_professionalism",
  "poor_communication",
  "moving",
  "financial_hardship",
  "competitor_offer",
  "frequency_too_high",
  "access_issues",
  "no_longer_needed",
] as const;

export type Theme = (typeof THEME_VALUES)[number];

export const SEVERITY_VALUES = ["mentioned", "frustrated", "cancel_driver"] as const;
export type Severity = (typeof SEVERITY_VALUES)[number];

export const ENTITY_TYPES = ["technician", "specialist", "branch", "route", "plan"] as const;

export const THEME_META: Record<Theme, { label: string; hint: string; coaching: boolean }> = {
  upselling_pressure: {
    label: "Upsell pressure",
    hint: "Customer feels pushed into extra services or add-ons by techs/specialists.",
    coaching: true,
  },
  price_increase: { label: "Price increase", hint: "Rate went up or price feels too high now.", coaching: false },
  contract_confusion: {
    label: "Contract / term confusion",
    hint: "Customer did not understand the agreement length, renewal, or cancel terms.",
    coaching: true,
  },
  billing_surprise: {
    label: "Billing surprise",
    hint: "Unexpected charge, autopay dispute, or double billing.",
    coaching: true,
  },
  pest_not_resolved: { label: "Pest not resolved", hint: "Bugs/rodents still present after services.", coaching: false },
  missed_appointment: { label: "Missed / late service", hint: "No-show, late arrival, or skipped service.", coaching: true },
  tech_professionalism: { label: "Tech professionalism", hint: "Rude, rushed, sloppy, or careless technician.", coaching: true },
  poor_communication: { label: "Poor communication", hint: "No notice, unreturned calls, unclear info.", coaching: true },
  moving: { label: "Moving / selling home", hint: "Leaving the property — not a service failure.", coaching: false },
  financial_hardship: { label: "Financial hardship", hint: "Cannot afford the service right now.", coaching: false },
  competitor_offer: { label: "Competitor offer", hint: "Another company offered a better price/terms.", coaching: false },
  frequency_too_high: { label: "Frequency too high", hint: "Service comes out more often than needed.", coaching: false },
  access_issues: { label: "Property access", hint: "Gates, pets, tenants, or scheduling access problems.", coaching: false },
  no_longer_needed: { label: "No longer needed", hint: "Problem solved, customer sees no ongoing value.", coaching: false },
};

// Deterministic fallback detection so themes still land when the model is unsure or unavailable.
export const THEME_PATTERNS: [Theme, RegExp][] = [
  [
    "upselling_pressure",
    /\b(up-?sell\w*|upsold|pushing (me |him |her |them )?(to buy|more services|new service|another)|too many (services|add-?ons)|always (trying to )?sell|sales pitch|pressur\w+ (me|him|her|them|into)|tried to sell|constantly selling|keep(s)? offering more)\b/i,
  ],
  ["price_increase", /\b(price (went up|increase[ds]?|hike)|rate (went up|increase[ds]?)|got more expensive|too expensive|cost too much|charging more)\b/i],
  ["contract_confusion", /\b(did ?n[o']?t know (about )?(the )?(contract|agreement|term)|thought it was (month to month|one time)|auto-?renew\w*|was ?n[o']?t told (about )?(the )?(contract|term)|cancellation fee|early termination)\b/i],
  ["billing_surprise", /\b(double (charged|billed)|unexpected charge|charged (twice|without)|did ?n[o']?t authorize|autopay (issue|problem|dispute)|surprise (bill|charge)|billing (error|issue|dispute)|wrong amount)\b/i],
  ["pest_not_resolved", /\b(still (has|have|seeing|getting)? ?(bugs|ants|spiders|roaches|wasps|mice|rats|rodents|scorpions)|not working|no results|problem (came back|persists)|pests? (are )?back|re-?infest\w*)\b/i],
  ["missed_appointment", /\b(no-?show|did ?n[o']?t show|missed (the )?(service|appointment|appt)|never came|skipped (the )?service|showed up late|came late)\b/i],
  ["tech_professionalism", /\b(rude|unprofessional|disrespectful|rushed (through|the service)|sloppy|careless|damaged|left (the )?gate open|tech(nician)? (was|is) (rude|bad|awful)|argued)\b/i],
  ["poor_communication", /\b(no (one )?(called|returned|answered)|never (called|notified|told)|no notice|no heads up|unreturned|left messages? (and|with) no (call ?back|response)|no follow ?up)\b/i],
  ["moving", /\b(moving|moved|relocat\w+|selling (the |my )?(house|home)|sold (the |my )?(house|home)|new owner|no longer (lives|owns))\b/i],
  ["financial_hardship", /\b(can ?n[o']?t afford|too tight|lost (my |his |her )?job|financial(ly)? (hardship|issues|struggling)|budget (cut|issues|tight)|money is tight|on a fixed income)\b/i],
  ["competitor_offer", /\b(competitor|another company|cheaper (elsewhere|company|quote)|better (price|offer|deal) (from|with)|switch(ing|ed)? to (another|a different)|terminix|orkin|aptive|moxie)\b/i],
  ["frequency_too_high", /\b(too (often|frequent)|comes? out too much|do ?n[o']?t need (it )?(that|this) (often|much)|every other month is too|less often|reduce (the )?frequency)\b/i],
  ["access_issues", /\b(gate (was )?locked|could ?n[o']?t (get in|access)|dogs? (in|out) (the )?(yard|back)|tenants?|not home|access (issue|problem))\b/i],
  ["no_longer_needed", /\b(no longer need|do ?n[o']?t need (the )?service|problem (is )?(solved|gone)|not seeing (any )?(bugs|pests|activity)|handled it (my|him|her)self|doing it (my|him|her)self)\b/i],
];

const CANCEL_DRIVER_NEARBY =
  /\b(cancel\w*|close\w*|terminat\w*|because|reason|that ?s why|so (they|he|she) want)\b/i;
const FRUSTRATED =
  /\b(frustrat\w*|upset|angry|mad|furious|fed up|tired of|annoyed|complain\w*|unacceptable|ridiculous)\b/i;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type DetectedTheme = {
  theme: Theme;
  severity: Severity;
  is_cancel_driver: boolean;
  quote: string | null;
  entity_type: EntityType | null;
  entity_name: string | null;
};

// Keyword-based theme detection over the raw notes. Sentence-scoped so the quote and the
// cancel-driver judgement stay tied to the actual wording.
export function detectThemes(notes: string): DetectedTheme[] {
  const sentences = notes
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: DetectedTheme[] = [];
  for (const [theme, re] of THEME_PATTERNS) {
    const sentence = sentences.find((s) => re.test(s));
    if (!sentence) continue;
    const isDriver = CANCEL_DRIVER_NEARBY.test(sentence);
    out.push({
      theme,
      severity: isDriver ? "cancel_driver" : FRUSTRATED.test(sentence) ? "frustrated" : "mentioned",
      is_cancel_driver: isDriver,
      quote: sentence.slice(0, 240),
      entity_type: null,
      entity_name: null,
    });
  }
  return out;
}

export function themeLabel(theme: string): string {
  return THEME_META[theme as Theme]?.label ?? theme.replace(/_/g, " ");
}
