# Stricter outcome tagging, scatter call-volume chart, floating insight ticker, today-first call log

## 1. Tag logic: only outcomes that actually happened
The AI prompt currently lets a mentioned option become a tag. New rules, applied in both the AI prompt and the deterministic keyword parser:

- **Completed vs. offered/declined.** An outcome is only tagged when the notes show it was *done on this call*. Language like "offered", "quoted", "discussed", "sent for review", "will think about it", "declined", "did not accept", "refused", "customer said no" never produces the outcome tag — it produces the real result instead (save attempt failed -> cancel_pending / closed / pending_cancel, or inquiry).
- **Resign** requires the agreement to have been sent *and* signed/accepted ("signed", "agreement signed", "resigned at $X", "e-sign completed", "accepted new agreement"). "Sent agreement, waiting on signature" = no resign tag; it becomes a follow-up instead.
- **Reactivation** only counts when the closed subscription is being reopened *now*. Forward-looking language — "can call back within 6 months to reactivate", "let them know they can reactivate later", "offered reactivation option" — is an option given, not a reactivation. Same treatment for future-dated saves, payments ("will pay next week" is not a payment), and coupons that were quoted but not applied.
- **Negation and reversal handling** in the keyword parser: a keyword hit is dropped when it sits next to declined/offered/future wording ("no", "not", "didn't", "declined", "can", "could", "if they", "within the next X months", "call back"). "Cancel pending" / "pending cancel" precedence stays as it is today.
- Because both layers get stricter, a call whose only signals were offers now lands in the confirm-tags popup rather than being mis-tagged.

## 2. Remove Payment Promised
- "Payment Promised" is dropped as an outcome everywhere: KPI strip, category mix, daily totals columns, outcome picker in the detail drawer and confirm dialog, and the AI vocabulary. A promise to pay later is recorded as an inquiry plus a follow-up note.
- Existing logs still carrying that tag are displayed as-is but no longer counted in the tallies.

## 3. Coupons visible for CES
- CES gains a **Coupons / discounts given** stat next to Payments collected: count of calls with a discount and total dollars given.
- CES commission strip gains the same discount total as a secondary figure, and the CES chart column keeps discount-$-per-day so the money given away is always visible, not just money collected.

## 4. Calls-per-day becomes a scatter chart, and the duplicate goes away
- The "Calls logged per day (last 30 days)" bar/line chart becomes a **scatter/dot chart**: one dot per day, y = calls logged, dot size scaled by call count so heavy days read instantly, with a light average reference line across the month. Clicking a dot opens that day in the call log.
- The **Daily Totals table** and this chart overlap, so the table is removed as a standalone section. Its per-category breakdown moves into the day view of the call log (see step 5) as a compact totals row for the selected day, so nothing is lost.
- The freed space gets a new insight card: **outcome mix by day-of-week** (which days produce saves vs. closes), plus a small "best / worst day this month" callout.

## 5. Call log shows one day at a time
- The log opens on **today** by default instead of every call ever logged.
- Above the table: a horizontal strip of day tabs for the last ~10 days (each showing the date and that day's call count), plus a calendar button to jump to any date. Clicking a calendar date or a scatter dot switches the log to that day.
- The selected day shows a compact totals row (outcome counts + dollars for that day) and the day's calls only — no long scroll. Search still works, and an explicit "All days" toggle stays available for when the full history is needed.

## 6. Agent score / overall performance becomes a floating ticker
- The AI insights sidebar card is replaced by a **semi-transparent floating panel pinned to the right edge** of the app, above the content.
- It cycles through rotating slides — agent score, overall performance highlights, Saela Way notes, standout stats — swapping the text on a timer with a soft cross-fade. Hovering pauses it; dots let you step through; it can be collapsed to a small pill and reopened.
- The Daily Briefing card keeps its own rotating highlights in the main layout, so the two do not duplicate each other; the floating panel carries score/performance only.
- Removing the sidebar frees the log row to full width, making the whole dashboard more compact.

## Technical notes
- `src/lib/call-logs.functions.ts`: rewrite the outcome definitions in `SYSTEM_PROMPT` with a "completed vs offered/declined/future" section and per-tag proof requirements; add negation/future-intent guards to `keywordCategories` and `heuristicExtract`; drop `payment_promise` from `CATEGORY_VALUES` emission (kept in the type union for legacy rows).
- `src/routes/_authenticated/dashboard.tsx`: drop `payment_promise` from `CATEGORY_META` usage lists, `KPI_BY_ROLE`, `TABLE_CATS_BY_ROLE`; add coupon count/total to `stats` and the CES strips; swap the `ComposedChart` for a recharts `ScatterChart` with `ZAxis` sizing and a `ReferenceLine` average; delete the `DailyTotalsTracker` section and add a per-day totals row plus `DayTabs` above the log table; default `dayFilter` to today; add a `FloatingInsightTicker` component rendered at the app edge; add a day-of-week mix chart memo.
- No schema or migration changes; `payment_promise` rows stay readable.
