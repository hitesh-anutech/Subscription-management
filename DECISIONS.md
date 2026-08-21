# Decisions Log

## 2026-07-31: Relational Deletion & Server Actions for Bulk Delete

- **Context:** Admin-only bulk delete buttons were failing. Leads deletion failed due to foreign key restrictions (`onDelete: Restrict` on quotes and conversions). Subscriptions bulk delete failed due to direct browser fetch CORS/credential limitations.
- **Decision:** 
  1. Modified NestJS API `LeadsService.remove` to perform relational cleanup in a transaction: first deletes associated `LeadConversion` records, then `QuickQuote` records, and finally the `Lead` itself.
  2. Relaxed Draft-only restriction on quote deletes for Admins to allow cleaning up quotes in any status.
  3. Created `deleteMultipleSubscriptionsAction` server action on Next.js frontend to securely forward credentials and execute API calls on the server, avoiding browser-side CORS issues.
- **Consequence:** Seamless, error-proof, admin-only single and bulk deletion of business records.

## 2026-07-30: System Audit Logs & Reusable History Timeline Popup

- **Context:** User requested log history in Leads, Quotes, Subscriptions, and Domains, represented by a small icon and a modal popup.
- **Decision:** 
  1. Extended Prisma enum `AuditEntityType` with `lead`, `quote`, `subscription`, and `domain`.
  2. Created NestJS `AuditLogsModule` featuring `logAction` and `getLogs` API endpoints.
  3. Injected audit logging across all CRUD actions in core backend services.
  4. Built a client-side `HistoryDialog` component featuring a clock icon and a timeline-styled popup modal.
- **Consequence:** Robust audit logging across all critical business events without cluttered views.

## 2026-07-29: Gmail SMTP Instead of SendGrid / Brevo

- **Context:** SendGrid was configured but test emails returned "Unauthorized" (expired API key). User wanted to migrate away from SendGrid entirely. Brevo was evaluated briefly but rejected because Brevo SMTP requires IP address allowlisting (impractical for a dev machine with a dynamic IP). Gmail SMTP (smtp.gmail.com:587, STARTTLS) was chosen as the replacement.
- **Decision:** Use nodemailer with Gmail SMTP. Auth = Gmail address + App Password (16-char Google App Password — 2FA must be enabled on the Google account). No third-party transactional email service.
- **Consequence:** Simple setup, no API keys to rotate. Trade-off: Gmail has a 500 emails/day limit; fine for internal B2B use. From address must match or be a verified alias of the authenticated Gmail account.

## 2026-07-29: Per-org Gmail SMTP Credentials, Not a Single Global Account

- **Context:** Excel Technologies has multiple organizations (Zoho orgs), each with its own Google Workspace identity. Emails from each org should come from that org's own Gmail address.
- **Decision:** Store `smtp_user` + `smtp_password_encrypted` per org in `org_settings`. `EmailService.resolveSender()` checks org credentials first; falls back to the global `app_settings` SMTP credentials. Encrypted with AES-256-GCM via `CryptoService` using the `ENCRYPTION_KEY` env var.
- **Consequence:** Each org sends from its own Gmail identity. The API never exposes the decrypted password — `OrgSettingsService.getSmtpCredentials()` is internal-only; `findByOrgId()` returns only `isSmtpConfigured: boolean`.

## 2026-07-29: Email Signature Feature Removed

- **Context:** `emailSignatureHtml` was in the `OrgSettings` schema and UI, but the user decided managing it in the UI was unnecessary overhead.
- **Decision:** Remove the signature feature entirely — from the DTO, service, frontend components, and type definitions. No replacement or toggle; the feature is gone.
- **Consequence:** Simpler `OrgEmailConfig` form. The `email_signature_html` column still exists in the database (from the original schema.sql) but is no longer read or written by the application.

## 2026-07-29: `prisma db push` (Not `migrate dev`) for Schema Changes

- **Context:** The DB user (`subs_user`) does not have `CREATE DATABASE` permission, which Prisma Migrate requires to create a shadow database. `prisma migrate dev` fails with a permissions error.
- **Decision:** Use `prisma db push` for all schema changes in this project. This applies schema changes directly without creating migration files.
- **Consequence:** No migration history is tracked in `_prisma_migrations`. Schema is always the Prisma schema file as source of truth. Risk: accidental `--force-reset` wipes the database (as happened on 2026-07-29). Always use `prisma db push` WITHOUT `--force-reset`.

