# Database Documentation

## Schema Overview
The database uses PostgreSQL, managed by Prisma ORM (`packages/db/prisma/schema.prisma`).

**Core Entities:**
- `Organization`: Represents a Zoho Organization.
- `Customer`: Represents a Zoho Customer.
- `Domain`: Represents a single domain name.
- `Subscription`: Links a Domain, Customer, and Item. Contains `startDate`, `endDate`, `quantity`, `subscriptionPrice`, and `billingCycle`.
- `RenewalHistory`: Tracks individual renewals for subscriptions, linking to a Zoho Estimate and its resulting Tax Invoice. Live Zoho statuses are synced on demand into `zoho_estimate_status` and `zoho_invoice_status` (added 08 Jul 2026), alongside `invoice_id`/`invoice_number`/`payment_id`/`payment_date`. The Refresh action on the subscription detail page walks estimate → invoice → payment and persists all of these.
- `RenewalBatch`: Groups multiple `RenewalHistory` records together for bulk operations (e.g., when 100+ domains are renewed together). Stores metadata like `isAnnexureGenerated`.
- `ZohoDocumentPdf` (`zoho_document_pdf`, added 18 Jul 2026): DB cache of Zoho estimate/invoice **PDF bytes** (`pdf_data BYTEA`), keyed `(organization_id, entity_type, zoho_doc_id)`. Populated on demand by the "View PDF" flow (`ZohoService.getDocumentPdf` → `GET /{estimates|invoices}/{id}?accept=pdf`) so repeat opens cost 0 Zoho calls; invalidated by the webhook path (`estimate_updated`/`invoice_created`/`payment_added`). See `AI_CONTEXT/DECISIONS.md`.
- `CsvImportLog` (`csv_import_logs`, added 01 Jul 2026): Append-only audit trail for subscriptions CSV bulk import runs (`/api/subscriptions/import-csv`). Stores `totalRows`/`updatedCount`/`skippedCount`/`errorCount` plus the full `skippedRows`/`errorRows` JSON detail, so import results remain reviewable after the API response is gone. See `AI_CONTEXT/DECISIONS.md`.

## Migrations Strategy
- Changes to the schema are made in `schema.prisma`.
- Applied using `npx prisma db push` (for rapid development) or `npx prisma migrate dev` (for production-ready migrations).
