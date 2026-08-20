# Per-call scatter, useful charts, strict follow-ups, official cancel reasons, Saela dark-green redesign

## 1. Calls chart: one dot per call
- The "calls logged per day" chart becomes a true per-call scatter: x = date/time of the call, y = time of day (so dots spread vertically within a day instead of stacking on one point), one dot per logged call over the last 30 days.
- Dot color comes from the call's primary outcome (save / closed / resign / reschedule / payment, etc.) so the month reads as a pattern of wins vs losses, and dot size marks calls carrying money (payment or coupon).
- Hover shows customer, outcome tags, time, and any dollar amount. Clicking a dot opens that call in the detail drawer; clicking the axis day switches the log to that day.
- Keeps the average-per-day reference line and the month total / best day callouts.

## 2. Replace the weak charts with retention-useful ones
Removed: "Discount $ / day", the standalone "Follow-ups" tile, and the weekday-mix card in its current form.

CEM view gets:
- **Retention goal ring** — month-to-date retention rate against the 30% minimum, with "saves needed to reach 30%" and a pace indicator (on track / behind).
- **Outcome totals board** — big counted tiles for saves, closed/frozen, resigns, reactivations, escalations to CEM, with month-over-month change arrows.
- **Money board** — payments collected, coupons/discounts given (count + dollars), refunds, resign contract value; coupon dollars shown as "cost per save" so discounting efficiency is visible.
- **Retention trend (30d)** — save rate line with a 30% goal reference line drawn across it.
- **Cancel reasons** — ranked bar chart of the official reason list driving closes.

CES view gets:
- Totals board for reschedules, re-services, billing updates, payments collected, leads sent (and leads sold), inquiries.
- Payments vs refunds trend, coupons given (count + dollars), and re-service/reschedule mix.

Both roles keep the AI-inferred **Areas of opportunity** panel: trends, what is driving losses, and concrete next actions derived from the logged calls.

## 3. Follow-ups only when you actually said so
- A call is a follow-up only when the notes explicitly state the agent will reach back out (in the Resolution/bottom section or anywhere else stated as an action for you), or when an agreement was sent but not confirmed signed on the call.
- Escalations, normal reschedules, re-services, pending cancels, "customer will call back", and anything already completed no longer create follow-ups.
- The keyword fallback follows the same rule, and existing follow-up flags stay editable by hand.
- Follow-ups move into a compact "My reminders" list (customer, what you promised, date) instead of a bare count.

## 4. Watchlist reasons replaced with the official cancellation reasons
New vocabulary (replaces the current theme list): agreement dispute, billing issue, concerns about product, customer passed away, database glitch / sold account, details of service or agreement unclear, DIY, employee mistake, expired subscription, financial hold, military orders, moved or moving, no longer seeing activity, persistent activity, poor experience, price and affordability, price increase, ROR, prior to initial, switchover.
- Detection patterns and AI extraction are rewritten against this list; recurring-issue alerts and the account/technician signals keep working on the new reasons.
- Existing calls' old themes are mapped to the closest new reason so history isn't lost (upsell pressure and tech professionalism fold into poor experience; contract confusion into agreement dispute).

## 5. Front end: Saela "deep green control room"
- Palette: near-black forest ground `#0E2A1B`, panel green `#12402A`, lime accent `#7CD44A`, white type — applied as design tokens so no flat-white surfaces remain.
- New shell: dark top bar with the Saela wordmark, role switcher and authority badge; panels as translucent glass cards with soft lime glow, thin borders, and subtle grid texture.
- Background gets generated pest-control imagery — a faint bug/leaf silhouette motif low on the page and a soft canopy gradient behind the header — kept low-contrast so data stays readable.
- Charts restyled to the palette (lime for wins, muted red for losses, amber for pending), animated counters on the totals boards, and denser type scale so the dashboard reads like a live ops console.
- Light mode remains available but is retuned green/black rather than plain white.

## Technical notes
- `src/styles.css`: new token set (green surfaces, lime accent/glow, gradients, glass shadow) for both themes; charts read tokens, no hardcoded color classes.
- `src/lib/themes.ts`: replace `THEME_VALUES`, `THEME_META`, and `THEME_PATTERNS` with the cancel-reason vocabulary + a legacy→new mapping helper used when rendering old rows.
- `src/lib/call-logs.functions.ts`: tighten the `follow_up_needed` prompt rules to explicit-statement-or-unsigned-agreement only, drop escalation-implies-follow-up from both prompt and `heuristicExtract`, and swap the theme vocabulary in `AnalysisSchema` + prompt.
- `src/lib/patterns.*`: keep threshold logic, point it at the new reason keys.
- `src/routes/_authenticated/dashboard.tsx`: per-call scatter data memo (one point per log with time-of-day y), goal-ring + totals-board + money-board components, retention-trend goal `ReferenceLine`, cancel-reason bar chart, reminders list, removal of the discount/follow-up/weekday cards, and the new dark shell.
- New generated background images in `src/assets`. No schema or migration changes.
