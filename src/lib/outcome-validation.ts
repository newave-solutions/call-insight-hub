export type Category =
  | "saved"
  | "closed"
  | "resign"
  | "reactivation"
  | "lead"
  | "cancel_pending"
  | "pending_cancel"
  | "reschedule"
  | "reservice"
  | "payment"
  | "billing_update"
  | "freeze"
  | "refund"
  | "back_on_schedule"
  | "other";

export const ALL_CATEGORIES: Category[] = [
  "saved",
  "closed",
  "resign",
  "reactivation",
  "lead",
  "cancel_pending",
  "pending_cancel",
  "reschedule",
  "reservice",
  "payment",
  "billing_update",
  "freeze",
  "refund",
  "back_on_schedule",
  "other",
];

export interface OutcomeValidationResult {
  isValid: boolean;
  requiresUserSelection: boolean;
  message: string;
  suggestedOutcomes: Category[];
  confidenceScore: number;
}

export interface CallOutcomeData {
  category: string;
  categories?: string[] | null;
  summary?: string;
  customer_name?: string;
  agreement_length_months?: number | null;
}

/**
 * Validates that a call has proper outcome selection.
 * Prevents calls from falling into "Other" category without user confirmation.
 */
export function validateOutcome(
  callData: CallOutcomeData,
  confidenceScore: number = 0.5
): OutcomeValidationResult {
  const primaryCategory = callData.category as Category;
  const secondaryCategories = (callData.categories ?? []) as Category[];

  // If category is "Other" and confidence is low, require user selection
  if (primaryCategory === "other") {
    return {
      isValid: false,
      requiresUserSelection: true,
      message:
        "The AI is uncertain about the call outcome. Please select the correct outcome from the list.",
      suggestedOutcomes: [],
      confidenceScore,
    };
  }

  // Check if incomplete fields exist with "Other"
  const incompleteFields = [];
  if (!callData.summary || callData.summary.trim().length === 0) {
    incompleteFields.push("summary");
  }
  if (!callData.customer_name) {
    incompleteFields.push("customer_name");
  }

  if (primaryCategory === "other" && incompleteFields.length > 0) {
    return {
      isValid: false,
      requiresUserSelection: true,
      message: `Missing required fields: ${incompleteFields.join(", ")}. Please complete these fields before saving.`,
      suggestedOutcomes: [],
      confidenceScore,
    };
  }

  // Allow valid outcomes
  if (primaryCategory !== "other") {
    return {
      isValid: true,
      requiresUserSelection: false,
      message: "Outcome is valid",
      suggestedOutcomes: [primaryCategory, ...secondaryCategories],
      confidenceScore: Math.min(1, confidenceScore + 0.1),
    };
  }

  return {
    isValid: true,
    requiresUserSelection: false,
    message: "Outcome is valid",
    suggestedOutcomes: [primaryCategory, ...secondaryCategories],
    confidenceScore,
  };
}

/**
 * Suggests outcomes based on call content analysis
 */
export function suggestOutcomes(summary: string): {
  primary: Category;
  secondary: Category[];
  confidence: number;
} {
  const lowerSummary = summary.toLowerCase();
  const keywordMap: Record<string, Category> = {
    saved: "saved",
    resign: "resign",
    closed: "closed",
    cancel: "cancel_pending",
    reschedule: "reschedule",
    payment: "payment",
    refund: "refund",
    reactivate: "reactivation",
    freeze: "freeze",
    lead: "lead",
    "re-service": "reservice",
    "pending cancel": "pending_cancel",
    "billing update": "billing_update",
    "back on schedule": "back_on_schedule",
  };

  const matches: { outcome: Category; confidence: number }[] = [];

  for (const [keyword, outcome] of Object.entries(keywordMap)) {
    if (lowerSummary.includes(keyword)) {
      matches.push({ outcome, confidence: 0.8 });
    }
  }

  if (matches.length === 0) {
    return { primary: "other", secondary: [], confidence: 0.3 };
  }

  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);

  return {
    primary: matches[0].outcome,
    secondary: matches.slice(1).map((m) => m.outcome),
    confidence: matches[0].confidence,
  };
}
