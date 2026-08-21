# Current State

**Last Updated: 2026-07-29**

## Project Overview
Subscription-based Billing & Renewal Automation System built on Zoho Books and Next.js, using Prisma for database management. Works alongside Zoho Books across Excel Technologies' organizations to manage quick quotes, leads, subscription lifecycle, and cross-org views.

---

## Latest Updates (2026-07-31) — System Audit Logs + Relational Deletion Fixes

### System Audit Logs (Complete)
* **Backend Module**: Integrated database-backed `settings_audit_log` tracking system using `AuditLogsService` and `AuditLogsController`.
* **Service Injection**: CRUD operations across Leads, Quotes, Subscriptions, and Domains are now logged with actor snapshot.
* **Frontend Component**: Built `HistoryDialog` component (clock icon button with timeline popup modal) and integrated on Lead, Quote, Subscription details, and Domain list view rows.

### Deletion & Security Fixes (Complete)
* **Lead Deletion Constraint Failures**: Fixed Prisma foreign key constraints on deletion by clearing related conversions and quotes first within a transaction.
* **Quote Deletion Draft-only Lock**: Removed status restrictions for Admin-triggered deletions to allow clearing quotes in any state.
* **Subscription Deletion Client-Side CORS Error**: Created `deleteMultipleSubscriptionsAction` server action to handle admin-only bulk deletes, bypassing client-side fetch constraints.

## Previous Updates (2026-07-29) — Email Infrastructure Migration + DB Recovery

### Email: SendGrid → Gmail SMTP (Complete)
Replaced SendGrid with nodemailer using Gmail SMTP (`smtp.gmail.com:587`, STARTTLS).
- **Global SMTP**: Settings → Email Configuration stores Gmail address + App Password (encrypted at rest).
- **Per-org SMTP override**: Each org card stores its own Gmail credentials. If configured, all emails for that org use it; otherwise falls back to global.
- **Signature feature removed**: `emailSignatureHtml` removed from all UI and DTO paths.
- **Email health check**: Updated from `sendgrid_api_key` → `smtp_password` key.

### Per-org Gmail SMTP Credentials (Complete)
New `smtp_user` and `smtp_password_encrypted` columns on `org_settings` table (encrypted with AES-256-GCM).

### Tab-selection Bug Fixed (Complete)
When navigating from a Lead page → +New Quote, if the lead is already a converted Zoho customer (`convertedToZohoCustomerId` is set), the Quote Builder now auto-selects the **Existing Customer** tab.

### Database Recovery (Complete)
The database was accidentally wiped by `prisma db push --force-reset` in a previous session. Recovery steps applied:
1. `CREATE EXTENSION IF NOT EXISTS citext` (citext was missing post-wipe)
2. `schema.sql` executed via psql (functions, sequences, indexes, tables, triggers)
3. `prisma db push --accept-data-loss` (new `smtp_user`, `smtp_password_encrypted` columns synced)
4. `ALTER TABLE ... SET DEFAULT gen_random_uuid()` on `app_settings`, `master_data_lists`, `email_templates`
5. `seed_defaults.sql` executed (42 app_settings, 79 master_data_list rows, 9 email templates seeded)
6. Admin user `hitesh@anutech.in` re-created via seed (password: `ChangeMeFirst!2026`)

---

## Previous Updates (2026-07-18) — Conversion Flow + Order History Overhaul

### Multi-item Quote → Invoice → Subscriptions (Complete)
Converting a quote with multiple line items now creates **all** subscriptions, not just the first.
- New **Create Subscriptions list view** (`subscriptions/new`) — one editable row per invoice item.
- Single-item conversions use the same list view (1 row); manual entry keeps the classic single form.

### Convert Popup Simplified (Complete)
The "Create Invoice" / "Convert to Customer" popup now asks **only** the subscription decision. Domain + Service Start Date fields removed.

### "Order History" replaces "Renewal History" (Complete)
Subscription detail + Customer page now shows the Fresh sale (quote + invoice) plus renewals/pro-rata.

---

## Architecture Status
- **Frontend**: Next.js 14 App Router, Tailwind CSS
- **Backend**: NestJS, Prisma ORM (v5.22), PostgreSQL
- **Integration**: Zoho Books API (customers, items, invoices, estimates/quotes)
- **Email**: nodemailer + Gmail SMTP (per-org override → global fallback)
- **Encryption**: AES-256-GCM via `CryptoService` (ENCRYPTION_KEY env var, 32-byte base64)
- **Webhooks**: `estimate_updated` → `invoice_created` → `payment_added` chain

## Database Status
| Table | State |
|-------|-------|
| All schema tables | ✅ Present (23 tables) |
| `org_settings.smtp_user` | ✅ Column exists (citext) |
| `org_settings.smtp_password_encrypted` | ✅ Column exists (text) |
| `app_settings` | ✅ 42 rows seeded |
| `master_data_lists` | ✅ 79 rows seeded |
| `email_templates` | ✅ 19 rows (9 from seed_defaults + 9 from Prisma seed + 1 overlap?) |
| `users` | ✅ Admin user exists |
| All business data | ⚠️ EMPTY — lost in db wipe; must be re-entered |

## Post-Recovery Setup Required (User Action)
1. Settings → Organizations → **Connect Zoho** (OAuth) for each org
2. For each org → **🔧 Custom Fields** (ensure 4 Zoho custom fields)
3. For each org → **🔄 Sync** (sync customers + items)
4. Settings → Email Configuration → Gmail address + App Password
5. Per-org: Sender Email Config → Gmail address + App Password
6. Re-enter: Master Data, Quick Quote Settings, PDF Branding, Subscription Lifecycle settings
7. Re-create: Leads, Quick Quotes, Subscriptions, Customers data (no backup exists)

## Quote / Conversion Flows Status
| Flow | Status |
|------|--------|
| Renewal Quote (Type 3) | ✅ Complete |
| Pro-rata Quote (Type 4) | ✅ Complete |
| Combined Renewal Quote (multi-sub) | ✅ Complete |
| Quote → Invoice conversion | ✅ Complete |
| Invoice → Subscriptions (multi-item) | ✅ Complete |
| Fresh order in Order History | ✅ Complete |
| Send via Email (Gmail SMTP) | ✅ Complete |
| Webhook chain (Estimate → Invoice → Payment) | ✅ Complete |
| Per-org Gmail SMTP | ✅ Complete |

## Known Limitations / Phase 2 Items
- All business data was lost in the db wipe; there is no backup.
- **Quote number autofill collision** (open bug): browser autofill can inject an existing quote number.
- **Security/authorization gaps**: no RBAC/role checks, no per-user org scoping, unauthenticated Zoho webhook, `DomainStatus` enum drift, unsanitized email HTML.
- **`CsvImportLog` schema drift**: model exists in `schema.prisma` but has no migration file.
- **Internal Notes**: deferred to Phase 2.
- **Live Invoices**: aggregated from cached subscription fields, not live Zoho fetch.
