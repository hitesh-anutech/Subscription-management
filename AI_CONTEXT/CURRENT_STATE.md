# Current Project State

**Last Updated: 2026-07-18**

## Status Overview
The latest work block (**2026-07-18**) added **in-app document PDFs**: (1) a **"View PDF"** button that streams a Zoho estimate/invoice PDF, backed by a new **`zoho_document_pdf`** DB cache (first open = 1 Zoho call, repeats = 0; webhook-invalidated) — wired into the Quotes & Invoices browser, Renewal Batch review, Subscription-detail renewal history, and the converted-invoice actions; (2) the **quick-quote email (SendGrid) now attaches the quote as a generated PDF** (`buildQuotePdf` via pdf-lib; Zoho-sent invoice/quote emails already attach their PDF natively so were left unchanged); (3) **PDF Branding (logo + signature)** now renders on both the app-generated quote PDF and the `/quotes/[id]/print` page (from `org_settings.logoUrl`/`signatureImageUrl`). ⚠️ Typecheck-clean (both apps, exit 0); **not yet run against live Zoho/SendGrid.** Known limit: the pdf-lib quote PDF embeds **PNG/JPEG only** (SVG/WebP logos skipped; currency shown as ISO code; non-Latin-1 text stripped) — the print page's `<img>` has no such limit.

The prior work block (**2026-07-16**) completed the **convert & fresh-sales bulk flow**: (1) **subscription decision at Convert** — the Convert form asks "हाँ, अभी बनाओ / बाद में / नहीं (one-time)" (`quick_quotes.subscription_decision`); (2) **already-converted leads/customers** get a **"🧾 Create Invoice"** path (invoice-only, no duplicate Zoho contact) and their lead page shows a Converted card instead of the Convert panel; (3) **bulk-domains fresh quotes (Option A)** — a quote line's Domain field toggles to a `domain[, qty]` textarea (`quick_quote_items.domain_list` JSONB), displayed compactly everywhere (app/email/public/print), converted as **one aggregated Zoho line** (<100 domains in the description, ≥100 → Technical Annexure PDF on the invoice), and **one-click bulk subscription creation** (`POST /subscriptions/bulk-create-from-quote`, reusing the CSV-import core — dedup/enrich/idempotent); (4) **"Generate Bulk Quotes" now groups per CUSTOMER** — mixed-item groups delegate to the combined-quote engine → one multi-line estimate (was one estimate per item); (5) **Undo Accept** (`POST /quick-quotes/:id/unaccept`); (6) quote-builder Existing-Customer picker is now **customer-first** (cross-org search; org auto-sets + locks from the pick); the Convert form is a **popup modal**; **BUG-015…BUG-019 fixed** (see BUGS.md). ✅ The user **live-verified** the bulk-domains flow end-to-end (quote → accept → invoice INV-000048 → 6 subscriptions); the per-customer grouping change + annexure ≥100 case are typecheck-clean, not yet re-driven live.

