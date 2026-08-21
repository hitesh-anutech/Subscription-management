# Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased] — 2026-07-31

### Added
- **System Audit Logs Module**: Registered globally on NestJS backend. Logs actions like create, update, delete, status sync, and Zoho sync in the `settings_audit_log` table.
- **Frontend `HistoryDialog` Popup**: Displays clock icon triggering a timeline-styled glassmorphic modal with detailed audit trail for leads, quotes, subscriptions, and domains.
- **Subscriptions Bulk Delete Server Action**: `deleteMultipleSubscriptionsAction` server action to handle admin-only bulk deletes via server-side execution.

### Fixed
- **Lead Deletion Constraint Failures**: Modified `LeadsService.remove` to perform relational deletion of `LeadConversion` and `QuickQuote` within a transaction before deleting the `Lead` (bypasses `onDelete: Restrict`).
- **Quote Deletion Draft-only Lock**: Removed status verification in `QuickQuotesService.remove` for Admin-triggered deletes to allow clearing quotes in any state.
- **Subscription Deletion Client-Side CORS Error**: Swapped browser-side `api.delete` fetch calls with secure server action `deleteMultipleSubscriptionsAction`.

## [Unreleased] — 2026-07-29

### Added
- **Per-org Gmail SMTP credentials** (`org_settings.smtp_user`, `org_settings.smtp_password_encrypted`): each organization can now have its own Gmail address + App Password. Encrypted at rest via AES-256-GCM (`CryptoService`).
- **`OrgSettingsService.getSmtpCredentials(orgId)`**: internal-only method that decrypts and returns SMTP credentials; never exposed via the API.
- **`isSmtpConfigured` flag** on `OrgSettingsService.findByOrgId()` response: `boolean` derived from whether `smtp_user` + `smtp_password_encrypted` are both set; the encrypted password is never returned.
- **"SMTP ✓" badge** on the org card header when per-org SMTP is configured.
- **Gmail SMTP fields in Org Email Config** (`org-email-config.tsx`): Gmail Address + App Password with show/hide toggle; password field blank = keep existing, new value = update.

### Changed
- **Email transport: SendGrid → Gmail SMTP** (`email.service.ts` rewritten):
  - Uses nodemailer with `smtp.gmail.com:587`, STARTTLS.
  - `resolveSender()`: checks per-org credentials first; falls back to global `app_settings` SMTP credentials.
  - Constructor now injects `OrgSettingsService` (for per-org creds) and `PrismaService` (for `sendFromTemplate`).
- **`email.module.ts`**: added import of `OrgSettingsModule` so `OrgSettingsService` is injectable.
- **`org-settings.module.ts`**: added import of `CryptoModule`.
- **`update-org-settings.dto.ts`**: removed `emailSignatureHtml`; added `smtpUser?: string | null` and `smtpPassword?: string | null`.
- **`org-settings.service.ts`**: `upsert()` encrypts `smtpPassword` before storing; if `smtpPassword === null` → clears; if `''` (empty) → keeps existing.
- **`health.controller.ts`**: health check key changed from `sendgrid_api_key` → `smtp_password`.
- **`apps/api/package.json`**: removed `@sendgrid/mail`; added `nodemailer ^6.9.0` + `@types/nodemailer ^6.4.14`.
- **Email Settings page** (`settings/email/`): SendGrid API Key field replaced by Gmail Address + App Password fields; status banner checks `smtp_password` key.
- **`api.ts` (web)**: `Organization.orgSettings` type updated — added `smtpUser`, `isSmtpConfigured`; removed `emailSignatureHtml`.
- **`org-card.tsx`**: passes `currentSmtpUser` + `isSmtpConfigured` to `OrgEmailConfig`.
- **`org-email-config.tsx`**: completely rewritten — Gmail credentials section replaces email signature textarea.

