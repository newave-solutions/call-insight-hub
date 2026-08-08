# Role definitions, SAVE rules, and commission tracking

## Goal
Teach the app the real CES and CEM job definitions from the company documentation: what each role is allowed to offer without approval, what counts as a SAVE, how outcomes attach to subscriptions, and which outcomes earn commission. Update the onboarding role descriptions, the categories being counted, and the dashboard widgets to match.

## 1. Role onboarding descriptions (rewrite)
Replace the current one-liners on the role picker and the header role switcher with accurate descriptions:

- **Customer Experience Specialist (CES)** — Front-line retention. Makes at least 3 GEOC save attempts, negotiates within specialist limits (PP min $124.99, up to 30% off next REG, reschedule up to 2 weeks and within the current month, frequency OR contract length), escalates unsaved accounts as Pending Cancel to a CEM. Commission on payments collected, signed resigns, and leads sent to sales.
- **Customer Experience Manager (CEM)** — Escalation point for accounts a CES could not save. Broader independent authority (PP min $109.99, up to 50% off or flat $80 off next REG, reschedule any day in the current month, switchover $104.99, ROR free service + $109.99, reactivate closures within 6 months). Commission on everything a CES earns, plus SAVES.

Each role card also lists what still needs Team Lead approval, so the app doubles as a quick reference during a call.

## 2. Categories: what changes
Kept as-is: Saved, Closed/Frozen, Resign, Reactivation, Lead, Cancel Pending, Pending Cancel, Reschedule, Re-service, Payment, Payment Promised, Billing Update, Refund, Back on Schedule, Inquiry, Escalation.

Changes:
- **SAVE gets a real definition**: a subscription counts as saved when the customer agrees to at least 2 more services — inferable from context unless the customer says otherwise. If the customer commits to only one more service and then cancels, it is **Cancel Pending**, not a save.
- **Freeze folds into Closed** for counting purposes: frozen/closed/cancelled are the same retention result, shown as "Closed / Frozen" with the freeze flavor kept on the individual log.
- **Reactivation** requires the closure to be within 6 months and is manager-authority — flagged if the log shows a longer gap.
- **Per-subscription outcomes**: one customer can have multiple properties (accounts), and an account can have multiple subscriptions, each with its own outcome. Logs get an optional property/account label so two outcomes on the same call read as "Account A saved, Account B cancel pending" instead of one blurred row.
- **New tag: Escalated to CEM** — set when a CES flags Pending Cancel after 3 attempts, so the handoff is countable.
- **Other** stays forbidden.

## 3. Commission tracking (new)
A commission-eligible outcome list per role drives a new dashboard strip:

| Role | Commissionable |
| --- | --- |
| CES | Payment collected, signed Resign, Lead sent to sales (bonus if sold) |
| CEM | All of the above plus SAVES |

The strip shows counts and dollars for the active role: payments collected, signed resigns, leads sent (and leads sold), and — for CEM only — saves. Non-commissionable outcomes stay visible but in the secondary section.

## 4. Authority / offer-limit awareness
When a log records a price or discount, the app compares it to the active role's limits and labels the log:

- **Within authority** — inside the role's independent limits.
- **Needs TL approval** — beyond independent limits but inside Team Lead range (e.g. CES at $109.99, CES 50% off, CEM giving a fully free REG service, rescheduling outside the month, changing frequency AND contract length).
- **Out of policy** — below any documented floor.

This surfaces as a small badge in the log table and detail drawer, plus a "flagged offers" count so out-of-range entries are easy to review. It is informational, never blocking.

## 5. Role-aware dashboard surfaces
- **KPI cards** — CEM: Saves, Closed/Frozen, Resigns, Cancel Pending, Pending Cancel, Reactivations, Leads. CES: Reschedules, Re-services, Payments, Payment Promised, Billing Updates, Refunds, Resigns, Leads, Escalated to CEM.
- **Money strip** — CEM: save value, discount dollars given. CES: payments collected, refunds issued, discount dollars given.
- **Charts** — outcome trend and category mix limited to the active role's outcome set; discount dollars per day for CEM, payments vs refunds per day for CES.
- **Log table / daily totals** — columns follow the role, same as the KPI split.

Logging and editing always expose every category and every field regardless of role, since traffic moves the user between roles day to day.

## 6. Technical notes
- `src/lib/call-logs.functions.ts`: rewrite the role section of `SYSTEM_PROMPT` with both authority tables, the 2-additional-services SAVE rule, GEOC/3-attempt escalation, per-account/per-subscription outcome guidance, and the 6-month reactivation window. Add `account_label`, `escalated_to_cem`, `lead_sold`, and an `authority_flag` derived value to the analysis schema and the heuristic fallback. Fold `freeze` into the closed tally while keeping the tag.
- Database: one migration adding `account_label text`, `escalated_to_cem boolean default false`, `lead_sold boolean default false` to `call_logs`, plus the `escalated_to_cem` outcome in the categories vocabulary. Authority limits live in code (`src/lib/role-policy.ts`), not the database, so they are easy to tune.
- `src/routes/_authenticated/dashboard.tsx`: extend `CATEGORY_META` and `KPI_BY_ROLE`, add `COMMISSION_BY_ROLE`, add the commission strip and authority badges, and pull the new role descriptions from `role-policy.ts` for the onboarding card and switcher.
