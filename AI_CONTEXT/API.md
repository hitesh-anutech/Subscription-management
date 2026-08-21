# API Documentation

## Base URL
Backend APIs are hosted at `/api` (NestJS).
Frontend API client forwards requests to this base URL.

## Authentication
- Handled via `subs_session` cookie containing a JWT.
- Zoho API requests are authenticated using OAuth tokens managed by the `ZohoService`.

## Core Endpoints

### Subscriptions
- `GET /api/subscriptions`: Fetch a paginated list of subscriptions with filters.
- `POST /api/subscriptions/bulk-update-price`: Update the price of multiple subscriptions simultaneously.
  - **Payload:** `{ subscriptionIds: string[], newPrice: number }`
- `POST /api/subscriptions/bulk-renewal-quote`: Generate a consolidated Zoho Estimate for selected subscriptions. Automatically creates Annexure PDFs for 100+ domains.
  - **Payload:** `{ subscriptionIds: string[] }`
- `GET /api/subscriptions/export-csv`: Download filtered subscriptions as CSV.
- `POST /api/subscriptions/import-csv`: Upload a CSV (`multipart/form-data`, field `file`) to bulk-update `price`, `costPrice`, `nextRenewalPrice`, `startDate`, `endDate`, `status`. Every run is persisted to `csv_import_logs` (see DATABASE.md).
  - **Response:** `{ success, importLogId, totalRows, updatedCount, skippedCount, errorCount, skipped?: string[], errors?: string[] }`. `skipped` = rows with a blank ID or no recognized columns; `errors` = rows that failed validation or the DB update (e.g. unknown subscription ID).
- `GET /api/subscriptions/import-logs?limit=20`: List recent CSV import runs (summary only).
- `GET /api/subscriptions/import-logs/:logId`: Full detail of one import run, including the raw `skippedRows`/`errorRows` JSON.
- `GET /api/subscriptions/import-logs/:logId/errors-csv`: Download a CSV of that run's skipped + error rows, for the user to fix and re-upload.

- `PATCH /api/subscriptions/:id`: Update editable fields — `quantity`, `subscriptionPrice`, `nextRenewalPrice`, `costPrice`, `billingCycle`, `startDate`, `endDate`, `nextRenewalDate`, `autoRenew`, `notes`. (Local record only; does not mutate Zoho documents.)

### Renewal History (per subscription)
- `POST /api/subscriptions/renewal-history/:historyId/refresh`: Sync live status from Zoho — reads the estimate, follows the linked invoice, and persists `zohoEstimateStatus`, `zohoInvoiceStatus`, invoice/payment refs, and `renewalStatus`.
- `GET /api/subscriptions/renewal-history/:historyId/email-preview`: Zoho estimate email content (subject/body/to/cc/bcc + templates).
- `POST /api/subscriptions/renewal-history/:historyId/send`: (Re)send the estimate/proforma to the customer via Zoho.
- `GET /api/subscriptions/renewal-history/:historyId/invoice-email-preview`: Zoho **Tax Invoice** email content.
- `POST /api/subscriptions/renewal-history/:historyId/send-invoice`: (Re)send the **Tax Invoice** to the customer via Zoho.

### Domains
- `GET /api/domains`: Paginated domains list. Filters: `org_id`, `search`, `status` (active/inactive/suspended), `page`, `limit`. Response includes inline `subscriptions`, `activeSubsCount` (Active + Expiring_Soon) per domain, and a `stats` block (`total`/`active`/`suspended`/`inactive`).
- `GET /api/domains/export-csv`: Download filtered domains as CSV (`org_id`, `search`, `status`). Static route — declared before `@Get(':id')`.

### Customers
- `GET /api/organizations/:id/customers/:zohoId`: Customer detail + linked subs/domains/quotes. Fetches the **full live Zoho contact** and merges it into `customer.extra` (billing_address incl. country, contact_persons, portal_status, `contact_number` = Zoho Customer Number).

### Documents (Quotes & Invoices browser)
- `GET /api/organizations/:id/documents`, `GET /api/organizations/:id/document-columns`, `GET/POST/DELETE /api/document-views`: filtered live fetch, dynamic column catalog, and private per-user saved views (see CHANGELOG 2026-07-14).
- `GET /api/organizations/:id/documents/:kind/:docId/pdf`: Stream a Zoho estimate/invoice **PDF** (`kind` = `estimate`/`invoice`). DB-cached in `zoho_document_pdf` (first call fetches `…?accept=pdf` from Zoho + stores; repeats serve from cache). Query: `?download=1` → attachment (else inline), `?force=1` → bypass cache + re-fetch. Auth via the global guard (session cookie). Powers the reusable **View PDF** button.

### Zoho Sync
- `POST /api/zoho/sync`: Trigger a sync of customers, items, and subscriptions from Zoho Books into the local database.

## Zoho Books Deep Links
All UI deep links to Zoho Books are built as `https://books.zoho.{tld}/app/{zohoOrgId}#/{entity}/{id}`, where `{entity}` is one of `contacts` / `invoices` / `estimates` and `{tld}` is derived from the org `dataCenter` enum (`in`, `com`, `eu`, `com.au`, `jp`, `sa`).

> ⚠️ **Estimate deep links use the `#/quotes/` web route, not `#/estimates/`** (the latter 404s — "Page Not Found"). The builders (`zohoUrl`, `zohoBooksUrl`) translate the `estimates` entity to a `quotes` path segment. This is **web-route-only**; the Zoho REST API entity stays `estimates`. (Fixed 2026-07-13.)
