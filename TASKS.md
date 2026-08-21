# Tasks

## Completed

### Session: 2026-07-31 — System Audit Logs & Secure Deletion
- [x] Create backend audit log service, controller and database synchronization
- [x] Inject audit logging into Leads, Quotes, Subscriptions, and Domains CRUD operations
- [x] Create frontend `HistoryDialog` reusable clock-icon timeline popup component
- [x] Integrate `HistoryDialog` on Lead, Quote, Subscription details, and Domain rows
- [x] Fix Lead deletion foreign-key constraint failures (cascade deletes in transaction)
- [x] Fix Quote deletion draft-only constraint for Admin actions
- [x] Fix Subscriptions bulk delete client-side fetch CORS errors (swapped with server action)

### Session: 2026-07-29 — Email Migration + DB Recovery
- [x] Fix wrong tab selection on Lead → +New Quote for converted leads
  - [x] Added `convertedToZohoCustomerId` to `Lead` interface in `new/page.tsx` and `quote-builder.tsx`
  - [x] Derived `isConvertedLead` flag; auto-select "existing" tab when flag is true
  - [x] Pre-fill `zohoCustomerId` + `zohoCustomerName` for converted leads
- [x] Investigate "Unauthorized" error on SendGrid test email
  - [x] Root cause: expired/invalid API key; also extracted deeper error from `ResponseError.response.body`
- [x] Migrate email from SendGrid to Brevo (evaluated; abandoned — IP allowlist restriction)
- [x] Migrate email from Brevo to Gmail SMTP (nodemailer, smtp.gmail.com:587, STARTTLS)
  - [x] Rewrote `email.service.ts` — nodemailer transporter, `resolveSender()` with per-org → global fallback
  - [x] Removed `@sendgrid/mail`; added `nodemailer` + `@types/nodemailer`
  - [x] Updated health check: `sendgrid_api_key` → `smtp_password`
  - [x] Updated `email-settings-form.tsx`, `actions.ts`, `page.tsx` for Gmail SMTP fields
- [x] Remove Email Signature feature
  - [x] Removed `emailSignatureHtml` from `update-org-settings.dto.ts`
  - [x] Removed from `org-settings.service.ts` (upsert + findByOrgId)
  - [x] Removed from all frontend components
- [x] Per-org Gmail SMTP credentials
  - [x] Added `smtpUser` + `smtpPasswordEncrypted` to Prisma schema (`OrgSettings`)
  - [x] `OrgSettingsService`: `upsert()` encrypts password; `findByOrgId()` returns `isSmtpConfigured`; new `getSmtpCredentials()` internal method
  - [x] `OrgSettingsModule` imports `CryptoModule`
  - [x] `EmailModule` imports `OrgSettingsModule`
  - [x] `org-email-config.tsx` rewritten — Gmail Address + App Password fields, "SMTP ✓" badge
  - [x] `api.ts` Organization type updated (`smtpUser`, `isSmtpConfigured`, removed `emailSignatureHtml`)
- [x] Database recovery after accidental `prisma db push --force-reset`
  - [x] Re-enabled `citext` extension
  - [x] Re-ran `schema.sql` via psql (all tables, functions, triggers, sequences)
  - [x] `prisma db push --accept-data-loss` (synced new `smtp_user` / `smtp_password_encrypted` columns)
  - [x] Fixed missing `gen_random_uuid()` defaults on `app_settings`, `master_data_lists`, `email_templates`
  - [x] Re-ran `seed_defaults.sql` (42 settings, 79 master data rows, 9 email templates)
  - [x] Re-created admin user `hitesh@anutech.in` via seed

### Session: 2026-07-18 — Conversion Flow + Order History
- [x] Multi-item invoice → create **all** subscriptions (was: first item only)
- [x] Simplify Convert popup — remove Domain + Service Start Date fields
- [x] Use each quote item's own domain for subscription prefill + Zoho invoice line CF
- [x] "Renewal History" → "Order History" on subscription detail page
- [x] Customer page: merge "Recent Quotes" + "Recent Invoices" into one Order History table
- [x] Customer page: View action + clickable Sub #; one-click Combined Quote; search+filters; collapsible Mapped Domains
- [x] Full multi-agent code review (findings logged in BUGS.md)

### Session: 2026-07-07 — Send Quote Email Modal
- [x] Fix "View in Zoho" link (`/estimates/` → `/quotes/`)
- [x] Send Quote Email modal (template selector, CC, contact suggestions, contenteditable body, success screen, resend)
- [x] `GET /api/subscriptions/renewal-history/:historyId/email-preview` endpoint
- [x] `POST .../send` extended with `ccMailIds`, `subject`, `body`

### Earlier Sessions
- [x] Renewal Quote (Type 3), Pro-rata Quote (Type 4), Combined Renewal Quote
- [x] Renewal Batches History page + backend route
- [x] Webhook chain refactor — `estimate_id` based lookup
- [x] Customer Profile CRM redesign; bulk activate/cancel; CSV import
- [x] Multi-currency Phase 1 (native currency + exchange_rate on subscriptions)

---

## In Progress
- None.

---

## Pending — Immediate (Post-DB-Wipe Recovery, User Action Required)
- [ ] **Re-connect Zoho organizations** — Settings → Organizations → Connect Zoho (OAuth) for each org
- [ ] **Re-sync custom fields** — per-org → 🔧 Custom Fields button
- [ ] **Re-sync customers + items** — per-org → 🔄 Sync button
- [ ] **Re-configure Global Email** — Settings → Email Configuration → Gmail address + App Password
- [ ] **Re-configure Per-org Email** — each org → Sender Email Config → Gmail + App Password
- [ ] **Re-enter master data** — Quick Quote Settings, PDF Branding, Subscription Lifecycle
- [ ] **Re-create business data** — Leads, Quick Quotes, Subscriptions (no backup exists)

---

## Pending — High Priority (from 2026-07-18 review; see BUGS.md)
- [ ] **Fix quote-number autofill collision** — add `autoComplete="off"` to Quote Number input; catch P2002 in `quick-quotes.service.ts`; optionally reject manually-typed `QQ-YYYY-NNNN` format.
- [ ] **Authorization layer** — add `RolesGuard` + `@Roles()`; enforce per-user `allowed_org_ids` scoping in every service that takes an `org_id`.
- [ ] **Zoho webhook signature verification** — verify per-org secret; reject unknown/`null` `org_id`.
- [ ] **`DomainStatus` enum drift** — migration.sql CHECK (`active/inactive/transferred/lost`) vs Prisma enum (`active/inactive/suspended`); reconcile.
- [ ] **Sanitize email HTML** — DOMPurify on the compose modal body + template preview.

---

## Pending — Medium / Phase 2
- [ ] Serialize Zoho token refresh (per-org lock) to avoid concurrent refresh race.
- [ ] Idempotency pre-check on lead conversion (avoid duplicate Zoho contacts on retry).
- [ ] Distributed lock on scheduler cron jobs (double-fire risk in multi-instance).
- [ ] `CsvImportLog` — create a proper migration (model is in schema.prisma but no migration file exists).
- [ ] Standardize pro-rata money math (two differently-ordered float formulas).
- [ ] Internal Notes on Customer Profile (needs `CustomerNote` table).
- [ ] Live Zoho invoice fetching on Customer Profile.
- [ ] Align Prisma client versions (`packages/db` ^5.14 vs `apps/api` ^5.22).
- [ ] Production: CI/CD pipelines, environment variables, secret rotation.
- [ ] Create a proper database backup strategy.
