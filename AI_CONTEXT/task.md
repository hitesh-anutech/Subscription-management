# Task Tracker: Bulk Subscription Management via CSV & Paste

## In Progress
- `[x]` **Phase 1: CSV Export/Import Backend**
  - `[x]` Add `GET /api/subscriptions/export-csv` (or use existing endpoint with format=csv)
  - `[x]` Add `POST /api/subscriptions/import-csv` to process bulk updates
  - `[x]` Support parsing and updating: `subscriptionPrice`, `nextRenewalPrice`, `costPrice`, `startDate`, `endDate`, `lifecycleStatus`

## Pending (To Do)
- `[x]` **Phase 2: CSV Export/Import Frontend UI**
  - `[x]` Add "Export CSV" button to `SubscriptionsTable`
  - `[x]` Add "Import CSV" button and file upload modal
- `[x]` **Phase 3: Textarea Paste Bulk Action**
  - `[x]` Add "Bulk Select via Text" modal to paste domain lists
  - `[x]` Add "Mark as Cancelled" button to the Bulk Action Bar

## Blocked
- None

## Completed
- [x] Gather user requirements and approve plan
