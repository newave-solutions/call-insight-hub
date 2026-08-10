# Never lose a call: deterministic fallback, frozen = closed, confirm-tags popup, full outcome editing

## 1. Deterministic fallback parser (always assigns a category)
The local keyword parser already exists but is thin and only runs when the AI call throws. Changes:

- Run it in **two situations**: (a) the AI call fails or returns unusable JSON, and (b) the AI returns an empty/unclassifiable outcome list. Its keyword hits are also merged in when the AI returned outcomes but missed an explicit keyword that is clearly present.
- Broaden and order the keyword rules so the required words always land somewhere: saved/retained, resign/re-sign/new agreement/price reduction, lead/inside sales, cancel pending, pending cancel, closed/cancelled, frozen/freeze, reschedule/push/move service, payment/paid/card ran/balance, payment promised, refund, re-service, back on schedule, billing update, reactivation, escalation.
- Precedence rules so overlapping words don't mis-tag: "cancel pending" and "pending cancel" beat bare "cancel"; "not cancelling / did not cancel / kept service" reads as saved, not closed; "reschedule" plus "cancel pending" keeps both.
- The parser also keeps its existing extraction of customer number, price, and plan shorthand (PP, PPEOM, PPMOS, RYG…).
- If after all of that no keyword matched, the call is still saved with an explicit **needs-review** state rather than a guessed category (see step 3).

## 2. Frozen is treated exactly like closed
Today "freeze" is a separate tag that is only folded into the closed count in a couple of places.

- Frozen/paused now produces the **closed** outcome directly, with the freeze flavor preserved on the log (it still reads "Closed (frozen)" in the row and drawer).
- The AI prompt is updated to stop emitting a standalone "freeze" outcome and to use "closed" instead.
- Every tally, chart series, daily-total column, and KPI counts frozen inside closed once — no double counting.
- Existing logs already tagged "freeze" keep working: they are displayed and counted as closed.

## 3. Confirm-tags popup when a call can't be classified
The composer currently analyzes and saves in one shot, so an unclear call gets a silent guess.

- Analysis and saving are split: notes are analyzed first and returned as a **draft**.
- If the draft has a confident outcome, it saves immediately as it does today (no extra clicks).
- If it does not — no keyword matched, or the AI was unsure — a modal opens: the parsed draft (customer, plan, price, coupon, summary) plus the multi-outcome tag picker, with any weak guesses pre-selected. The user confirms or corrects the tags and hits Save; nothing is written until they do, and Cancel keeps the notes in the composer so no work is lost.
- Bulk import gets the same safety net: rows that couldn't be classified are saved and then queued in a review dialog that walks the user through tagging them one at a time.

## 4. Full outcome control in the detail drawer
The drawer's outcome picker exists but is only reachable in edit mode and hides some options.

- The multi-outcome picker shows **all** outcome tags, with quantity steppers, so multiple outcomes (and repeats — e.g. two subscriptions closed on one call) can be added or removed on any log.
- Outcomes are editable directly from the drawer header without entering full edit mode, and the primary category always re-derives from the first selected tag.
- A "needs review" log shows a clear banner in the drawer until tags are confirmed.

## Technical notes
- `src/lib/call-logs.functions.ts`: extract the keyword parser into a shared `heuristicExtract` used by both failure and empty-result paths; add a `needs_review` signal on the analysis result; add an `analyzeCallNotes` server function (analysis only, no insert) alongside the existing save path; drop "freeze" from the emitted outcome vocabulary in `SYSTEM_PROMPT` and map it to `closed` in `normalize` while keeping the tag readable for legacy rows.
- Database: one migration adding `needs_review boolean not null default false` to `call_logs` so unconfirmed calls survive a refresh.
- `src/routes/_authenticated/dashboard.tsx`: new `ConfirmOutcomeDialog` used by the composer and the bulk-import review queue; `OutcomeEditor` shown for all categories and surfaced outside edit mode; freeze folded into closed in `stats`, trend, and daily-totals aggregation; needs-review badge in the table and drawer.
