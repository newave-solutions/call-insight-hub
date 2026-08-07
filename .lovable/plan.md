# Role onboarding + role-aware dashboard

## Goal
New users pick their role (Customer Experience Specialist / CES or Customer Experience Manager / CEM) once, the choice is saved to their settings, and the dashboard shows only the widgets that matter for that role. The role stays switchable later.

## 1. Onboarding step
- On first load of the dashboard, read the saved role from the user's settings.
- If no role is saved yet, show a blocking onboarding card (centered, cannot be dismissed) with two large choices:
  - Customer Experience Specialist — reschedules, re-services, payments, billing, inquiries.
  - Customer Experience Manager — saves, closes, resigns, leads, cancel-pending follow-ups.
- Selecting one saves it immediately and drops the user into the dashboard. Existing users with a saved role never see this screen.
- A small role badge in the dashboard header lets the user switch role at any time (traffic changes roles day to day), saving the new value the same way.

## 2. What each role sees
Retention widgets are hidden for specialists, and service/billing widgets are de-emphasized for managers.

| Surface | Manager (CEM) | Specialist (CES) |
| --- | --- | --- |
| KPI cards | Saved, Closed, Resign, Lead, Cancel Pending, Pending Cancel, Reactivation, Inquiry | Reschedule, Re-service, Payment, Payment Promised, Billing Update, Refund, Resign, Inquiry |
| Money strip | Resign contract value, discount totals | Payments collected, refunds issued, discount totals |
| Charts | Outcomes trend + category mix limited to retention outcomes; discount $/day; follow-ups | Outcomes trend + category mix limited to service/billing outcomes; payments vs refunds per day; follow-ups |
| Log table columns | Category, customer, agreement length, price, discount | Category, customer, payments $, refunds $, discount |
| Category filter chips | Retention-first ordering | Service/billing-first ordering |
| Daily totals tracker | Retention columns | Service columns incl. Payments/Refunds (already role-aware) |

Nothing is deleted from the data model: logging, editing outcomes, and the detail drawer keep every category available regardless of role, since one call can carry outcomes from both worlds. Only the analytics surfaces are filtered.

## 3. Technical notes
- No database change needed: `user_settings.role` already exists with a `ces` default, and `getUserSettings` / `setUserRole` server functions are already implemented.
- Because the column defaults to `ces`, "new user" is detected by the absence of a `user_settings` row (`getUserSettings` returns `role: null`) — that is the onboarding trigger.
- Dashboard changes in `src/routes/_authenticated/dashboard.tsx`:
  - Replace the hardcoded `useState<Role>("cem")` with a `useQuery` on `getUserSettings` plus a `useMutation` on `setUserRole` that invalidates the settings query.
  - Extract a new `RoleOnboarding` component and a `RoleSwitcher` header control.
  - Add a `CHART_CATEGORIES_BY_ROLE` map alongside the existing `KPI_BY_ROLE`, and drive the category-mix pie, filter chips, and money strip from the active role.
  - Add a payments-vs-refunds chart rendered only for CES, keeping the discount chart for CEM.
- Loading state: render the existing skeleton/empty shell while the role query is in flight so the onboarding card does not flash for returning users.