The prior work block (**2026-07-15 — Part 2**, same continuous session) added **email sending for Quick Quotes (SendGrid-only) + per-org sender addresses**: the Quick Quote **"📤 Send Quote" button now opens a compose modal** (To prefilled with the lead's email) and `POST /quick-quotes/:id/send` **actually emails the quote** (seeded `quote_sent` template, absolute public link, currency-aware total) when a `recipient_email` is given — link-only mode preserved when omitted. Token + Sent status persist before mailing; a mail failure surfaces as `emailError` without breaking the link. `EmailService` now resolves the **sender per organization**: `org_settings.emailFromAddress`/`emailReplyTo` (Settings → Organizations → 📧 Sender Email Config — previously stored but unused) override the global From, with the org's Display Name as the From name; callers (quick-quote send, scheduler reminders) pass `organizationId`. **SMTP support was built then removed the same session by user decision** ("SMTP will create confusion — SendGrid only"); every per-org From must be a **SendGrid-verified sender** (Domain Authentication per org domain recommended). Typecheck-clean (both apps, exit 0); **not yet tested against live SendGrid**.

The prior work block (2026-07-15 — Part 1) was a **Sales-flow UX pass** — all frontend/backend logic, **typecheck-clean (both apps, exit 0)**, spanning: (1) **BUG-014** fix (Subscriptions "Expiring in N days" filter returned empty — wrong enum literal); (2) a **customizable Customers list-view** (`/dashboard/customers`) mirroring the Quotes & Invoices browser — dynamic columns (cached Zoho fields + custom fields + app-aggregate columns incl. Last Quote/Invoice #/date), private per-user saved views, CSV export; (3) **Domain + Service dates moved out of the Quick Quote form** to the **Convert/Push step** (quote keeps only the Subs./Service Period selector; domain + start date collected at conversion; end date auto-computed from period, editable); (4) a **redesigned Quick Quote "Unified Builder"** (two-mode customer cards, progressive New-Customer/Lead form, merged Quote+Items section, nicer totals) that **creates a Lead + Quote together in one submit** (org chosen in-form; lead set to `Quoted`); (5) **Dashboard Subscription Alerts grouped by customer** (Expiring/Expired blocks). ⚠️ **All 2026-07-15 work is typecheck-verified only — NOT yet run against live Zoho.**

The prior work block (2026-07-14) shipped three things: (1) a **quote deep-link fix** (Zoho Books web route is `#/quotes/`, not `#/estimates/`, which 404'd); (2) the **post-"Generate Bulk Quotes" workflow** — after generating, the user lands on an upgraded **Renewal Batch review screen** to review, **bulk-send** (Zoho default template) or **per-quote compose-send**, and **track live status** (Draft/Sent/Accepted/Declined/Invoiced/Paid) via Refresh; and (3) a new **Quotes & Invoices browser** page (`/dashboard/documents`) — a read-only, filter-then-fetch live view of Zoho estimates/invoices with **dynamic customizable columns** (standard + org custom fields + cross-linked quote↔invoice + payment columns), **private per-user saved views**, CSV export, and Zoho deep links. Both `apps/api` and `apps/web` typecheck clean (exit 0). ⚠️ **All 2026-07-14 work is typecheck-verified only — NOT yet run against live Zoho.**

The prior work block (2026-07-11 — Part 2) shipped the **Combined Quote** feature (one multi-line Zoho estimate per customer across mixed items/dates), a **domain search** on the Renewal Batch History page, and a **Subs. Period** column on the subscriptions list. ⚠️ Those were also typecheck-verified only — **NOT yet run against live Zoho** (unlike the earlier 2026-07-11 bulk-quote fix, which was).

The earlier 2026-07-11 block fixed the **Generate Bulk Quotes** flow end-to-end (it was silently failing against live Zoho) and started **multi-currency Phase 2** (subscriptions list table is now currency-aware). Every fix in that block was verified against **live Zoho** via replay scripts (create → inspect → delete).

The prior session (2026-07-09 → 2026-07-10) delivered the **Subscription Import & History-Linking feature** (CSV bulk-create + an extended Import-from-Zoho wizard that also pulls Quotes) and **multi-currency Phase 1** (foreign customers billed in USD/AED/etc.).

The 2026-07-08 session delivered a UI redesign pass across Domain Mapping, Subscription detail, and Customer detail pages (see history below).

## Recent Achievements (Session 2026-07-16)

### Convert flow & subscription decisions
- **Subscription decision at Convert** — radio in the Convert form (`create_now` default → auto-opens Subscription page / `later` → Create Subscription button stays / `never` → hidden + undo link). `quick_quotes.subscription_decision` VARCHAR(20) via `db push`; both convert paths persist it; `POST /conversions/quote/:quoteId/subscription-decision` changes it later.
- **"🧾 Create Invoice" for existing customers** — `convertExistingCustomerQuote` also accepts lead-quotes whose lead has `convertedToZohoCustomerId`; no duplicate Zoho contact. Quote page passes `mode:'existing'`; labels mode-aware.
- **Converted-invoice email via the shared `SendEmailModal`** — `GET /conversions/quote/:quoteId/invoice-email-preview` + compose override on `POST …/email-invoice` (was a blind direct send).
- **Undo Accept** — `POST /quick-quotes/:id/unaccept`: Accepted → Sent/Draft, lead `Won`→`Quoted`; only pre-convert.
- **Convert form is a popup modal**; **customer-first Existing-Customer picker** (cross-org `GET /api/customers/cross-org-search`; org auto-sets + locks from the picked customer — BUG-017 prevention).
- **BUG-017/018/019 fixed** — cross-org customer on a quote (guard + builder fix + data fix); post-convert redirect race (direct submit handler, no self-page revalidate); already-converted lead showing the Convert panel (accept no longer downgrades `Converted`; `isConverted` also checks `convertedToZohoCustomerId`; 3 leads data-fixed).

### Bulk-domains fresh sales (Option A) — ✅ live-verified by the user
- **Builder:** per-line "⇲ Bulk domains" textarea (`domain[, qty]` per line; Qty auto = Σ qty) → `quick_quote_items.domain_list` JSONB; first domain doubles as `primaryDomain` (prefills Convert). Optional single-Domain column also restored on the items table.
- **Compact display:** app page (count + expandable list), email ("Domains (N): a, b, c +N-3 more"), public page, print PDF (3-column grid).
- **Convert:** one aggregated Zoho line; <100 domains enumerated in the description, ≥100 → Technical Annexure PDF attached to the INVOICE (`AnnexureService` `entity` option); service dates persisted onto quote items.
- **Bulk subscriptions:** `POST /subscriptions/bulk-create-from-quote` — one subscription per domain via `applyImportItem` (dedup/enrich/idempotent history; `originQuickQuoteId` stamped; invoice linked). `create_now` auto-runs it; `later` shows "🚀 Create N Subscriptions".
- **"Generate Bulk Quotes" groups per customer** — mixed items/rates in one (org+customer+cycle+endMonth) group → delegated to `combinedRenewalQuote` (one multi-line estimate); uniform groups keep the live-verified single-line path.

## Recent Achievements (Session 2026-07-15 — Part 2)

### Quick Quote email send (SendGrid) + per-org senders
- **Quick Quote send now emails** — `send()` persists token+`Sent` first, then `sendFromTemplate('quote_sent', recipient, vars)` (customer name, quote #, validity DD/MM/YYYY, currency-symbol total, `WEB_BASE_URL`-absolute public link, sender = quote creator, company = target org). Email only when `recipient_email` explicitly provided (UI prefills lead email) — omitting = link-only (old behaviour). Response: `emailSent`/`emailTo`/`emailError`.
- **Compose modal** in `quote-actions.tsx` — To field (lead email prefilled, editable), Send Email / link-only fallback / Cancel; result states: sent (green), link-created-but-email-failed (amber), link-only (green).
- **Per-org sender resolution in `EmailService`** — `send()`/`sendFromTemplate()`/`sendTestEmail()` take optional `organizationId`; From = `org_settings.emailFromAddress` (name: `displayName`→`legalName`→org name, Reply-To: `emailReplyTo`) else the global `email` settings. Quick-quote send passes `targetOrganizationId`; scheduler reminders pass `sub.organizationId`. Each org From must be **verified in SendGrid**.
- **SMTP built then removed same-session** (user decision — SendGrid only). `nodemailer` uninstalled; settings UI back to SendGrid-only (labels now "Default From…", pointing to the per-org config); stray `email.smtp_*`/`email.provider` rows in `app_settings` are ignored.
- **Per-org email signature** — `org_settings.emailSignatureHtml` (previously stored-never-read) is now appended to every email sent with that `organizationId` (independent of the From override); editable via a new HTML textarea in the org card's 📧 Sender Email Config.
- **Rich quote-card email + Accept/Decline** (post-first-live-send feedback) — the quote email is a full inline-CSS card (`buildQuoteEmailHtml`): org header, items table, totals, ✓ Accept / ✗ Decline buttons (deep-link to the public page `?action=` — no state-mutating GET, scanner-safe), notes/T&C, sign-off. New public `POST /quick-quotes/reject` (→ `Rejected` + lead `Lost`); public page's new `QuoteDecision` component has accept + decline-with-reason, auto-triggered by the `?action=` hint. First live send verified via Gmail (SendGrid working); the rich card + accept/decline flow itself is typecheck-clean, not yet re-sent live.
- **Resend for Sent quotes** — send allowed from `Sent`; token reused (shared links stay valid), expiry refreshed; UI shows "↩ Resend Quote".
- **BUG-015/BUG-016 fixed** — org Sender Email Config save was double-broken (client imported server-only `next/headers`; `UpdateOrgSettingsDto` was the lone nestjs-zod DTO rejected wholesale by the class-validator `forbidNonWhitelisted` pipe). Both fixed; saves work now.

## Recent Achievements (Session 2026-07-15 — Part 1)

### 1. BUG-014 — Subscriptions "Expiring in N days" filter returned empty
- `findAll` / `countByStatus` filtered `lifecycleStatus: { in: ['Active', 'ExpiringSoon'] }`, but the Prisma enum member is `Expiring_Soon` (`@map("Expiring Soon")`). `'ExpiringSoon'` isn't a valid enum literal, so Prisma rejected the query, the page's `try/catch` swallowed it, and the list rendered the empty state. Fixed both occurrences → `'Expiring_Soon'` in `subscriptions.service.ts`.

### 2. Customizable Customers list-view (`/dashboard/customers`)
- New **customizable browser** for cached Zoho customers, modeled on the Quotes & Invoices browser. New `customers` API module: `GET /api/organizations/:id/customer-columns` (dynamic catalog), `GET /api/organizations/:id/customer-rows` (paginated + search), `GET/POST/DELETE /api/customer-views` (private per-user saved views in `user_preferences`, key `zoho_customer_views`).
- **Dynamic column catalog** = standard cached fields (scanned from `zoho_cache.extra` scalar keys) **+ the customer's Zoho custom fields** **+ app-aggregate columns**: `active_subscriptions`, `domains_mapped`, and **Last Quote #/date + Last Invoice #/date** (the same data the customer "At a Glance" card already uses). Rows flatten `extra`, then batch `groupBy` for the aggregate columns.
- **Customize Columns modal** (pick + reorder), saved views, CSV export, sort, pagination — all column-driven. The `customize-columns-modal.tsx` was **moved to `apps/web/src/components/`** and genericized (`CustomizableColumn` with `group: 'standard' | 'custom' | 'app'`); the documents browser now imports the shared copy.

### 3. Domain + Service dates moved out of the Quote form → collected at Convert/Push
- At initial-quote time there's **no domain and no service dates yet**, so those inputs were removed from the Quick Quote line items. The quote now carries only the **Subs./Service Period** (billing cycle) selector.
- Domain + **Service Start Date** are collected at the **Convert/Push step** (where the Zoho invoice is created); the **End Date auto-computes from the period** (via `addCycle`) and is editable on the subscription-creation page. New shared `conversion-details-fields.tsx` (required Domain + Start Date) wired into both the lead-convert panel and the convert-from-quote button.
- Backend: `TriggerConversionDto` + new `ConvertQuoteDto` gained `domainName` / `serviceStartDate`; `conversions.service` `buildInvoiceLineItems({domainName, startIso, endIso})`, `triggerConversion` and `convertExistingCustomerQuote` use the supplied domain/start (fallback to `lead.primaryDomain` / today) and compute end via `addCycle`; subscription prefill + `getPostConvertInfo` updated. `CreateLeadDto` + `leads.service.create` gained `country`.

### 4. Quick Quote page redesigned — "Unified Builder" + Lead+Quote in one submit
- Rebuilt `quote-builder.tsx` per the wireframe: **two-mode customer cards** (New Customer/Lead default+left, Existing Customer right), a **progressive New-Customer form** (Company\*/Contact/Email\*/Phone/State\*/Country\* visible; "More Details" expander → Billing Address Line 1/2/3 · GSTIN/City/Postal Code), a **merged Quote Details + Items** section (Item Details | **Subs. Period** | Qty | Rate | Amount — Cost Price field removed, collected later at domain time), a 3-column Notes/Terms/Internal-Notes block, and a nicer gradient totals card (CGST/SGST split).
- **Unified creation:** in New-Customer mode the form **creates the Lead first** (`POST /leads`) then submits the quote (client-orchestrated `flushSync` + `requestSubmit`) — one click makes both. The **Organization is chosen in-form** (dropdown for a new lead; locked when an existing lead is attached or when editing) so the Lead + Quote land in the chosen org. On quote create, `quick-quotes.service` sets the linked lead's status `New/Contacted` → **`Quoted`** (kept as Draft, no auto-send — user's choice).

### 5. Dashboard Subscription Alerts grouped by customer
- The Dashboard "⏳ Expiring in 30 Days" and "❌ Expired" blocks were a flat list, so one customer's multiple expiring subscriptions appeared as separate rows. Now **grouped by customer** (`groupByCustomer` helper, insertion-order preserving = soonest-expiry first): customer name once, a "N subscriptions" badge when >1, and each domain·item·org row (still individually clickable) underneath. Grouping is within the fetched preview (top 10); full list via "All expiring →".

> ⚠️ **All 2026-07-15 work is typecheck-clean (both apps, exit 0) but NOT yet verified against live Zoho.** Drive the new Customers browser, the Convert/Push domain+dates flow, and the unified Lead+Quote create through the app against a live Zoho-connected org before trusting.

## Recent Achievements (Session 2026-07-14)

### 1. Quote deep-link fix (`#/estimates/` → `#/quotes/`)
- Zoho Books' **web app** routes estimates under `#/quotes/{id}`; the app was building `#/estimates/{id}`, which showed "Page Not Found". Both deep-link builders (`zohoUrl` in the subscription detail page, `zohoBooksUrl` in the domains table) now map the `estimates` entity to a `quotes` path segment. The Zoho **REST API** entity stays `estimates` (this is web-route-only). Verified: `books.zoho.in/app/{orgId}#/quotes/{id}` auto-redirects to the org's custom domain (e.g. `books.sriganga.com`) preserving the route.

### 2. Post-"Generate Bulk Quotes" workflow — Batch review screen (send + track)
- **Problem solved:** after "Generate Bulk Quotes", the user hit a dead-end `alert()` — no way to send the quotes or track them. Now the button **navigates to the Renewal Batch review screen** (`/dashboard/subscriptions/renewal-batches?ids=<newBatchIds>`) with a "✓ N quotes created — review & send" banner.
- **Upgraded Renewal Batch History page → actionable review screen:** a **Status** column (Draft/Sent/Accepted/Declined/Invoiced/Paid), estimate # as a Zoho `#/quotes/` deep link, **checkboxes + Send Selected / Send All** (bulk-send with Zoho's **default** template), per-row **✉ Send** (opens the compose modal to edit To/CC/subject/body), and per-row + **Refresh All** (sync live status from Zoho).
- **Two send modes, one endpoint:** `POST /renewal-batches/:batchId/send` — with a compose `override` for the reviewed single send, without it for the bulk default-template send. Sending emails the batch's one estimate once, then marks **all** the batch's `renewal_history` rows `sent`.
- **Status tracking:** `POST /renewal-batches/:batchId/refresh` reads the estimate (+ linked invoice/payment) once and persists to all the batch's rows. `listRenewalBatches` gained an `ids` filter, per-batch derived `status`, and the org relation (for the deep link).
- **Reuse:** the existing per-row compose modal was **generalized** into a shared `SendEmailModal` (`apps/web/src/components/send-email-modal.tsx`) that both the subscription-detail flow and the new batch flow drive via `previewFn`/`sendFn` — no duplication.

### 3. Quotes & Invoices browser (new page `/dashboard/documents`)
- A **read-only, filter-then-fetch** live browser for Zoho **estimates/invoices** (per the user's request, modeled on the Import-from-Zoho fetch but more polished). New sidebar item **"Quotes & Invoices"** (after Quick Quotes).
- **Filters:** Organization · Doc type (Quotes/Invoices) · Status (source-aware) · Business Type · Reference# · Date range (with This Month / Last 30d / This Year presets) · Service-Expiry range · per-page (25/50/100), with active-filter chips. **Live-paginated** (one page at a time, Next/Prev) — same one-detail-call-per-row enrichment as the import wizard.
- **Dynamic customizable columns:** a backend **column catalog** = standard fields **+ the org's custom fields** (from `custom_field_mappings[docType]`) **+ cross-linked columns**: for Quotes → the converted **Invoice# / Date / Status / Payment Date**; for Invoices → the originating **Quote# / Date / Status / Payment Date**. The "Customize Columns" modal (Zoho-style) lets the user pick + reorder; the table + CSV export are fully column-driven.
- **Private per-user saved views:** save/load/delete a view (docType + filters + columns + sort) — stored as a JSON array in `user_preferences` (key `zoho_document_views`); **no new table**.
- **Cross-link cost:** each row that has a linked counterpart doc costs **one extra Zoho call** (drafts with no invoice cost nothing extra).

> ⚠️ **All 2026-07-14 work is typecheck-clean but NOT yet verified against live Zoho.** The batch send/refresh mirror the (live-verified) per-row `sendProforma`/`refreshProformaStatus`; the documents browser mirrors the import fetch layer. Drive both through the app against a live Zoho-connected org before trusting.

## Recent Achievements (Session 2026-07-11 — Part 2)

### 1. Combined Quote — one multi-line estimate per customer (NEW feature)
- **Problem solved:** a customer with many subscriptions across **different items and different renewal months** who wants a **single quotation** — the existing "Generate Bulk Quotes" splits into one estimate per (item + cycle + month) group, so they'd get several quotes, not one.
- **Backend:** new `POST /api/subscriptions/combined-renewal-quote` → `combinedRenewalQuote()`. Collapses all selected subs of **one customer** into a **single multi-line Zoho estimate**. Validates same org+customer; only quotes renewable subs (Active/Expiring_Soon/Expired), skips the rest.
- **Line merging:** subs sharing **item + renewal start/end + rate** merge into **one line**; domains are listed in that line's description as `domain.com (qty)`, line quantity = sum of domain quantities. Different rate (even same item+date) → separate line (one rate per line).
- **Header custom fields** come from the sub whose **renewal date is nearest / most overdue** (earliest endDate) — user's decision.
- **≥100 domains in a single line** → that line shows a summary (`Renewal for N domains … Technical Annexure`) and a per-line **Technical Annexure PDF** is attached (now with a **Qty** column + item/period subtitle), mirroring the "Generate Bulk Quotes" bulk path. `AnnexureService.generateAndUploadAnnexure` gained an optional `opts` param (backward-compatible).
- **Persistence:** one `RenewalBatch` links every sub's `renewal_history` (still **one row per domain**) to the single estimate — so domain-search + audit work on combined quotes too. Batch scalar columns hold representative/header values; per-domain breakdown lives in `annexureData` (JSON); item name = `"Combined Quote (N lines · M domains)"`.
- **Frontend (customer page):** new client component `customer-subscriptions.tsx` owns the Active Subscriptions card with two right-aligned header buttons — **+ New Subscription** (customer-context) and **Combined Quote** (selection mode → checkboxes → generate). Result banner shows estimate number · lines · domains · total.
- **+ New Subscription (customer-context):** the new-subscription form gained a `mode=manual` path — org + customer pre-filled & **locked**, but item/domain/dates still entered manually (the plain list-view "+ New Subscription" doesn't pre-fill the customer).

### 2. Renewal Batch History — domain search
- `listRenewalBatches` `search` now also matches **domain names** (via `renewalHistories.some.domain.domainName`), and each returned batch carries **`matchedDomains: string[]`**. The Batch History page placeholder now says "…or domain", and matched domains render as green 🔗 badges under the customer — so you can find which batch a specific domain belongs to (a batch can hold 100+ domains).

### 3. Subscriptions list — "Subs. Period" column
- The subscriptions **list table** column header "End Date" → **"Subs. Period"**; the cell now shows **`start → end`** with the day count below (e.g. `28 May 2026 → 27 May 2026` / `266 days`). `startDate` was already on the row data — no backend change. Urgent (≤30d) red styling + "Today" case preserved.

> ⚠️ **All of the above are typecheck-clean but NOT yet verified against live Zoho.** The Combined Quote flow in particular (multi-line estimate + per-line annexure attach) should be driven through the app once before trusting.

## Recent Achievements (Session 2026-07-11 — Part 1)

### 1. Generate Bulk Quotes — fixed (was creating nothing in Zoho)
- **Root cause:** `bulkRenewalQuote` hardcoded the estimate header custom field as `{ label: 'Business Type', value: 'Renewal' }`. This org's field is labelled **"Business Type?"** (not "Business Type"), so Zoho **rejected the whole create** with HTTP 400 (code 120129). The failure was **swallowed** and mis-reported to the user as success.
- **Fix (payload):** the estimate now builds all custom fields via the org-aware `buildCustomFields()` + `getBusinessTypeLabel()` / `getBillingOptions()` helpers — the same pattern every other create path uses. No hardcoded Zoho labels/api_names.
- **Fix (`buildCustomFields`):** now keys custom fields by **`api_name`** for every module **except `contacts`** (was `index` for non-item modules). Verified live: `index` **silently stores `0`** for **number** fields like `cf_total_licences`; it only happened to work for dropdowns. `contacts` alone stays on `index` (its write API rejects api_name — "Invalid value passed for Customer Name").
- **Fix (silent success):** `bulkRenewalQuote` now returns `createdCount` / `failedCount` / `estimateNumbers` / `errors`; the subscriptions table surfaces the real Zoho error on failure instead of a blanket "success" (and dropped the misleading hardcoded `₹` total).
- **Field population pass:** the estimate now fills **header** Domain Name + Service Expiry Date (were never sent) and **line-item** custom fields Domain Name / Start Date / End Date / Cost Price (the line had none). **Subs Period** no longer silently drops when the org's `billing_period_options` metadata is empty (static fallback map, `annual→Yearly`). **Domain Name** = `"first-domain +N more"` (single aggregated line kept; 100+ annexure path unchanged). **Description dates** now Indian `DD/MM/YYYY` (Zoho date *fields* stay ISO).

### 2. Multi-currency Phase 2 (started) — subscriptions list table
- The subscriptions **list table** price column no longer hardcodes `₹`; it uses the same `money()` helper + currency symbol map as the subscription detail page, so USD/AED/etc. rows render `$1.65` correctly. (`₹` still remains in the **Export CSV** and **PDF/quote builder** — see Pending.)

## Recent Achievements (Session 2026-07-09 → 2026-07-10)

### 1. Subscription import & history linking
- **CSV bulk-create importer** — `POST /api/subscriptions/import-create-csv` + web page `/dashboard/subscriptions/import-csv` (downloadable sample, instructions, 3-bucket result: created / enriched / warnings / errors, warnings+errors CSV download). Resolves **Customer Number** (Zoho `contact_number`), **Item** (SKU/ID → Name fallback), **Organization**; lifecycle computed from dates.
- **Shared core** — `importGrouped` refactored into `applyImportItem`; the CSV importer feeds the same core.
- **Enrich-existing** — when a subscription already exists (org+customer+item+domain), the importer attaches missing history + refreshes last-invoice instead of skipping. **Never duplicates.** History writes are idempotent (dedup by invoiceId, or quoteId for quote-only rows).
- **Quote linking (Import-from-Zoho)** — follows each `invoice.estimate_id` to fetch + persist the originating quote (`quoteId/quoteNumber/quoteDate/zohoEstimateStatus`).
- **Wizard now fetches Quotes (Estimates) too** — new `GET /api/organizations/:id/estimates-preview`, a Document Source selector, plus **Business Type** and **Service Expiry From/To** filters (post-filtered in-app) and a Reference-No. fetch filter + client-side refine filters (cycle/domain/product/rate). Estimate import is **status-gated**: a quote creates a subscription only when Accepted/Invoiced, else links as history.

### 2. Multi-currency (Phase 1)
- `subscriptions` + `renewal_history` gained **`currency`** + **`exchange_rate`** columns. Selling prices are stored in the customer's billing currency (not INR-converted).
- **Convention:** `currency`/`exchange_rate` = selling side (`subscriptionPrice`, `nextRenewalPrice`); **`costPrice` is always base INR**.
- Both importers capture currency; CSV **rejects rows** whose `Currency` doesn't match the customer's Zoho currency.
- **Subscription detail page** shows Price / Renewal Price in the customer's currency (`$1.65`); Cost shown in ₹. **Customer detail** page shows Currency + Country.

## Recent Achievements (Session 2026-07-08)

### 1. Domain Mapping page redesign (`/dashboard/domains`)
- Full rebuild to match wireframe §11: header "Domain Mapping View", search + **All Organizations** dropdown + **All Statuses** dropdown + **Export CSV**, four stat cards (Total / Active / Suspended / Inactive), and an interactive table.
- Rows are **click-to-expand** showing "Linked Subscriptions" (Sub # → Item → Qty → End Date → Status → Last Invoice/Quote → **Last Doc Status**).
- Sub # links to the subscription page; customer sub-line is an **"Open in Zoho Books"** link; invoice/quote numbers are Zoho deep links.
- Backend: `list()` gained a `status` filter, inline subscriptions, `activeSubsCount` (Active + Expiring_Soon), and a `stats` block; new `GET /api/domains/export-csv`.

### 2. Subscription detail page redesign (`/dashboard/subscriptions/[id]`)
- **Edit button + modal** to edit Billing Cycle, Price, Renewal Price, Start/End Date, Auto Renew (Item is read-only).
- **Renewal History rebuilt as a Zoho-synced timeline**: colored status dots + `Quote# → Invoice# → Status (Paid/Unpaid/Overdue)`; quote/invoice numbers are Zoho deep links.
- Actions kept per row: **Send/Resend Quote**, **Resend Tax Invoice** (once converted), and a **Refresh/sync** button (new circular-arrow SVG that spins).
- Renewal & Pro-rata widgets: **Notes fields removed**; Renewal widget defaults to the **Renewal Price**.
- Backend: added `zohoInvoiceStatus` to `RenewalHistory`; `refreshProformaStatus` now syncs estimate → invoice → payment and persists it; new invoice email-preview + send-invoice endpoints; `billingCycle` added to `UpdateSubscriptionDto`.

### 3. Customer detail page update (`/dashboard/customers/[zohoId]`)
- Header eyebrow now `ORG: {ORG NAME}` (uppercase); **external-link icon** on the company name ("Open in Zoho Books"); email + phone with icons; **Zoho Customer Number** badge (from Zoho `contact_number`); support-status badge moved to the header.
- Customer Profile: **primary contact person**, **Portal Status** (replaces Support Status), **Billing Address including Country**.
- Backend: `getCustomerDetail` now fetches the **full Zoho contact** live and merges it into `customer.extra` (the cached summary lacked billing_address / contact_persons / contact_number).

### 4. Sidebar (`dashboard/layout.tsx`)
- Removed the Subscriptions sub-menu ("Create New", "Import from Zoho").
- Reordered to: Dashboard → Leads → Quick Quotes → Customers → Subscriptions → Domains → User Access (Settings pinned below the divider).

### 5. Zoho Books deep links fixed (cross-cutting)
- All Zoho deep links now use `https://books.zoho.{tld}/app/{zohoOrgId}#/{entity}/{id}`, deriving the TLD from the org `dataCenter` enum. Previously they omitted the org id + used a hardcoded `.in`, so they 404'd in Zoho.

### 6. Build hygiene
- Fixed the two pre-existing `subscriptions-table.tsx` type errors (untyped `api.post`). The web app now typechecks with **zero** errors.

## Current Focus
- **Live-Zoho UAT of the 2026-07-15 sales-flow pass (all typecheck-only):**
  - **Customers browser** (`/dashboard/customers`) — fetch rows for a live org, customize columns (incl. app-aggregate Active Subs / Domains / Last Quote & Invoice #/date), save a private view, sort, export CSV.
  - **Quick Quote Unified Builder** — New-Customer mode: fill Company/Email/State/Country (+ optional More Details), pick the Organization, add an item + Subs. Period → **Create Quote** → confirm **one Lead + one Quote** are created in the chosen org and the lead flips to **Quoted**. Existing-Customer mode still creates a Type-2 quote.
  - **Convert/Push domain + dates** — convert a lead's quote (and an existing-customer quote): confirm Domain + Service Start are required at convert, End auto-computes from the period and is editable on the subscription page, and the resulting Zoho invoice line carries them.
  - **Dashboard grouping** — confirm a customer with multiple expiring/expired subs shows as one group with the "N subscriptions" badge.
- **Live-Zoho UAT of the 2026-07-14 work (all typecheck-only):**
  - **Batch review screen** — from Subscriptions → Generate Bulk Quotes → land on the batch screen → Send Selected / Send All (default template) + per-row ✉ Send (compose) + Refresh; confirm the estimate emails go out and statuses sync.
  - **Quotes & Invoices browser** (`/dashboard/documents`) — fetch quotes/invoices for a live org, customize columns (incl. the cross-linked invoice/quote/payment columns), save a view, export CSV, and confirm the `#/quotes/` deep links open.
- **Live-Zoho UAT of the Combined Quote flow** — the whole feature (multi-line estimate, item+date+rate line merge, `domain (qty)` description, header-from-nearest-sub, ≥100 per-line annexure) is typecheck-clean but has **not** been run against live Zoho. Drive it once from a customer page before trusting.
- **Manual UAT of the import feature in the running app against a live Zoho-connected org** — all backend logic is verified against the dev DB, but the wizard (Quotes source, filters, enrich) and the CSV page haven't been driven end-to-end through the app's own Zoho OAuth.
- **Multi-currency Phase 2** (see Pending): Lead country/currency form; `₹`→currency symbol in the subscriptions list + PDFs; currency-aware dashboard totals.

## Known Blockers
- None (code). **Operational prerequisite:** the CSV/Zoho import needs the org's **items** synced into `zoho_cache` first. The dev DB's Excel Technologies org has customers but **0 items** cached — imports for it fail with "Item … not found in Zoho cache" until you click **Sync** on that org (Settings → Organizations). Not a bug.

## Database sync note
This project uses **`npx prisma db push`** (schema-driven), **not** `prisma migrate`. Only `0001_init` exists in `prisma/migrations`; all later columns — `renewal_batches`, `csv_import_logs`, `zoho_invoice_status`, this session's `csv_import_logs.{created_count,enriched_count,warning_rows}` and `subscriptions`/`renewal_history`.`{currency,exchange_rate}` — were synced via `db push`. On Windows use `db push --skip-generate` when the dev server holds the query-engine DLL open; `prisma generate` may hit `EPERM` on the engine binary while servers run (types still regenerate — harmless).
