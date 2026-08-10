# Compact dashboard layout, rotating Daily Briefing, monthly call-volume chart

## 1. Tighter, balanced grid
- Keep the KPI strip and commission strip as-is (already compact), but reduce vertical gaps between the main sections.
- Composer stays top-left. The chart cluster next to it becomes a consistent 2-column grid with equal card heights (chart body height drops from 140px to 120px) so nothing looks lopsided.
- The "Follow-ups" card shrinks into a compact stat tile and shares a row with the small Category-mix donut, freeing space for the new monthly chart.
- Call log panel: capped height with its own internal scroll (about 8-10 rows visible) instead of growing the whole page, and denser row padding. The page itself should fit on one screen at 1280x800 with only the log list scrolling.
- Insights column keeps its 320px width on xl and stacks under the log on smaller screens.

## 2. Daily Briefing section
- Pull the daily briefing out of the AI insights sidebar into its own labeled section directly above the log/insights row, full width.
- The briefing text is split into individual highlight lines; one shows at a time and rotates every ~6 seconds with a fade-out/fade-in transition (existing `animate-fade-in` / `animate-fade-out` utilities, cross-faded by keying on the active index).
- Dots let the user jump to a highlight; rotation pauses on hover. If only one highlight exists, it renders statically with no rotation. Empty state shows a short "log a call" hint.
- The sidebar keeps the score plus overall performance review so nothing is duplicated.

## 3. Monthly call-volume trend
- New chart card: total calls logged per day across the last 30 days, as a bar chart with a smoothed line overlay for the running trend.
- Built from a new 30-day aggregation over `logs` using `call_date ?? created_at`, one bucket per day with zero-fill so gaps show as empty days.
- Tooltip shows the date and call count; x-axis labels thinned to every ~4 days to stay readable at compact width. Clicking a bar filters the call log to that day (reuses the existing day filter).
- Placed as a wide card spanning the full chart column so the month reads left-to-right without crowding.

## Technical notes
- All changes are in `src/routes/_authenticated/dashboard.tsx`; no backend, schema, or AI-prompt changes.
- Add a `monthSeries` memo (30-day zero-filled day buckets, count of logs) alongside the existing `timeseries` memo.
- Add a `DailyBriefing` component (local to the file) that parses `insightsQuery.data.daily` into lines and rotates them with a `setInterval` + fade key; reuses `MarkdownBlock` for per-line rendering.
- Chart cards keep using `ChartCard`, recharts, and `CATEGORY_META` hex tokens — no hardcoded color classes.
