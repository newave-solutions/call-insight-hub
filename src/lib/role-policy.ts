// Saela Customer Experience role definitions, negotiation authority, and commission rules.
// Client-safe: no server imports. Tune the numbers here if department policy changes.

export type Role = "ces" | "cem";

export type RoleDefinition = {
  role: Role;
  name: string;
  short: string;
  tagline: string;
  /** What the role is, in one paragraph. */
  description: string;
  /** What they can do without Team Lead approval. */
  independent: string[];
  /** What still needs Team Lead approval. */
  needsApproval: string[];
  /** Commission-earning outcomes. */
  commission: string[];
};

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  ces: {
    role: "ces",
    name: "Customer Experience Specialist",
    short: "CES",
    tagline: "Front-line retention & service",
    description:
      "The front-line, customer-facing agent. Handles account retention, service agreements, and pricing negotiation to keep customers from cancelling. Must make at least 3 retention attempts using GEOC (Gratitude, Empathy, Ownership, Clarity) before flagging an account as Pending Cancel and escalating it to a Customer Experience Manager.",
    independent: [
      "Protection Program minimum price $124.99",
      "Up to 30% off the next regular (REG) service",
      "Reschedule up to 2 weeks out, staying inside the current month",
      "Change service frequency OR contract length (not both)",
      "Switchover PP at $109.99 — $99.99 only to match a competitor's offer",
      "PTI / 3-day ROR cancellations: PP minimum $114.99",
    ],
    needsApproval: [
      "PP price down to $109.99 (or $104.97 on convenient billing)",
      "Discount above 30% — up to 50% off the next REG service",
      "Rescheduling to any other day in the current month",
      "Changing frequency AND contract length together",
    ],
    commission: [
      "Collect an outstanding payment",
      "Resign a customer on a new signed agreement",
      "Send a lead to the sales department (bonus if it sells)",
    ],
  },
  cem: {
    role: "cem",
    name: "Customer Experience Manager",
    short: "CEM",
    tagline: "Escalation point with wider save authority",
    description:
      "The higher-level escalation point for retention. Takes accounts a specialist could not save after 3 GEOC attempts, and carries broader independent negotiation authority to prevent cancellations. Can also reopen a closed, frozen, or cancelled subscription within 6 months of the closure date.",
    independent: [
      "Protection Program minimum price $109.99",
      "Up to 50% off or a flat $80 discount on the next regular (REG) service",
      "Reschedule to any day within the current month",
      "Change service frequency OR contract length",
      "Switchover PP at $104.99 — $80 discount only to match a competitor",
      "3-day ROR: PP minimum $109.99 plus a free service to save the account",
      "Reactivate a subscription closed/frozen within the last 6 months",
    ],
    needsApproval: [
      "Giving the next regular service completely free",
      "Rescheduling outside the current month",
      "Changing frequency AND contract length together",
    ],
    commission: [
      "Saves (customer commits to at least 2 more services)",
      "Collect an outstanding payment",
      "Resign a customer on a new signed agreement",
      "Send a lead to the sales department (bonus if it sells)",
    ],
  },
};

export const ROLE_LIMITS: Record<
  Role,
  { priceIndependent: number; priceWithApproval: number; discountPctIndependent: number; discountPctWithApproval: number; flatDiscountIndependent: number }
> = {
  ces: {
    priceIndependent: 124.99,
    priceWithApproval: 104.97,
    discountPctIndependent: 30,
    discountPctWithApproval: 50,
    flatDiscountIndependent: 0,
  },
  cem: {
    priceIndependent: 109.99,
    priceWithApproval: 104.99,
    discountPctIndependent: 50,
    discountPctWithApproval: 100,
    flatDiscountIndependent: 80,
  },
};

export type AuthorityLevel = "within" | "approval" | "out";

export type AuthorityResult = {
  level: AuthorityLevel;
  label: string;
  reasons: string[];
};

/** Reads a "50% off" style string into a percentage. */
function parsePercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,3})\s*%/);
  return m ? Number(m[1]) : null;
}

/**
 * Compares the offer recorded on a call against the active role's documented limits.
 * Informational only — never blocks logging.
 */
export function evaluateAuthority(
  role: Role,
  log: {
    price_per_service?: number | string | null;
    coupon_amount?: number | string | null;
    coupon_value?: string | null;
  },
): AuthorityResult {
  const limits = ROLE_LIMITS[role];
  const reasons: string[] = [];
  let level: AuthorityLevel = "within";
  const bump = (next: AuthorityLevel) => {
    if (next === "out" || (next === "approval" && level === "within")) level = next;
  };

  const price = log.price_per_service != null && log.price_per_service !== "" ? Number(log.price_per_service) : null;
  if (price != null && Number.isFinite(price) && price > 0) {
    if (price < limits.priceWithApproval) {
      bump("out");
      reasons.push(`$${price.toFixed(2)}/service is below the $${limits.priceWithApproval.toFixed(2)} floor`);
    } else if (price < limits.priceIndependent) {
      bump("approval");
      reasons.push(`$${price.toFixed(2)}/service is under the ${ROLE_DEFINITIONS[role].short} minimum of $${limits.priceIndependent.toFixed(2)}`);
    }
  }

  const amount = log.coupon_amount != null && log.coupon_amount !== "" ? Number(log.coupon_amount) : null;
  const statedPct = parsePercent(log.coupon_value);
  const derivedPct =
    amount != null && Number.isFinite(amount) && amount > 0 && price != null && price > 0
      ? Math.round((amount / price) * 100)
      : null;
  const pct = statedPct ?? derivedPct;

  if (pct != null && pct > 0) {
    const flatOk = limits.flatDiscountIndependent > 0 && amount != null && amount <= limits.flatDiscountIndependent;
    if (pct > limits.discountPctWithApproval) {
      bump("out");
      reasons.push(`${pct}% off exceeds every documented limit`);
    } else if (pct > limits.discountPctIndependent && !flatOk) {
      bump("approval");
      reasons.push(
        `${pct}% off is above the ${ROLE_DEFINITIONS[role].short} limit of ${limits.discountPctIndependent}%${
          limits.flatDiscountIndependent ? ` / flat $${limits.flatDiscountIndependent}` : ""
        }`,
      );
    }
  }

  const label = level === "within" ? "Within authority" : level === "approval" ? "Needs TL approval" : "Out of policy";
  return { level, label, reasons };
}

/** Outcomes that earn a commission for each role. */
export const COMMISSION_CATEGORIES: Record<Role, string[]> = {
  ces: ["payment", "resign", "lead"],
  cem: ["saved", "payment", "resign", "lead"],
};
