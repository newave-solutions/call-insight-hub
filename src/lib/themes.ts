// Official Saela cancellation / call-reason vocabulary. Fixed + small so recurring issues can be
// counted reliably across calls — free text would never aggregate.
export const THEME_VALUES = [
  "agreement_dispute",
  "billing_issue",
  "product_concerns",
  "customer_deceased",
  "database_glitch_sold",
  "unclear_details",
  "diy",
  "employee_mistake",
  "expired_subscription",
  "financial_hold",
  "military_orders",
  "moved",
  "no_activity",
  "persistent_activity",
  "poor_experience",
  "price_affordability",
  "price_increase",
  "ror",
  "prior_to_initial",
  "switchover",
] as const;

export type Theme = (typeof THEME_VALUES)[number];

export const SEVERITY_VALUES = ["mentioned", "frustrated", "cancel_driver"] as const;
export type Severity = (typeof SEVERITY_VALUES)[number];

export const ENTITY_TYPES = ["technician", "specialist", "branch", "route", "plan"] as const;

export const THEME_META: Record<Theme, { label: string; hint: string; coaching: boolean }> = {
  agreement_dispute: {
    label: "Agreement dispute",
    hint: "Customer disputes the agreement itself — term length, renewal, cancel fee, or says they never agreed to it.",
    coaching: true,
  },
  billing_issue: {
    label: "Billing issue",
    hint: "Unexpected charge, double billing, autopay dispute, wrong amount, or a balance they dispute.",
    coaching: true,
  },
  product_concerns: {
    label: "Concerns about product",
    hint: "Doubts about the chemicals, safety, pets/kids, effectiveness, or the service model itself.",
    coaching: false,
  },
  customer_deceased: { label: "Customer passed away", hint: "Account holder died; family is closing the account.", coaching: false },
  database_glitch_sold: {
    label: "Database glitch / sold account",
    hint: "System or record error, duplicate account, or the account was sold/transferred to another company or owner.",
    coaching: true,
  },
  unclear_details: {
    label: "Service / agreement details unclear",
    hint: "Details of the service or the agreement were never clearly explained at the sale.",
    coaching: true,
  },
  diy: { label: "Do it yourself (DIY)", hint: "Customer will handle pest control themselves or buy their own products.", coaching: false },
  employee_mistake: {
    label: "Employee mistake",
    hint: "A Saela employee made an error — wrong promise, wrong charge, wrong service, wrong info.",
    coaching: true,
  },
  expired_subscription: { label: "Expired subscription", hint: "Agreement term is complete and the customer is not continuing.", coaching: false },
  financial_hold: { label: "Financial hold", hint: "Cannot pay right now — hardship, job loss, fixed income, budget hold.", coaching: false },
  military_orders: { label: "Military orders", hint: "Deployment or PCS orders force the account to end.", coaching: false },
  moved: { label: "Moved / moving", hint: "Leaving the property — moving, sold the home, or a new owner took over.", coaching: false },
  no_activity: { label: "No longer seeing activity", hint: "Pest problem is resolved, so the customer sees no ongoing need.", coaching: false },
  persistent_activity: {
    label: "Persistent activity",
    hint: "Pests are still present or keep coming back after services.",
    coaching: false,
  },
  poor_experience: {
    label: "Poor experience",
    hint: "Bad overall experience — rude or careless tech, missed/late service, no communication, upsell pressure, access problems.",
    coaching: true,
  },
  price_affordability: { label: "Price / affordability", hint: "Price is too high for the value, or cheaper elsewhere.", coaching: false },
  price_increase: { label: "Price increase", hint: "Rate went up on renewal or after the promo period ended.", coaching: false },
  ror: { label: "ROR", hint: "Right of rescission — cancelled inside the rescission window after signing.", coaching: false },
  prior_to_initial: { label: "Prior to initial", hint: "Cancelling before the initial service was ever performed.", coaching: false },
  switchover: { label: "Switchover", hint: "Account switching to another company, branch, plan, or entity.", coaching: false },
};

// Older rows were stored with the previous theme vocabulary. Map them forward so history counts.
const LEGACY_THEME_MAP: Record<string, Theme> = {
  upselling_pressure: "poor_experience",
  contract_confusion: "agreement_dispute",
  billing_surprise: "billing_issue",
  pest_not_resolved: "persistent_activity",
  missed_appointment: "poor_experience",
  tech_professionalism: "poor_experience",
  poor_communication: "poor_experience",
  moving: "moved",
  financial_hardship: "financial_hold",
  competitor_offer: "price_affordability",
  frequency_too_high: "product_concerns",
  access_issues: "poor_experience",
  no_longer_needed: "no_activity",
  price_increase: "price_increase",
};

/** Normalize any stored theme key (current or legacy) to the current vocabulary. */
export function canonicalTheme(theme: string): Theme | null {
  if ((THEME_VALUES as readonly string[]).includes(theme)) return theme as Theme;
  return LEGACY_THEME_MAP[theme] ?? null;
}

