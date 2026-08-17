# Quality audit + Voice-of-Customer pattern tracking

## Part 1 — Audit findings

### What is genuinely strong
- Every call gets an outcome: AI extraction plus a deterministic keyword fallback plus a confirm-tags popup. That "never lose a call" chain is the right architecture for agents typing shorthand.
- Domain fidelity is high: authority limits, GEOC, commission drivers, CES/CEM split, multi-outcome tagging, coupon-as-dollars logic.
- Role-aware KPIs and charts keep each role's screen relevant.

### Correctness risks (fix first)
1. **Timezone drift.** Daily grouping in the UI uses local dates, but `generateInsights` builds "today" from `toISOString()` (UTC). After 6pm Mountain the briefing summarizes the wrong day. One shared day-key helper, agent timezone respected everywhere.
2. **Row access policy scope.** The `call_logs` policy is granted to the broad `public` role rather than `authenticated`. Same rule, tighter role.
3. **Unbounded history load.** `listCallLogs` returns every row ever, and the client filters. Fine at 500 calls, painful at 20k. Move to a month-scoped query keyed by the selected day, with a lightweight per-day count query feeding the scatter chart and day tabs.
4. **Insights cost and jitter.** `generateInsights` ships up to 500 full call rows to the model on every change in log count, twice (daily + overall). Replace with a pre-aggregated stats payload plus ~30 recent summaries, persist the result in a table, and regenerate on demand or once per day.
5. **Duplicate handling is detect-only.** Warnings appear but there is no merge action; two rows for the same call silently double-count commissions.

### Product gaps a retention floor would notice immediately
- **No customer view.** `customer_id` is free text with no rollup. An agent picking up a repeat caller cannot see "this account was saved twice and already has a 30% coupon". This is the single highest-value missing screen.
- **No follow-up work queue.** `follow_up_needed` is stored but never surfaced as a due-today list; sent-agreements-awaiting-signature quietly die.
- **No goals/targets.** Score without a target is a vibe. Monthly save-rate, resign, payment and lead targets with pace-to-goal make the dashboard actionable.
- **No commission ledger.** Payments, signed resigns, sold leads and (for CEM) saves are tracked, but there is no "what I earned this period" statement — the number agents care about most.
- **No discount discipline view.** Authority limits are encoded but nothing flags a call that exceeded them or shows discount dollars given vs. revenue retained.
- **No export**, no CSV/print for one-on-ones with a manager.
- **Mobile ergonomics.** The composer and tables are desktop-first; agents wrap up calls on a laptop but review on a phone.

### Code health
- `dashboard.tsx` is ~2.5k lines holding routing, queries, stats math, five charts, drawer, dialogs and the ticker. Split into `src/components/dashboard/*` (KpiStrip, VolumeScatter, OutcomeMix, LogTable, DetailDrawer, Composer, InsightTicker) with stats math in `src/lib/call-stats.ts` — pure and testable.
- Stats/tally logic has no tests. Add vitest coverage for `logCategories`, coupon dollarization, and the keyword parser's offered/declined guards, which are the rules most likely to regress.

## Part 2 — Pattern tracking (the new feature)

Goal: the app notices what a human misses — recurring reasons customers churn, and which behaviors or people they name.

### What gets captured per call
On top of outcomes, extraction returns:
- **Themes** from a controlled vocabulary so counting is reliable: excessive upselling, price increase, contract/term confusion, billing surprise or autopay dispute, pest not resolved, missed or late appointment, tech professionalism, poor communication, moving/selling home, financial hardship, competitor offer, service frequency too high, property access issues, no longer needs service.
- **A short verbatim quote** as evidence for each theme.
- **Named entities**: technician or specialist name, branch/route, plan type — so "the specialists keep upselling on the route" resolves to a specific route or person.
- **Severity** (mentioned / frustrated / cancel driver) and whether the theme was the stated cancel reason.

### The pattern engine
- Rolling windows (7 / 30 / 90 days) count themes and entities. A theme becomes a **signal** when it clears a threshold: 3+ occurrences in 30 days, or 2+ where it was the cancel driver, or a 2x jump versus the prior window.
- **Repeat-customer detection**: the same `customer_id` raising the same theme on 2+ separate calls is escalated immediately regardless of volume — that is an account about to leave.
- **Entity detection**: a technician or route named in 3+ negative themes surfaces as a coaching flag, not a customer flag.

### What the agent and manager see
- **Watchlist card** on the dashboard: ranked signals with count, trend arrow, top verbatim quote, and affected accounts. Click opens the underlying calls.
- **Toast at capture time**: "3rd upselling complaint this month" right after logging, while the call is still fresh.
- **Alerts inbox** with acknowledge/mute/resolve, so a known and accepted pattern stops nagging.
- **Themes tab** with a stacked-by-week view of cancel reasons — the artifact a manager actually brings to a branch meeting.
- **Account panel**: opening a log shows that account's prior themes and outcomes so the agent walks in informed.
- Insights prompts gain the aggregated theme counts, so the daily briefing can say "upsell fatigue is your top churn driver this week" instead of generic coaching.

## Technical notes
- Migration: `call_log_themes` (id, user_id, call_log_id fk cascade, theme text, severity text, is_cancel_driver bool, quote text, entity_type text, entity_name text, created_at) and `pattern_alerts` (id, user_id, kind, key, window_start, count, status ['open','ack','muted','resolved'], payload jsonb, created_at, updated_at). Both: GRANT select/insert/update/delete to `authenticated`, GRANT ALL to `service_role`, enable RLS, `auth.uid() = user_id` policies. Indexes on `(user_id, created_at)`, `(user_id, theme)`, `call_log_id`.
- `AnalysisSchema` in `src/lib/call-logs.functions.ts` gains a `themes[]` array with an enum theme, severity enum, quote, cancel-driver flag and optional entity; the deterministic parser gets keyword fallbacks for the same vocabulary so themes still land when the model is unsure. Theme rows are written alongside the log in save/bulk/manual paths.
- New `src/lib/patterns.functions.ts`: `listPatternSignals` (window-aggregated counts + trend + top quotes + accounts), `getAccountHistory(customer_id)`, `updateAlertStatus`. Threshold evaluation runs server-side after each save and upserts `pattern_alerts` so the toast and inbox agree.
- Dashboard split into `src/components/dashboard/*`; stats math extracted to `src/lib/call-stats.ts` with vitest tests. New `src/routes/_authenticated/patterns.tsx` for the themes/alerts view with its own `head()` metadata.
- Fixes bundled in: shared local-timezone day-key helper used by both UI and insights, `authenticated`-scoped policy, month-scoped log query plus per-day counts, cached insights row, and a merge action on duplicate detection.
