# Architectural & Technical Decisions

## Format: Architecture Decision Record (ADR)

---

### In-app document PDFs: DB-cached Zoho PDF + generated quote PDF + branding (Date: 2026-07-18)
* **Context:** The user wanted to **view the Zoho quote/invoice PDF inside the app** ("View PDF" button) and store it, plus attach the quote PDF to outgoing emails, and have the uploaded **PDF Branding** (logo/signature) actually appear on the app's quote PDF. Zoho exposes a document's PDF at `GET /{estimates|invoices}/{id}?accept=pdf`.
* **Decision:**
  1. **Store + webhook-refresh, in Postgres bytea** (user's choice over on-demand-proxy / filesystem). New `zoho_document_pdf` table caches the bytes keyed `(org, entity_type, zoho_doc_id)`; `ZohoService.getDocumentPdf()` is cache-first, `getBinary()` on the client fetches raw bytes, and the webhook path (`estimate_updated`/`invoice_created`/`payment_added`) invalidates the stored PDF alongside the existing doc-detail cache. First open = 1 Zoho call, repeats = 0. Endpoint `GET /organizations/:id/documents/:kind/:docId/pdf` streams it; a reusable `ViewPdfButton` (blob + `credentials:'include'`, popup-safe) is wired into the 4 doc-facing surfaces.
  2. **Email attachments — only the doc being sent** (user's choice). Zoho-sent invoice/quote/batch emails **already attach the document PDF natively**, so they were left unchanged (avoids duplicate attachments). Only the **SendGrid quick-quote first-send** lacked an attachment; a quick quote is app-native at that point (no Zoho estimate), so the PDF is **generated** via pdf-lib (`buildQuotePdf`) rather than fetched, and attached best-effort (a PDF failure never blocks the email).
  3. **Branding** (logo/signature, stored as base64 data-URLs on `org_settings`) is embedded into `buildQuotePdf` and rendered on the print page. The **pdf-lib** path embeds **PNG/JPEG only** (pdf-lib can't do SVG/WebP), uses the **ISO currency code** in money (₹ isn't WinAnsi-encodable in the standard Helvetica font) and **strips non-Latin-1 text** (e.g. Devanagari). The **print page uses `<img>`**, so it renders SVG/WebP/₹/Hindi fine — the two paths differ by design.
* **Consequences:** PDFs are viewable/attachable without re-hitting Zoho each time; storage is a few hundred KB/doc in the DB (no new infra). The quote-PDF attachment and branding are **not yet live-verified**. If a Unicode/₹/SVG-faithful generated PDF is needed, embed a Unicode font + rasterize SVG (deferred). Zoho customer PDFs are org-specific — the cache key includes the org.

---

### "Generate Bulk Quotes" groups per CUSTOMER; mixed-item groups delegate to the combined-quote engine (Date: 2026-07-16)
* **Context:** `bulkRenewalQuote` grouped by (org + customer + **item** + cycle + endMonth) — a customer with two items renewing together got two separate estimates. Found by the user right after the bulk-domains flow created 2 subscriptions on the same 3 domains (Business Starter + Business Standard): selecting all 6 → 2 quotes; expected 1.
* **Decision:** Group key drops `zohoItemId` (now org + customer + cycle + endMonth). A **uniform** group (single item + single rate) takes the unchanged, live-verified single-line path (aggregated qty, "first +N more", ≥100 annexure). A **mixed** group (items or rates differ) is **delegated to `combinedRenewalQuote`** — one multi-line estimate (line per item+dates+rate, per-line ≥100 annexure, one RenewalBatch) — and its result is adapted into the bulk results/batch-review shape (`zohoItemName: "Combined (N lines · M domains)"`). Price overrides keep a legacy per-item-key fallback (the UI sends none today).
* **Consequences:** One customer + one renewal window = one quote, regardless of item mix. No new estimate-building code — combined engine reused. Batch review shows a combined row (representative scalar caveat already documented). Typecheck-clean; not yet re-driven live.

---

### Existing-customer quotes are customer-first: cross-org search, org auto-derives and locks (Date: 2026-07-16)
* **Context:** BUG-017 — the quote builder let you pick a customer in org A, then switch the Organization dropdown to org B; Zoho customer IDs are org-specific, so Convert failed with a cryptic "Customer is not accessible" (verified: AKS INTERACTIVE exists in two orgs with different IDs).
* **Decision:** Invert the flow — in Existing Customer mode the picker searches the cache **across all active orgs** (`GET /api/customers/cross-org-search`, org badge per result); picking a customer **auto-sets and locks** the Organization field (unlocks only when the pick is cleared). Backend safety net stays: `convertExistingCustomerQuote` fails early with a named "Customer/org mismatch" error when the cache knows the ID only under a different org (not-in-cache still allowed — Zoho remains authoritative).
* **Consequences:** A wrong org+customer combination is structurally impossible from the UI; duplicate-name customers across orgs are disambiguated by the org badge. Coverage bounded by `zoho_cache` (un-synced orgs' customers won't appear — sync first).

---

### Bulk-domains fresh quotes: single aggregated line + annexure ≥100 + one-subscription-per-domain via the import core (Date: 2026-07-16)
* **Context:** The renewal side already handles bulk (one aggregated estimate line, "first +N more" domain label, Technical Annexure PDF for ≥100 domains, per-domain history). Fresh sales had nothing: a 200-domain deal meant either 200 quote lines or one qty=200 line with the domains recorded nowhere, and 200 manual/CSV subscription creations. Options considered: (A) bulk-domains on a quote line reusing the renewal machinery + a bulk subscription endpoint reusing the CSV-import core, (B) plain qty line + post-convert CSV import, (C) one line per domain.
* **Decision:** **Option A** (user's choice, per-domain qty confirmed). A quote line's Domain field toggles to a bulk textarea (`domain[, qty]` per line; line Qty auto = Σ qty), persisted as `quick_quote_items.domain_list` JSONB. Display is compact everywhere (count + first-few + expandable/print list). At Convert the line stays **one aggregated Zoho line**: <100 domains enumerated in the description, ≥100 → summary + annexure PDF attached **to the invoice** (`AnnexureService` gained an `entity` option); header/line Domain CFs use `first +N more`; convert also persists the service dates onto the quote items. Subscriptions come from `POST /subscriptions/bulk-create-from-quote`, which loops domains through `applyImportItem` — inheriting natural-key dedup, enrich-don't-duplicate and idempotent history — linking the converted invoice as last-invoice + a `Fresh` history row and stamping `originQuickQuoteId`. UX: decision radio unchanged; `create_now` on a bulk quote auto-runs the bulk create (the single-subscription page handles only one domain), `later` shows "Create N Subscriptions".
* **Consequences:** Quote/invoice stay readable at any domain count; per-domain records exist app-side from day one (domains, subscriptions, history). Bulk create is safely re-runnable (dedup). Same-domain-different-item lines each create their own subscription (natural key includes item). Multi-annexure on one invoice mirrors the combined-quote assumption (unverified live, rare). Typecheck-clean; **not yet driven against live Zoho.**

---

### Subscription decision captured at Convert time; radio in the Convert form (Date: 2026-07-15)
* **Context:** After Convert, the app always auto-opened the Subscription-creation page, and the quote page always showed "Create Subscription". But invoices are made only when a deal is final, and not every deal is a subscription — the user wanted to be asked at invoice-creation time: create now, ask me later, or never (one-time deal). Options considered: (A) a radio in the existing Convert form, (B) a post-convert popup modal, (C) just removing the auto-redirect.
* **Decision:** **Option A** (user's choice) — the Convert panel (which already collects Domain + Service Start) gained a 3-option radio, shown **only when the quote has subscription items**: `create_now` (default — invoice → auto-open Subscription page, today's behaviour), `later` (stay on the quote page; the Create Subscription button remains + "⏳ pending" hint), `never` (button hidden; a small "बदलना हो तो यहाँ click करें" undo link flips the decision to `later`). Persisted on `quick_quotes.subscription_decision` (VARCHAR(20), NULL for pre-feature rows = treated as `later` so their button keeps showing). Both convert paths (lead + existing-customer) accept and persist it; conversion results and `getPostConvertInfo` return it; `POST /conversions/quote/:quoteId/subscription-decision` allows changing it later.
* **Consequences:** The question is asked exactly once, in the moment the user is already filling convert details — consistent with the "collect at Convert/Push" pattern. One-time deals no longer show a dangling Create Subscription button. Undo path prevents an accidental "never" from being permanent. Pre-feature converted quotes behave as before (button shows).

---

### App email: SendGrid-only with per-org verified senders; email only on explicit recipient (Date: 2026-07-15)
* **Context:** The Quick Quote "Send" button only generated a public link — no email actually went out (the `SendQuoteDto.recipient_email` field existed but was ignored). SMTP support was built first (nodemailer provider switch), but the user then asked whether SendGrid could give **each of the 4 orgs its own sender address** and decided: *"SMTP will create confusion — remove it, use SendGrid fully."* SMTP would indeed have fought per-org senders (SMTP credentials bind to one mailbox; a different From breaks SPF/DKIM), whereas one SendGrid account sends from any **verified** sender. Notably, `org_settings.emailFromAddress`/`emailReplyTo` + the Settings → Organizations "📧 Sender Email Config" UI already existed but were **stored-and-never-read**.
* **Decision:** (1) **SendGrid-only** — the same-session SMTP implementation (nodemailer, `smtp_*`/`provider` settings, provider-selector UI) was removed; already-saved `email.smtp_*` rows in `app_settings` are simply ignored. (2) **Per-org sender resolution inside `EmailService`** — `send()`/`sendFromTemplate()`/`sendTestEmail()` accept an optional `organizationId`; From = `org_settings.emailFromAddress` (From name: `displayName` → `legalName` → org name; Reply-To: `emailReplyTo`), falling back to the global `email` settings. Callers pass the org (quick-quote send → `targetOrganizationId`, scheduler reminders → `sub.organizationId`). Every per-org From must be a **SendGrid-verified sender** (Domain Authentication per org domain recommended). (3) **Email only when `recipient_email` is explicitly provided** — the compose modal prefills the lead's email; omitting it means "generate link only" (old behaviour preserved; avoids surprise emails from other callers). (4) **Persist token + `Sent` before mailing** — the link in the email must be live; an email failure returns `emailSent:false` + `emailError` (amber in the UI) instead of failing the send. (5) Template vars: sender = quote creator's name, company = target org name, absolute link from `WEB_BASE_URL`, currency-symbol total.
* **Consequences:** One SendGrid API key serves all orgs, each mailing From its own identity — no per-org credentials to manage. Unverified org senders will be **rejected by SendGrid at send time** (surfaces as `emailError`); verifying each org's domain in SendGrid is an operational prerequisite. A "Sent" quote with a failed email is possible by design (status = link generated). The renewal-quote flow is unaffected (it emails via Zoho Books' own API, not this service). **Follow-up (same day):** `emailSignatureHtml` is now also wired — appended to the body of every org-scoped email (independent of the From override), editable via a textarea in the org card's Sender Email Config. Typecheck-clean; not yet run against live SendGrid.

---

### Quick Quote "Unified Builder": create Lead + Quote in one submit; org chosen in-form (Date: 2026-07-15)
* **Context:** Creating business previously took two steps — enter Lead details, then separately send it a quote. The user asked whether the single Quick Quote page could do both at once. Also, the wireframe's line-item Domain / Service-Start / Service-End columns conflict with an earlier decision (those belong at Convert/Push, not initial quote), and the initial redesign locked the target Organization so a new lead always landed in `orgs[0]`.
* **Decision:** (1) **Unified create, client-orchestrated.** In New-Customer/Lead mode with no existing lead selected, the form intercepts submit, `POST /leads` first, then `flushSync`es the new lead id + org into state and calls `formRef.requestSubmit()` so the unchanged `createQuoteAction` runs with a real `lead_id`. The **quick-quotes backend contract is untouched** (it still just receives `lead_id`) — no combined endpoint. (2) **Draft, not auto-send** (user's choice); on quote create, `quick-quotes.service.create` flips the linked lead `New/Contacted`→**`Quoted`** (accept still sets `Won`). (3) **Organization is chosen in-form** — a `<select>` for a new lead (both the lead's `target_organization_id` and the quote payload use the same `selectedOrgId`), **locked** only when an existing lead is attached or when editing a draft. (4) **Progressive form** — only easy fields visible (Company\*/Contact/Email\*/Phone/State\*/Country\*), the rest behind "More Details"; no separate New-Lead modal.
* **Consequences:** One click makes a Lead **and** a Quote in the correct org, lead status advances automatically. Two sequential network calls (lead then quote) client-side; if lead-create fails, the quote is not submitted and the error is shown. `cost_price` stays in the payload (sends 0) but has no UI — collected later at domain time. No backend schema/endpoint change.

---

### Sales dates: collect Domain + Service Start at Convert/Push, auto-compute End (Date: 2026-07-15)
* **Context:** At initial-quote time there is **no domain and no service start/end** yet — asking for them on the Quick Quote form (as the old line items and the wireframe did) forces the user to invent data. Those values are only known when the lead closes / is pushed to a subscription.
* **Decision:** Remove Domain / Service Start / Service End from quote line items; keep only the **Subs./Service Period** (billing cycle) selector on the quote. Collect **Domain + Service Start Date** at the **Convert/Push step** (shared `conversion-details-fields.tsx`, both required); **auto-compute the End Date from the period** via `addCycle`, editable on the subscription-creation page. Backend: `TriggerConversionDto` + new `ConvertQuoteDto` carry `domainName`/`serviceStartDate`; conversions use them (fallback to `lead.primaryDomain` / today) and compute end; the Zoho invoice line + the created subscription are prefilled from these convert-time values.
* **Consequences:** The quote captures only what's known up front; the domain/dates are captured once, at the moment they exist, and flow into both the Zoho invoice line and the subscription. `CreateLeadDto` gained `country` (the model already had it). End date is derived but overridable.

---

### Customers list-view: same browser pattern as Quotes & Invoices, app-aggregate columns (Date: 2026-07-15)
* **Context:** The Customers page needed a customizable list-view "with as many columns as possible", including app data already shown on the customer "At a Glance" card (active subscriptions, domains, last quote/invoice).
* **Decision:** Reuse the **Quotes & Invoices browser** shape — a backend **dynamic column catalog** + private per-user **saved views** in `user_preferences` (key `zoho_customer_views`) + CSV export + a shared **Customize Columns** modal (moved to `apps/web/src/components/` and genericized with a `group: 'standard' | 'custom' | 'app'` field). The catalog scans `zoho_cache.extra` for scalar keys (**cached fields only — instant, no live Zoho call**), adds the customer's Zoho custom fields, and adds **app-aggregate** columns computed locally via batched Prisma `groupBy` + reduce-latest: `active_subscriptions`, `domains_mapped`, `last_quote_number`/`date`, `last_invoice_number`/`date`.
* **Consequences:** Fast (reads the local cache, not Zoho), consistent UX with the documents browser, and no new table. Column coverage is bounded by what bulk `syncCustomers` stored in `extra` (LIST-level fields; detail-only fields like `billing_address` appear only for customers whose detail was live-fetched — see [[zoho-invoice-estimate-field-map]] / BUGS.md).

---

### Dashboard alerts grouped by customer (Date: 2026-07-15)
* **Context:** The Dashboard "Expiring in 30 Days" / "Expired" blocks rendered one row per subscription, so a customer with several expiring subscriptions was scattered across separate rows.
* **Decision:** Group both blocks by customer name with an insertion-order-preserving `groupByCustomer` helper (the fetched list is already sorted soonest-first, so groups keep that order): customer name shown once, a "N subscriptions" badge when >1, each `domain · item · org` row still an individual link. Grouping is within the fetched preview window (top 10 / 5) — full list via "All expiring →".
* **Consequences:** Purely presentational, no backend change; the header count still reflects total subscriptions (not customers). A customer whose subs span beyond the preview limit won't be fully grouped in the widget.

---

### Quotes & Invoices browser: live paginated fetch, dynamic columns, per-user saved views (Date: 2026-07-14)
* **Context:** The user needed a dedicated page to browse **all** Zoho Books quotes/invoices with rich, Zoho-style customizable columns (including org custom fields + cross-linked quote↔invoice + payment info) and reusable saved views — "filter then fetch", more polished than the Import-from-Zoho wizard.
* **Decision:** New read-only `documents` module + page `/dashboard/documents`. (1) **Fetch mode = filtered + live-paginated** (one page at a time, Next/Prev), reusing the wizard's list+per-row-detail enrichment — chosen over "fetch-all" (which would loop hundreds of Zoho calls) and over syncing Zoho docs into a local cache table (bigger design). (2) **Dynamic column catalog** from a backend endpoint: fixed standard columns + the org's custom fields (from `org_settings.custom_field_mappings[docType]`, no extra Zoho call) + **cross-linked columns** — for quotes, follow `invoice_id`→invoice (number/date/status/payment); for invoices, follow `estimate_id`→estimate (number/date/status) and read payment from the invoice itself. The table + CSV export are fully column-driven. (3) **Saved views = private per-user**, stored as a JSON array in `user_preferences` (key `zoho_document_views`) — no new table; a view captures docType + filters + columns + sort. (4) Fetch is done via **direct client-side `fetch` with `credentials:'include'`** (same pattern as the import wizard), not server actions.
* **Consequences:** One Zoho detail call per row, **plus one more per row that has a linked doc** — a full page (100) can be ~200 calls; per-page capped at 100, prefer 25–50. Custom-field columns depend on the org's `custom_field_mappings` being configured. No Customer filter yet (no cached customers-list endpoint — see TASKS). Applying a saved view sets state but does not auto-fetch (avoids surprise Zoho calls). Typecheck-clean; **not yet live-verified.**

---

### Post-"Generate Bulk Quotes" workflow: batch review screen, two send modes, one estimate per batch (Date: 2026-07-14)
* **Context:** "Generate Bulk Quotes" created estimates in Zoho then dead-ended in an `alert()` — no way to send the quotes to customers or track them. A batch = one Zoho estimate linked to many `renewal_history` rows (one per domain) that all share the same `quoteId`.
* **Decision:** (1) After generating, the endpoint returns `batchIds` and the UI **navigates to the Renewal Batch review screen** (`?ids=…`) — the existing Batch History page, upgraded to be actionable (status + send + refresh), rather than a new page. (2) **Two send modes, one endpoint** (`POST /renewal-batches/:batchId/send`): bulk **Send Selected / Send All** with Zoho's **default** template (no `override`), and per-row **✉ Send** via a compose modal (`override` = To/CC/subject/body). Because a batch = one estimate, sending emails it **once** and marks **all** the batch's history rows `sent`. (3) **Status tracking** (`POST /renewal-batches/:batchId/refresh`) reads estimate→invoice→payment once and `updateMany`s all the batch's rows; `listRenewalBatches` derives a single batch `status` from a representative row (they share the estimate). (4) The per-row compose modal was **extracted into a shared `SendEmailModal`** parameterized by `previewFn`/`sendFn`, reused by both the subscription-detail and batch flows (chosen over duplicating the ~270-line modal).
* **Consequences:** No schema change (reuses `renewal_batches` + `renewal_history`). Convert-to-invoice and roll-dates-on-paid were explicitly **out of scope** (status tracking only, per the user). Bulk send has no per-recipient review by design. Typecheck-clean; **not yet live-verified** (mirrors the live-verified per-row send/refresh).

---

### Combined Quote: one multi-line estimate per customer; merge by item+dates+rate; header from nearest sub (Date: 2026-07-11)
* **Context:** A customer with subscriptions across **different items and different renewal months** may want a **single quotation** for all of them. "Generate Bulk Quotes" groups by (item + cycle + endMonth) and emits **one estimate per group**, so such a customer gets several quotes. Zoho estimates support multiple line items, each with its own item/rate/qty and line-item custom fields (start/end/domain).
* **Decision:** Added `POST /api/subscriptions/combined-renewal-quote` → `combinedRenewalQuote()`, which builds **one estimate with many lines** for **one customer** (validated: all selected subs must share org + customer; only Active/Expiring_Soon/Expired subs are quoted). (1) **Line merge key = item + renewal start + renewal end + rate** — subs sharing all four collapse into one line whose description lists `domain.com (qty)` per domain and whose line quantity = Σ per-domain quantity. Different rate (even with same item+date) → a **separate line**, because a Zoho line carries a single rate. (2) **Header custom fields** (business type, billing period, service expiry, domain summary) are taken from the sub whose **renewal date is nearest / most overdue** (earliest endDate) — user's explicit choice, since a header can hold only one value. (3) **Per-line ≥100 domains** reuses the "Generate Bulk Quotes" bulk path: the line description becomes a summary and a **Technical Annexure PDF** is attached for that line (annexure now renders a **Qty** column + an item/period subtitle; distinct filename per line). (4) **Persistence:** one `RenewalBatch` links every sub's `renewal_history` — **still one row per domain** (own qty/price/dates) — to the single estimate, so domain-search and audit work unchanged. Batch scalar columns (`zohoItemId`/`billingCycle`/`unitPrice`) hold the header sub's representative values; the full per-domain breakdown lives in `annexureData`; item name = `"Combined Quote (N lines · M domains)"`. (5) The customer page's "+ New Subscription" uses a new `mode=manual` on the create form (org + customer locked, item/domain/dates manual).
* **Consequences:** Customers get a single quote across mixed items/dates. Rate must match to share a line (correct totals). Header fields describe only the nearest-renewal sub — acceptable, and line-item custom fields carry each line's real period. `RenewalBatch` summary columns are **not** a true aggregate for combined batches (documented in BUGS/TASKS). Multiple ≥100-domain lines attach multiple annexures to one estimate (assumed OK; rare). **Typecheck-clean but not yet verified against live Zoho** — unlike the bulk-quote fix, this flow was not replayed against Zoho.

---

### Batch History: find a batch by domain (Date: 2026-07-11)
* **Context:** With 100+ domains per customer per month, a user needs to find which renewal batch a specific domain belongs to. `listRenewalBatches` search only matched customer/item/estimate-number.
* **Decision:** Extend the search `OR` with `renewalHistories.some.domain.domainName contains` (the domain↔batch link already exists via `renewal_history.bulkRenewalBatchId`). The response now also returns `matchedDomains[]` per batch (the domains in that batch matching the term), surfaced as badges — because a batch holds many domains and the row must show *why* it matched.
* **Consequences:** No schema change; reuses the existing relation. Search is case-insensitive `contains` (partial domains match). Works for combined-quote batches too, since those also write per-domain `renewal_history` rows.

---

### Custom fields: key by `api_name` for every module except `contacts` (Date: 2026-07-11)
* **Context:** `buildCustomFields` emitted `{ index }` for all non-`items` modules. Generating a bulk quote left the number field **Total Licences** (`cf_total_licences`) stored as `0`, even though dropdown fields on the same estimate populated fine.
* **Decision:** Verified live against org `60069493045` that `{ index }` **silently stores `0` for number custom fields** (it only appears to work because it's fine for dropdowns), whereas `{ api_name }` reliably stores dropdown **and** number fields. `buildCustomFields` now keys by `api_name` for every module **except `contacts`** — contacts alone must stay on `index` (its write API rejects api_name/customfield_id with "Invalid value passed for Customer Name"; see [[zoho-write-api-gotchas]]). This generalises the line-item lesson ([[zoho-line-item-custom-fields]]) to header/transaction fields.
* **Consequences:** Fixes number fields on estimates, and also on invoices (conversions / start-subscription / pro-rata now write invoice header CF by api_name — canonical, likely fixes latent zeroed number fields there too, though the invoice flows were not separately re-verified live). Only `contacts` behaviour is unchanged.

---

### Bulk renewal quote: org-aware fields, single aggregated line, fail-loud (Date: 2026-07-11)
* **Context:** `bulkRenewalQuote` hand-rolled a minimal Zoho estimate payload with a **hardcoded** `{ label: 'Business Type', value: 'Renewal' }` custom field. This org's field is labelled "Business Type?", so Zoho 400'd the entire create — and the error was swallowed and reported to the user as success. Many other fields (header Domain Name/Service Expiry, all line-item custom fields) were never sent.
* **Decision:** (1) Build all custom fields via the shared org-aware `buildCustomFields()` + `getBusinessTypeLabel()`/`getBillingOptions()` — never hardcode Zoho labels/api_names. (2) Keep the **single aggregated line item** (`quantity = N domains`) — mandatory for the 100+ annexure design — rather than one line per domain; set Domain Name to **"first-domain +N more"** (user's choice) on both header and line. (3) **Fail loud:** the endpoint returns `createdCount`/`failedCount`/`estimateNumbers`/`errors` and the UI surfaces the real Zoho error instead of a blanket success. (4) Subs Period label uses a **static fallback** (`monthly→Monthly`, `annual→Yearly`, …) when the org's `billing_period_options` metadata is empty, so the dropdown never silently drops. (5) Human-readable **`DD/MM/YYYY`** dates in the description text (Zoho date *fields* stay ISO).
* **Consequences:** Bulk quotes now create in Zoho with every field populated (verified live). Per-domain detail is summarised, not itemised, in the single line — acceptable given the 100+ annexure constraint. Cost/dates on the aggregated line come from `firstSub`, consistent with the existing per-group uniform-price assumption.

---

### Multi-currency: store native selling currency; cost always base INR (Date: 2026-07-10)
* **Context:** Some Zoho customers are billed in non-INR currencies (USD, AED). Subscriptions had no currency dimension — all prices were implicitly INR. When the tool generates a renewal estimate/invoice against a `customer_id`, Zoho auto-bills in the customer's currency and interprets the `rate` in it, so an INR-converted price would quote wrong.
* **Decision:** Added `currency` + `exchange_rate` to `subscriptions` and `renewal_history`. **`currency`/`exchange_rate` describe the selling side only** (`subscriptionPrice`, `nextRenewalPrice`); **`costPrice` is always the org base currency (INR)** — matching "charge client in USD, pay vendor in INR". Base-equivalent = amount × exchange_rate (rate = value of 1 unit of `currency` in INR at import; INR-currency rows have rate 1). One rate per subscription covers all its selling amounts — no per-field currency columns. Prices are stored **native** (user chose "native + INR-equivalent"), INR-equivalent computed on demand.
* **Consequences:** No per-field currency columns; margin = price×rate − cost (both INR). Cross-currency dashboard totals must group per-currency or use the INR-equivalent (Phase 2). Foreign CSV rows without an exchange rate store rate 0 + a warning (base-equivalent unavailable). Hardcoded `₹` still exists in the subscriptions list + PDFs (Phase 2). See [[multi-currency-design]] memory.

---

### Import architecture: one shared core, enrich-don't-duplicate, idempotent history (Date: 2026-07-09)
* **Context:** Three import paths were needed — the existing Import-from-Zoho, a new CSV bulk-create, and linking history to already-existing subs. Duplicating create/dedup/domain logic across them would drift.
* **Decision:** Refactored `importGrouped` into a private `applyImportItem(item, opts)` core used by both the Zoho wizard and the CSV importer. On a natural-key match (org+customer+item+domain) it **enriches** (attaches missing history, refreshes last-invoice) instead of skipping — **never creates a duplicate**. `backfillHistory` is **idempotent**: dedup by `invoiceId`, or by `quoteId` for quote-only rows.
* **Consequences:** Re-running any importer is safe. CSV rows and Zoho rows share the exact same downstream behavior. The CSV importer is a thin parser/validator in front of the core.

---

### Link quotes to history via `invoice.estimate_id`; gate estimate-sourced creates (Date: 2026-07-09/10)
* **Context:** Renewal history should show the originating quote, not just the invoice. And the wizard can now fetch Quotes (Estimates) directly — but a quote is not a paid invoice.
* **Decision:** Each invoice payload carries `estimate_id`; the wizard fetch resolves it once per unique estimate to persist `quoteId/quoteNumber/quoteDate/zohoEstimateStatus` (spike-confirmed, deterministic — no fuzzy matching). When importing **from estimates**, a subscription is **created only if the quote status is Accepted/Invoiced**; otherwise history is linked to an existing sub only (never materialize a sub from an open/expired proforma). Quote-only history rows get `renewalStatus=Quoted`.
* **Consequences:** Quote resolution adds ~1 Zoho call per unique estimate during preview (deduped, capped). Estimate imports are safe against unclosed deals.

---

### Import wizard filters: in-app refine + post-filter, not Zoho custom-field queries (Date: 2026-07-09/10)
* **Context:** Users wanted to filter the wizard by Business Type, Billing Cycle, Domain, Service Expiry, amount, etc. — most of which are Zoho custom fields. Zoho's raw REST custom-field query syntax is unreliable.
* **Decision:** Pass only well-documented params to Zoho (`status`, date range, `customer_id`, `reference_number`). Business Type + Service Expiry are **post-filtered in-app** on the fetched docs (`cf_new_business` / `cf_next_invoice_date`); Cycle/Domain/Product/Rate are **instant client-side refine** filters over parsed candidates. CSV item match prefers SKU/ID then falls back to exact Name. CSV `Currency` must match the customer's Zoho currency or the row is rejected.
* **Consequences:** No dependency on fragile Zoho cf-query syntax. Because post-filtering runs on the ≤50 fetched docs, matches beyond the cap can be missed (documented in TASKS).

---

### Zoho Books Deep-Link Construction (Date: 2026-07-08)
* **Context:** Existing Zoho Books links used `https://books.zoho.in/app#/contacts/{id}` — no org id and a hardcoded `.in` TLD. Zoho loads the last-used org and can't resolve the record, so links 404'd. Orgs can also be on other data centers (`.com`, `.eu`, `.com.au`, `.jp`, `.sa`).
* **Decision:** Standardize on `https://books.zoho.{tld}/app/{zohoOrgId}#/{entity}/{id}`, where `{tld}` is derived from the org `dataCenter` enum (`in→in, com→com, eu→eu, com_au→com.au, jp→jp, sa→sa`) and `{entity}` is `contacts` / `invoices` / `estimates`. Backend queries that feed these views now select `zohoOrgId` + `dataCenter`.
* **Consequences:** Correct deep links everywhere (domains, customer, subscription history). The TLD map + URL builder is duplicated in a few client components; if it spreads further, extract a shared helper.
* **Follow-up (2026-07-13): estimate route is `#/quotes/`, not `#/estimates/`.** The Zoho Books **web app** routes estimates under `#/quotes/{id}` — `#/estimates/{id}` 404s ("Page Not Found"). Both deep-link builders (`zohoUrl` in `subscriptions/[id]/page.tsx`, `zohoBooksUrl` in `domains/_components/domains-table.tsx`) now translate the `estimates` entity to a `quotes` path segment while callers still pass `'estimates'` (the Zoho **REST API** entity stays `estimates` — this mapping is web-route-only). Verified: `books.zoho.in/app/{orgId}#/quotes/{id}` auto-redirects to the org's custom domain (e.g. `books.sriganga.com`) preserving the route.

---

### Persist Invoice Status via `zohoInvoiceStatus` + Refresh Sync (Date: 2026-07-08)
* **Context:** The renewal-history timeline needs to show the Tax Invoice status (Paid / Unpaid / Overdue), but `RenewalHistory` only tracked the estimate (`zohoEstimateStatus`).
* **Decision:** Added a persisted `zohoInvoiceStatus` column (chosen over live-per-row fetching so status survives reloads). `refreshProformaStatus` now walks estimate → linked invoice → payment: it reads the estimate, follows `invoice_id`, fetches the invoice's live status + payment info, and persists `invoiceId`/`invoiceNumber`/`invoiceDate`/`zohoInvoiceStatus`/`paymentId`/`paymentDate` plus an updated `renewalStatus` (Invoiced/Paid).
* **Consequences:** One extra Zoho call on refresh when an invoice exists (wrapped in try/catch — non-fatal). Status is only as fresh as the last refresh click; there is no background poller.

---

### Subscription Edit — Item Read-Only, Local-Only Fields (Date: 2026-07-08)
* **Context:** The subscription detail page needed an Edit action. Editable candidates were Item, Billing Cycle, Price, Renewal Price, Start/End Date, Auto Renew.
* **Decision:** Item is **read-only** (changing what is billed on an existing subscription is risky and does not retroactively alter already-created Zoho documents). The rest are editable via `PATCH /subscriptions/:id`; `billingCycle` was added to `UpdateSubscriptionDto`. Edits update the **local** record only. Resending a Tax Invoice uses the full compose modal (To/CC/BCC/subject/body from Zoho's invoice email template), consistent with the existing "Send Quote" UX.
* **Consequences:** Edits never mutate Zoho estimates/invoices — expected for a local subscription record. If item-change is ever required, it needs a dedicated flow (item picker + downstream implications).

---

### Customer Detail — Live Full-Contact Fetch (Date: 2026-07-08)
* **Context:** The customer detail page must show billing address (with country), primary contact person, portal status, and the Zoho Customer Number. The `zoho_cache` summary row does **not** contain `billing_address`, `contact_persons`, or `contact_number` — only the list-view fields.
* **Decision:** `getCustomerDetail` now fetches the **full Zoho contact** (`GET /contacts/{id}`) at request time and merges it into `customer.extra` (falling back to the cached summary if the call fails). The Zoho Customer Number is the contact's top-level `contact_number` field.
* **Consequences:** One live Zoho call per customer-detail load (non-fatal on failure). If latency becomes an issue, cache the enriched contact or debounce. This also means the profile fields are always current, not stale-cache.

---

### Database Sync via `prisma db push` (not migrations) (Date: 2026-07-08)
* **Context:** Prior handoffs tracked a "pending `csv_import_logs` migration" as a blocker (BUG-002). Investigation showed only `0001_init` exists in `prisma/migrations`, yet `renewal_batches` and `csv_import_logs` already exist in the DB and `prisma migrate status` reports it up to date.
* **Decision:** Confirmed this project uses `npx prisma db push` (schema-driven sync) per `ENVIRONMENT.md`, not `prisma migrate`. Schema additions are applied with `db push`; on Windows, use `db push --skip-generate` when the dev server holds the query-engine DLL open.
* **Consequences:** BUG-002 is obsolete. No migration files are generated, so there is no committed schema history — before production, consider switching to committed migrations for auditability (see TASKS.md).

---

### Renewal Batch → Subscription Pre-selection Navigation (Date: 2026-07-01)
* **Context:** After implementing the Renewal Batch History page, the question arose: how should a user re-use a past batch to generate a new renewal quote? Three options were considered: (A) "View Subscriptions" button that pre-selects the batch's subscriptions on the subscriptions page, (B) a "Re-run Batch" one-click button, (C) show only batch metadata with no navigation.
* **Decision:** Chose Option A — "View Subscriptions (N) →" link per batch row that navigates to `/dashboard/subscriptions?ids=<comma-separated-ids>`. The `SubscriptionsTable` accepts an `initialSelectedIds` prop to pre-check the checkboxes on render, so the user can immediately click "Generate Bulk Quotes" without re-selecting.
* **Consequences:** Requires `?ids=` filter support on the subscription list API (`GET /api/subscriptions`). Added `ids?: string[]` to the `list()` params and `where.id = { in: ids }` Prisma filter. The URL can be bookmarked or shared. No extra DB round-trips — the `subscriptionIds` are already returned by `listRenewalBatches()` via a `renewalHistories` include.

---

### Dynamic Org Name on Customer Detail Page (Date: 2026-07-01)
* **Context:** The customer detail page (`customers/[zohoId]/page.tsx`) showed a static "ZOHO CUSTOMER" label (with `uppercase` Tailwind class) as the page header eyebrow. This gave no useful context when multiple Zoho organizations exist (e.g., "Excel Cloud AI" vs "Anutech").
* **Decision:** Fetch the organization list in parallel with the customer detail call using `Promise.allSettled`, find the matching org by `orgId`, and display `{orgName} Customer` (e.g., "Excel Cloud AI Customer"). If the org fetch fails, falls back to "Zoho Customer".
* **Consequences:** One extra lightweight API call per page load (`GET /organizations`). Since it runs in parallel with the main data fetch, there is no latency penalty. Applied the same pattern to `quick-quotes/page.tsx` (already had org data available — used `q.targetOrganization.name` directly).

---

### CSV Import Logging — Persisted Audit Table vs. Response-Only (Date: 2026-07-01)
* **Context:** The existing `/api/subscriptions/import-csv` returned an `errors: string[]` array in the HTTP response only — once dismissed, the detail was lost. Blank-ID rows were silently dropped.
* **Decision:** Added `CsvImportLog` / `csv_import_logs` table persisting every import run with full per-row skipped/error detail. Added list/detail/errors-csv endpoints. Frontend replaced truncated `alert()` with a non-truncated inline panel + download link.
* **Consequences:** Requires `prisma migrate dev` before the API builds. See TASKS.md for the exact migration command.

---

### Bulk Subscription Management Approach (Date: 2026-06-30)
* **Context:** Users needed to manage subscriptions for customers with 1000+ domains where one-by-one selection is infeasible.
* **Decision:** Implemented Option C — hybrid Textarea (paste domain list) + CSV Export/Import for comprehensive bulk updates.
* **Consequences:** Maximum flexibility. Simple cases via copy-paste; complex cases via Excel/CSV. Requires `papaparse` server-side for robust CSV parsing.