// Deterministic detection so reasons still land when the model is unsure or unavailable.
export const THEME_PATTERNS: [Theme, RegExp][] = [
  [
    "agreement_dispute",
    /\b(did ?n[o']?t (know|sign|agree)( to)? (about )?(the )?(contract|agreement|term)|never (signed|agreed to)|thought it was (month to month|one time)|auto-?renew\w*|cancellation fee|early termination|disput\w+ (the )?(agreement|contract)|out of contract)\b/i,
  ],
  [
    "billing_issue",
    /\b(double (charged|billed)|unexpected charge|charged (twice|without)|did ?n[o']?t authorize|autopay (issue|problem|dispute)|surprise (bill|charge)|billing (error|issue|dispute|problem)|wrong amount|disputes? (the )?(charge|balance)|past due)\b/i,
  ],
  [
    "product_concerns",
    /\b(chemical\w*|pet safe|safe for (my )?(kids|pets|children)|too (often|frequent)|do ?n[o']?t (think|believe) (it|the service) works|not (sure|convinced) (it|the service) works|concerned about the (product|treatment|spray))\b/i,
  ],
  ["customer_deceased", /\b(passed away|deceased|died|is no longer with us|widow(ed)?)\b/i],
  [
    "database_glitch_sold",
    /\b(duplicate account|system (error|glitch)|database (glitch|error)|sold (the )?account|account was sold|transferred to (another|a different) (company|owner)|wrong account)\b/i,
  ],
  [
    "unclear_details",
    /\b(was ?n[o']?t (told|explained)|never explained|no one (told|explained)|(sales(man|person)|rep) (never|did ?n[o']?t) (say|tell|explain)|misle\w+|unclear (on|about) (the )?(service|agreement|terms))\b/i,
  ],
  ["diy", /\b(do it (my|him|her)self|doing it (my|him|her)self|handled? it (my|him|her)self|DIY|buy(ing)? (my|their) own (spray|product)|treat(ing)? it (my|them)sel\w+)\b/i],
  [
    "employee_mistake",
    /\b(rep (promised|told)|was promised|employee (mistake|error)|our (mistake|error)|we (messed|screwed) up|billed in error|serviced the wrong (house|address)|should ?n[o']?t have been charged)\b/i,
  ],
  ["expired_subscription", /\b(agreement (is )?(up|complete|expired|fulfilled)|term (is )?(up|complete|expired)|finished (the|their) (contract|agreement)|completed (all|the) services)\b/i],
  [
    "financial_hold",
    /\b(can ?n[o']?t afford|too tight|lost (my |his |her )?job|financial(ly)? (hardship|hold|issues|struggling)|budget (cut|issues|tight)|money is tight|on a fixed income|medical bills)\b/i,
  ],
  ["military_orders", /\b(military|deploy(ed|ment)|PCS|orders? (to|came)|stationed|army|navy|air force|marines)\b/i],
  ["moved", /\b(moving|moved|relocat\w+|selling (the |my )?(house|home)|sold (the |my )?(house|home)|new owner|no longer (lives|owns)|out of (the )?(state|area))\b/i],
  ["no_activity", /\b(no longer (see(ing)?|need)|do ?n[o']?t need (the )?service|problem (is )?(solved|gone)|not seeing (any )?(bugs|pests|activity)|no (bugs|pests|activity) (any ?more|lately))\b/i],
  [
    "persistent_activity",
    /\b(still (has|have|seeing|getting)? ?(bugs|ants|spiders|roaches|wasps|mice|rats|rodents|scorpions)|not working|no results|problem (came back|persists)|pests? (are )?back|re-?infest\w*|keeps? coming back)\b/i,
  ],
  [
    "poor_experience",
    /\b(rude|unprofessional|disrespectful|rushed (through|the service)|sloppy|careless|no-?show|did ?n[o']?t show|missed (the )?(service|appointment|appt)|never came|showed up late|no (one )?(called|returned|answered)|no notice|no follow ?up|up-?sell\w*|upsold|pressur\w+ (me|him|her|them|into)|gate (was )?(left )?open|damaged|bad experience|terrible service)\b/i,
  ],
  [
    "price_affordability",
    /\b(too expensive|cost too much|not worth (the|it)|price is too (high|much)|cheaper (elsewhere|company|quote)|better (price|offer|deal) (from|with)|competitor|another company|terminix|orkin|aptive|moxie)\b/i,
  ],
  ["price_increase", /\b(price (went up|increase[ds]?|hike)|rate (went up|increase[ds]?)|got more expensive|charging more|promo (ended|expired))\b/i],
  ["ror", /\b(ROR|right of rescission|rescission|within (the )?(3|three) (business )?days? of signing|cooling off period)\b/i],
  ["prior_to_initial", /\b(prior to initial|before (the )?initial|never (had|received) (the )?(initial|first) service|no service (has been )?performed yet)\b/i],
  ["switchover", /\b(switch(ing|ed)? (over |to )?(to )?(another|a different|new) (company|branch|plan|account)|switchover|transferr?ing (the )?(service|account) to)\b/i],
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

// Keyword-based reason detection over the raw notes. Sentence-scoped so the quote and the
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
  const key = canonicalTheme(theme);
  return key ? THEME_META[key].label : theme.replace(/_/g, " ");
}