---

## 2026-07-18: Convert Popup Collects Only the Subscription Decision

- **Context:** The "Create Invoice" / "Convert to Customer" popup asked for Domain Name + Service Start Date + the subscription decision. But every quote line item already carries its own domain.
- **Decision:** Remove Domain and Service Start Date from the popup. Keep only the create-now / later / never radio.
- **Consequence:** Simpler popup; correct per-item domains. The backend keeps `domainName`/`serviceStartDate` as optional fallbacks for legacy items.

## 2026-07-18: All Invoice Conversions Route Through the List View

- **Context:** Single-item invoices used a one-item form; multi-item invoices dropped everything but the first item.
- **Decision:** Any conversion (≥1 subscription item) opens the `MultiSubscriptionForm` list view. Manual "+ New Subscription" keeps the classic single form.
- **Consequence:** Rows are created **sequentially** (not in parallel) because parallel rows sharing a domain would race the domain find-or-create on the API.

## 2026-07-18: "Order History" Instead of "Renewal History"; Fresh Sale Included

- **Context:** The subscription detail + customer pages only showed renewals/pro-rata; the original quote and invoice were invisible.
- **Decision:** Rename to "Order History" and include the Fresh sale. On subscription create, write a real `Fresh` row into `renewal_history` (in the same transaction). For pre-existing subscriptions, synthesize a Fresh timeline entry on the fly.
- **Consequence:** `renewal_history` now also holds Fresh rows. The synthesized entry is read-only and marked `synthetic`.

## 2026-07-18: Customer Order History Merges Quotes + Invoices with Linking

- **Context:** Separate "Recent Quotes" and "Recent Invoices" cards duplicated a multi-subscription invoice (once per sub).
- **Decision:** Merge into one Order History table. Group `recentInvoices` by invoice id (amount summed, domains combined). A pushed quote and its resulting invoice share one row.
- **Consequence:** No duplicate invoice rows; the quote↔invoice chain is visible at a glance.

## 2026-07-18: Combined Quote — One Click, No Pre-Selection

- **Context:** Combined Quote required entering a "select mode" first.
- **Decision:** Checkboxes are always visible but start **empty** — the user explicitly picks which subscriptions to combine.
- **Consequence:** Fewer clicks and no accidental "quote everything".

---

## 2026-07-07: Email Compose Modal — Contenteditable vs Raw HTML Textarea

- **Decision:** Use `contenteditable` div. Body state flows one-way INTO the div via `useEffect` on template changes. On send, read `bodyRef.current.innerHTML` directly.
- **Consequence:** Users see the branded Zoho template rendered visually and can edit text directly.

## 2026-07-07: Email Template Editing Scope — Per-Send Only

- **Decision:** The modal supports per-send edits only. Permanent default Zoho Books email template changes must be done in Zoho Books Settings → Email Templates (no API endpoint exists for this).

## 2026-07-07: Resend Always Available

- **Decision:** Always show the send button, labelled "↩ Resend" for already-sent quotes.
- **Consequence:** Users can resend to additional recipients or after correcting content.

## 2026-07-07: To/BCC Not Reset on Template Switch

- **Decision:** To/CC/BCC are preserved across template switches. Only subject and body reload.

## 2026-07-07: Contact Email Pre-Fill Strategy

- **Decision:** `getEmailPreview()` fetches the Zoho contact to build a `contactEmails` list. To field uses `d.to_mail_ids` from Zoho's template response first; falls back to `contactEmails[0].email`.

---

## 2026-07-01: Customer Profile — Recent Invoices Aggregation

- **Decision:** Aggregate `recentInvoices` from `lastInvoiceNumber` / `lastInvoiceDate` cached on `Subscription` records (not live Zoho fetch).
- **Consequence:** Faster loads; invoices not tied to a subscription won't appear.

## 2026-07-01: Customer Profile — Internal Notes Deferred

- **Decision:** Deferred to Phase 2 (requires new `CustomerNote` DB table + migration).

## Earlier: Webhook Lookup via `estimate_id` (Not Custom Field)

- **Decision:** Webhook uses `renewal_history.quoteId = estimateId` (from `invoice.estimate_ids[0]`). Naturally handles individual (1 row) and bulk (N rows) cases.
- **Consequence:** No Zoho custom field setup required.