### Fixed
- **Wrong tab on Lead → +New Quote for converted leads**: `quote-builder.tsx` had `preselectedLead ? 'lead' : 'lead'` (both branches same). Fixed with `isConvertedLead` flag from `preselectedLead?.convertedToZohoCustomerId`; auto-selects "Existing Customer" tab and pre-fills `zohoCustomerId`/`zohoCustomerName`.
- **`sendFromTemplate` accidentally removed**: Brevo rewrite had replaced it with a `throw`. Restored the original Prisma-based template lookup + render + send in the Gmail version.

### Database
- **`org_settings` table**: added columns `smtp_user` (citext, nullable) and `smtp_password_encrypted` (text, nullable).
- **Schema recovery**: entire DB was wiped by accidental `prisma db push --force-reset`; recovered by running `schema.sql` + `prisma db push` + `seed_defaults.sql` + admin user seed.
- **`app_settings`, `master_data_lists`, `email_templates`**: `ALTER TABLE ... SET DEFAULT gen_random_uuid()` applied so seed SQL inserts work without explicit IDs.

---

## [Unreleased] — 2026-07-18

### Added
- **Multi-item subscription creation** (`subscriptions/new/_components/multi-sub-form.tsx`): compact list view for creating subscriptions from a converted invoice — editable domain, cycle, qty, price, cost, start/end per row; select-all; per-row success/error.
- **`createSubscriptionsBulkAction()`** server action with `BulkSubContext` / `BulkSubRow` types.
- **Order History** on the customer page — quotes + invoices merged into one table with Quote/Invoice linking, per-number dates, and Zoho invoice deep-link.
- **Search + filters** (text / status / domain / expiring ≤30d) on customer page Active Subscriptions.
- **View** action + clickable Sub # on customer Active Subscriptions rows.
- **Fresh order row**: `POST /subscriptions` now writes a `Fresh` `renewal_history` row in a transaction.

### Changed
- **Convert popup** (`conversion-details-fields.tsx`): removed Domain Name + Service Start Date inputs — decision radio only.
- **`conversions.service.ts`**: per-item `primaryDomain` for invoice line CF + subscription prefill.
- **`subscriptions/new/page.tsx`**: `FormSwitch` routes any conversion to the list view; manual entry keeps classic form.
- **Subscription detail page**: "Renewal History" → "Order History"; shows Fresh sale (real or synthesized).
- **`getCustomerDetail()` (`zoho.service.ts`)**: `recentInvoices` grouped by invoice id (dedupe).
- **Combined Quote**: one-click, checkboxes always visible, not pre-selected.
- **Mapped Domains** (customer page): collapsible via native `<details>`.

### Fixed
- Multi-item invoice created only the first subscription — now creates all items.
- All conversion subscriptions inherited one domain — now per-item.
- Fresh sale invisible in history — Fresh row written/synthesized.
- Invoice duplicated in customer Order History (once per subscription) — grouped by invoice id.

---

## [Unreleased] — 2026-07-07

### Added
- **Send Quote Email Modal**: template selector, To/CC fields, contact suggestion chips, contenteditable HTML body, success screen, resend support.
- **`GET /api/subscriptions/renewal-history/:historyId/email-preview`** endpoint.
- **`getEmailPreviewAction()`** Server Action.

### Changed
- **`POST .../send`**: now accepts `ccMailIds`, `subject`, `body` overrides.

### Fixed
- "View in Zoho" link returning 404 (`/estimates/` → `/quotes/`).

---

## [Unreleased] — 2026-07-01

### Added
- Customer Profile Redesign (CRM-style dashboard).
- Bulk Activate / Bulk Cancel on `SubscriptionsTable`.
- Individual Status Toggle (`ToggleStatusButton`).

### Changed
- `getCustomerDetail` API returns richer data (stats, domain sub counts, recent invoices).

### Fixed
- Browser crash on CSV upload (`accept=".csv"` removed).
- CSV import "0 update" bug (date parsing + `Suspend(ed)` → `Inactive`).
- "Unsupported Server Component type" crashes.
- Prisma `businessType` field error on `QuickQuote` select query.
