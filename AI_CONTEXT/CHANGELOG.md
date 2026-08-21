# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added (Session 2026-07-18 — Latest)

Theme: **in-app document PDFs** — view Zoho quote/invoice PDFs inside the app, attach the quote PDF to the SendGrid quick-quote email, and render PDF Branding (logo/signature) on the app-generated quote PDF + the print page.

#### View PDF for Zoho estimates/invoices (DB-cached)
- New table **`zoho_document_pdf`** (bytea) caches the PDF bytes of a Zoho estimate/invoice, keyed `(organization_id, entity_type, zoho_doc_id)`. Prisma model + `schema.sql` (§4.2b) + `db push`.
- **`ZohoApiClient.getBinary(path, params)`** — raw binary fetch (bypasses the UTF-8 `transformResponse`) → `Buffer`.
- **`ZohoService.getDocumentPdf(orgId, kind, docId, {force?})`** — DB-cache-first; miss/`force` fetches `GET /{estimates|invoices}/{id}?accept=pdf`, stores the bytes + doc number, returns them. `invalidateDocPdf()` drops a stored row.
- **New endpoint** `GET /api/organizations/:id/documents/:kind/:docId/pdf` — streams `application/pdf` (`?download=1` attachment, `?force=1` re-fetch); behind the global auth guard.
- **Webhook invalidation:** `estimate_updated` / `invoice_created` / `payment_added` now drop the stored PDF (alongside the existing doc-detail cache) so a stale PDF is never served.
- **Reusable `ViewPdfButton`** (`apps/web/src/components/view-pdf-button.tsx`) — blob fetch with `credentials:'include'`, popup-blocker-safe (opens the tab inside the click gesture), anchor fallback, "⚠ Retry" on error.
- **Wired into 4 surfaces:** Quotes & Invoices browser (always-on "PDF" column), Renewal Batch review (per-batch estimate PDF; added `organizationId` to the batch payload interface — backend already returned it), Subscription-detail renewal-history timeline (📄 next to each quote/invoice link), converted-invoice actions ("📄 Invoice PDF" = the real Zoho Tax Invoice; kept the app "Quote Sheet" print link).
- First open = 1 Zoho call; repeat opens = 0 (served from DB).

#### Quote PDF attached to the quick-quote email (SendGrid)
- **`EmailService.send()` gained `attachments`** (SendGrid base64 attachments).
- **`QuickQuotesService.buildQuotePdf()`** — renders the quote as a PDF via **pdf-lib** (org header, quote #/date/valid, BILL TO, items `# | Item | Qty | Rate | Amount`, totals, notes, terms, sign-off), mirroring the email sheet / print page. Attached as `{quoteNumber}.pdf` on `POST /quick-quotes/:id/send` (best-effort — a PDF failure logs a warning and the email still goes out). A quick quote is app-native at send time (no Zoho estimate), so this is generated, not fetched.
- **Zoho-sent emails (Tax Invoice / renewal Quote / batch)** already attach the document PDF natively (Zoho) — left unchanged (user-confirmed) to avoid duplicate attachments.

#### Quote PDF layout tweaks (print page + email PDF, matched)
- Applied to **both** the `/quotes/[id]/print` page and the pdf-lib email attachment (`buildQuotePdf`), kept in sync: (1) **"QUOTATION" as a centered document title** (removed the small "Quotation" under the org name); (2) **removed the Disc% and Tax% columns** from the item table (now `# · Item · Qty · Rate · Amount`); (3) **Discount row shows only when `discountAmount > 0`**; (4) **"Tax" label → "GST"** in totals; (5) **company address footer** (legal/display name + address + phone/email/website + GSTIN, from `org_settings`). Print page fetches address via `GET /org-settings/:orgId`; the pdf-lib version selects the same fields.
- **Modern brand-colored redesign (same session, both renders):** the org's **`brandColor`** (Settings → PDF Branding — previously stored-but-unused on the quote PDF) now drives a **top accent bar**, the **quote-number chip** (print) / brand-colored number (PDF), the **centered QUOTATION title**, the **BILL TO / PAY TO labels**, the **items-table header band** (readable white/dark text auto-picked by luminance), and the **Total value**. Items get **zebra striping**; totals sit in a **tinted card**; the previously-unused **`pdfWatermark`** (DRAFT/DUPLICATE) renders as a faint diagonal watermark; the previously-unused **bank details** (`bankName`/`bankAccountHolder`/`bankAccountNumber`/`bankIfsc`) render as a **"PAY TO" block** bottom-left opposite the **Authorised Signatory** signature block (PDF's "Regards" sign-off replaced — the email body already carries it). Print CSS adds `print-color-adjust: exact` so the bands/stripes actually print.

#### PDF Branding (logo + signature) on the quote PDF + print page
- `buildQuotePdf()` now embeds the org's **logo** (header) and **signature/seal** (sign-off) from `org_settings.logoUrl` / `signatureImageUrl` (base64 data-URLs from Settings → PDF Branding). `embedImage()` handles **PNG/JPEG only** (pdf-lib can't do SVG/WebP → skipped gracefully); money uses the ISO currency code (₹ isn't WinAnsi-encodable) and non-Latin-1 text (e.g. Devanagari) is stripped in the PDF.
- **Print page `/quotes/[id]/print`** now renders the logo (header), signature (bottom-right "Authorised Signatory") and footer text — fetched via `GET /org-settings/:orgId` using the quote's `targetOrganizationId`. Browser `<img>` renders SVG/WebP too, so the print page is not limited to PNG/JPEG.
- ⚠️ Typecheck-clean (both apps, exit 0); **not yet run against live Zoho / SendGrid.**

### Added (Session 2026-07-15 Part 2 → 2026-07-16)

One continuous working session across the date boundary. Two themes:
(a) **app-native quote emails** — SendGrid-only, per-org senders/signatures, PDF-like quote sheet, resend, no-links policy;
(b) **convert & fresh-sales bulk flow** — subscription decision at Convert, Create Invoice for existing customers, bulk-domains quotes → one-click bulk subscriptions, per-customer bulk-quote grouping, Undo Accept, BUG-015…BUG-019.

#### Quick Quote email send (SendGrid) + per-org sender addresses · convert & bulk-domains flow
- **Quick Quote "Send" now emails the quote.** `POST /quick-quotes/:id/send` — when `recipient_email` is given, sends the seeded `quote_sent` template (placeholders: customer/quote number/validity `DD/MM/YYYY`/currency-aware total/absolute public link from `WEB_BASE_URL`/sender = quote creator/company = target org) via `EmailService.sendFromTemplate`. Token + `Sent` status persist **first**, then the mail goes out — an email failure returns `emailSent:false` + `emailError` instead of failing the send (link stays usable). No `recipient_email` = old link-only behaviour. Response gains `emailSent`/`emailTo`/`emailError`. `QuickQuotesModule` imports `EmailModule`.
- **Send compose modal** (`quote-actions.tsx`) — "📤 Send Quote" now opens a small modal: **To** prefilled with the lead's email (threaded `leadEmail` through `QuoteActionBar` from both detail-page call sites), "✉ Send Email" or "सिर्फ link banao (email नहीं)" fallback; result line shows sent-to / amber email-failed / link-only states.
- **Per-org sender wired into `EmailService`** — `send()`/`sendFromTemplate()`/`sendTestEmail()` accept an optional `organizationId`; sender resolution = `org_settings.emailFromAddress`/`emailReplyTo` (From name: `displayName` → `legalName` → org name) → global `email` settings fallback. The previously-stored-but-unused **Settings → Organizations → 📧 Sender Email Config** values are now actually used. Callers pass the org: quick-quote send (`targetOrganizationId`), scheduler renewal reminders (`sub.organizationId`). **Each per-org From must be a verified sender in SendGrid** (Single Sender or Domain Authentication per org domain).
- **Fixed: `PUT /org-settings/:orgId` rejected all bodies (BUG-016)** — `UpdateOrgSettingsDto` was the only nestjs-zod DTO; the global class-validator `ValidationPipe` (`forbidNonWhitelisted`) saw zero whitelisted properties and errored "property X should not exist" for every field. Converted to class-validator decorators like every other DTO.
- **Fixed: org "Sender Email Config" save never worked (BUG-015)** — the `'use client'` component imported the server-only `next/headers` in the browser, so every save threw pre-request and showed "Server से connect नहीं हो पाया". Now a plain client `fetch` with `credentials:'include'` + proper `{error:{message}}` parsing + `router.refresh()` on success.
- **Rich quote email as a PDF-like sheet + Accept/Decline from the mail** (user feedback after the first live send, then refined to match the print-page look). The quote email (`buildQuoteEmailHtml` in `quick-quotes.service.ts`, replaces the plain `quote_sent` template for quote sends) renders: greeting on a grey backdrop → a **white A4-style sheet** mirroring `/quotes/[id]/print` (org name + "Quotation" | quote # + Date + Valid till, **BILL TO** block from the lead (company/contact/email/city, state/GSTIN), items table **# | Item | Qty | Rate | Amount** — tax/discount columns removed per user; item description + cycle·domain sub-lines, totals with Total bold, Notes + Terms inside the sheet) → **✓ Accept / ✗ Decline buttons + sign-off below the white area**. Currency-symbol aware; HTML-escaped; inline-CSS/table layout for mail clients. **Safety:** buttons deep-link to the public page with `?action=accept|reject` — never a state-mutating GET, so Gmail/Outlook link-scanners can't accidentally accept a quote.
- **Public quote page: Decline support** — new public `POST /quick-quotes/reject` (`RejectQuoteDto {token, reason?}`): Sent/Viewed → `Rejected` + `rejectedAt`/`rejectionReason`, linked lead → `Lost`. Page swaps `AcceptButton` for `QuoteDecision` (accept + decline with optional-reason form, "declined" banner for Rejected quotes); `?action=accept` auto-opens the accept confirm, `?action=reject` pre-opens the decline form — mutation always needs an in-page confirmation. Old `accept-button.tsx` deleted.
- **BUG-019 fixed: already-converted lead showed "Convert to Customer" again** — accepting a follow-up quote overwrote the lead's `Converted` status with `Won` (unconditional update in `accept()`/`acceptByAdmin()`), and the lead page derived `isConverted` from status alone. Accept flows now never downgrade `Converted`; `isConverted` also checks the durable `convertedToZohoCustomerId`; 3 dev-DB leads restored to `Converted`; the converted-state header now links to the internal customer page (old raw `books.zoho.in` link 404'd) and keeps "+ New Quote" available (follow-ups route via the existing-customer Create Invoice path).
- **Lead page: Convert form hidden until an accepted quote exists** (user asked what the logic was — there was none: the panel showed a "कोई accepted quote नहीं" warning but still rendered the full Domain/Start-Date/decision form + Convert button, which could only fail with "Conversion failed" since the backend requires an Accepted quote). `ConvertLeadPanel` now early-returns a guidance card ("pehle ✓ Mark as Accepted karo — phir convert form yahan aayega") when `acceptedQuotes` is empty.
- **"Generate Bulk Quotes" now groups per CUSTOMER — mixed items get ONE multi-line quote** (user found it during bulk-flow UAT: 3 domains × 2 items, same cycle/dates → got 2 separate estimates; expected 1). `bulkRenewalQuote`'s group key dropped `zohoItemId` (now `org_customer_cycle_endMonth`); a uniform group (single item+rate) takes the unchanged live-verified single-line path, a **mixed group is delegated to `combinedRenewalQuote`** (one estimate, one line per item+dates+rate, per-line ≥100 annexure, one RenewalBatch) and adapted into the same results/batch-review shape (`zohoItemName: "Combined (N lines · M domains)"`). Price overrides keep working via a legacy per-item key fallback (the UI doesn't send overrides today). NOTE: the bulk-domains fresh flow (quote→accept→invoice→bulk subscriptions) was **verified live by the user** this session; the new per-customer grouping is typecheck-clean, not yet re-driven live.
- **Bulk-domains fresh quote → compact quote/invoice → one-click bulk subscriptions (Option A)** — the fresh-sales counterpart of the renewal bulk machinery. (1) **Builder:** each line item has a "⇲ Bulk domains" toggle → textarea (one `domain[, qty]` per line, per-domain qty supported); line Qty auto = Σ qty; stored in new `quick_quote_items.domain_list` JSONB (`db push` + schema.sql). First domain doubles as `primaryDomain` (prefills the Convert modal). (2) **Compact display everywhere:** quote page (billing-cycle line shows "🌐 N domains" + expandable list), email card ("Domains (N): a, b, c +N-3 more", auto-link-safe), public page, print/PDF page (full list in a 3-column grid). (3) **Convert:** single aggregated Zoho line (domain CF "first +N more", header CF likewise from the primary item); **<100 domains listed in the line description, ≥100 → summary + Technical Annexure PDF attached to the INVOICE** (`AnnexureService` gained `opts.entity: 'estimates'|'invoices'`; `SubscriptionsModule` now exports it, `ConversionsModule` imports it). Convert also persists the service dates onto the quote items (`finalizeBulkInvoiceExtras`). (4) **Bulk subscriptions:** new `POST /subscriptions/bulk-create-from-quote` → `bulkCreateFromQuote()` loops domains through the CSV-import core `applyImportItem` (dedup/enrich/idempotent-history; `opts.originQuickQuoteId` new) — one subscription per domain, converted invoice linked as last-invoice + history (`businessType: Fresh`); returns created/enriched/skipped/errors. UI: with "हाँ, अभी बनाओ" the convert flow **auto-runs the bulk create** (no single-sub page for bulk quotes); with "बाद में" the post-convert button reads **"🚀 Create N Subscriptions"**. Conversion results + `getPostConvertInfo` gained `bulkDomainCount`.
- **Undo Accept** (user asked how to revert an accidental "Mark as Accepted" — there was no path). New `POST /quick-quotes/:id/unaccept` + amber "↩ Undo Accept" button on the quote page (shows only while status = `Accepted`, i.e. pre-convert): quote reverts to `Sent` (if ever sent) else `Draft`, `acceptedAt` cleared, lead rolled `Won` → `Quoted` (only if it was Won — Converted leads untouched). A converted quote (`Pushed_To_Zoho`) can't be reverted app-side — the Zoho invoice must be voided in Zoho.
- **Optional Domain column back on the quote items table** (user request; softens the 2026-07-15 "dates/domain at Convert only" decision for domain alone) — a Domain input sits between Item Details and Subs. Period, **optional** (no validation). When filled, it **prefills the Convert modal's Domain field** via the already-wired `defaultDomain = items[0].primaryDomain`; Convert-time entry still overrides. Backend/edit-page already round-tripped `primary_domain` — only the input + `items_json` payload field were missing. Service dates remain Convert-step-only.
- **BUG-018 fixed: post-convert redirect race** — with "हाँ, अभी बनाओ" the Subscription page didn't open: the convert action's self-page `revalidatePath` re-rendered the quote page into post-convert mode, unmounting the Convert button before its `useEffect` redirect ran. `ConvertFromQuoteButton` now uses a direct async submit handler (push/refresh in the same continuation as the action result) and the action no longer revalidates the quote page. KNOWN LIMITATION (user asked): with **multiple subscription items** on one invoice, the Subscription page prefills only the **first** item and shows a "बाकी manually add करें" warning — no per-item sequential flow yet.
- **Existing-customer quotes: customer-first, org auto-locks** (user's suggestion, completing BUG-017 prevention) — the quote builder's Existing Customer picker now searches **across all active orgs** (new `GET /api/customers/cross-org-search` → `searchCustomersAllOrgs()` on `zoho_cache`, org badge per result); picking a customer **auto-sets and locks** the Organization field ("customer के org से auto-set"; unlocks when the pick is cleared ✕). The selected-customer chip shows the org. The earlier clear-customer-on-org-change interim fix became unnecessary (the select is hidden once a customer is picked) and was removed.
- **Convert form is now a popup modal** — the inline `w-72` panel squeezed the quote-page header; the Convert to Customer / Create Invoice form (Domain + Start Date + subscription decision) now opens as a centered overlay modal (backdrop-click/Cancel closes, closes itself on success, error shown inside).
- **BUG-017 fixed: cross-org customer on a quote** — org change in the quote builder clears the picked existing customer; `convertExistingCustomerQuote` fails early with a named "Customer/org mismatch" error when the cache knows the customer only under a different org (was Zoho's cryptic "Customer is not accessible"). QQ-2026-0020 data-fixed in the dev DB.
- **Subscription decision asked at Convert time (Option A)** — the Convert form (Domain + Start Date) gained a radio: **"हाँ, अभी बनाओ"** (default; auto-opens the Subscription page as before) · **"बाद में (Ask me later)"** (stay on the quote page; Create Subscription button remains) · **"नहीं — one-time deal"** (button hidden; an undo link "बदलना हो तो यहाँ click करें" flips it back to 'later'). The radio shows only when the quote has subscription items. New `quick_quotes.subscription_decision` VARCHAR(20) (`create_now|later|never`, NULL = pre-feature → treated as 'later') via `db push` + schema.sql backfill (also backfilled the missing `zoho_invoice_status` doc drift). Both convert DTOs + both convert paths persist it; conversion results + `getPostConvertInfo` return it; redirects (quote button + lead panel) fire only on `create_now`; new `POST /conversions/quote/:quoteId/subscription-decision` + `setSubscriptionDecisionAction` for post-convert changes. Lead-page convert panel shows a "⏳ Subscription pending" note for 'later'.
- **Converted-invoice email now goes through the compose modal** (was a blind direct send — user wants to see/edit what goes out, same as quote emails). The quote page's "✉ Email Invoice / ↺ Re-send Invoice" button now opens the shared `SendEmailModal` (Zoho template preview, editable To/CC/BCC/subject/body, template switcher, contact suggestions). New `GET /conversions/quote/:quoteId/invoice-email-preview` (mirrors subscriptions' `getInvoiceEmailPreview`; lead email added to suggestions); `POST …/email-invoice` accepts an optional `EmailInvoiceDto` compose override (no override = legacy default-recipient resolution, now reusing the preview). `emailQuoteInvoiceAction` gained the override param + new `getQuoteInvoiceEmailPreviewAction`.
- **Already-converted lead's quote no longer offers "Convert to Customer"** — an Accepted lead-quote whose lead has `convertedToZohoCustomerId` (customer already in Zoho) now takes the **existing-customer path**: the button reads **"🧾 Create Invoice"** and only a Zoho invoice is created against the existing contact (previously it showed "Convert to Customer", which would have hit the "Lead is already converted" guard / risked a duplicate contact). Backend: `convertExistingCustomerQuote` now also accepts lead-quotes, resolving the customer as `quote.zohoCustomerId ?? lead.convertedToZohoCustomerId` (name falls back to `lead.companyName`); quote detail page passes `mode:'existing'` for such quotes; button + panel labels are mode-aware.
- **Quote email: no auto-linked domains/emails + labelled subscription lines** — domains and email addresses in the mail (BILL TO email, item domain, description text) are rendered with zero-width spaces (`noAutoLink()`) so Gmail/Outlook can't auto-link them; the item sub-line "monthly · domain" became two labelled lines: `Domain Name: <domain>` / `Subscription Period: Monthly` (cycle label map, `annual→Yearly`).
- **Quote email carries no links/buttons** (user decision, after seeing the live mail): the Accept/Decline buttons and the "view online" line were **removed from the email** — quotes are accepted **manually in the app** (Mark as Accepted). The mail is now purely the PDF-like quote sheet + sign-off. The public page (with its `QuoteDecision` accept/decline) and the `POST /quick-quotes/reject` endpoint **remain** — reachable only if the user shares the link via **Copy Link**.
- **Public link never displayed in the app UI** (user decision) — removed the blue "Public link: <url>" banner from the quote detail page and the raw URL from the send-success message; sharing is via the **Copy Link** button only, which now shows **only while the quote is open for a decision** (Sent/Viewed — hidden on Accepted/Rejected/Expired). The email's Accept/Decline buttons + "view online" link (hyperlinked quote number, not a raw URL) are unchanged — the customer needs those.
- **Resend for already-Sent quotes** — the quote page showed no send option once status = Sent (button was Draft/Viewed-only from the link-era design). `send()` now also allows `Sent`; on resend the **existing public token is reused** (links already shared stay valid) and only the expiry window refreshes (`validityDays` from now). UI shows "↩ Resend Quote" with resend-aware modal copy.
- **Per-org email signature wired** — the previously-unused `org_settings.emailSignatureHtml` is now appended (in a `margin-top` div) to every email sent with that `organizationId`, independent of the From override; plain-text fallback derives from the signed HTML. New **Email Signature (HTML) textarea** in the org card's 📧 Sender Email Config (saved via the existing `PUT /org-settings/:orgId`, DTO already accepted it); `Organization.orgSettings` web type gained the field.
- **SMTP support built then removed same-session** (user decision: "SMTP will create confusion — SendGrid only"). `nodemailer` + `smtp_*`/`provider` settings + the provider-selector UI were reverted; `EmailService` is SendGrid-only again. Any `email.smtp_*`/`email.provider` rows already saved in `app_settings` are ignored (harmless leftovers).
- Settings → Email Configuration labels now say **Default** From address/name and point to the per-org config for org-specific senders.
- ⚠️ Typecheck-clean (both apps, exit 0); **not yet sent against live SendGrid** — configure the API key + verified senders and use Send Test first.

### Added (Session 2026-07-15 — Part 1)

#### Customizable Customers list-view (new browser on `/dashboard/customers`)
- New **customizable Customers browser** modeled on the Quotes & Invoices browser. New `customers` API module: `GET /api/organizations/:id/customer-columns` (dynamic catalog), `GET /api/organizations/:id/customer-rows` (paginated + search), `GET/POST/DELETE /api/customer-views` (private per-user saved views, `user_preferences` key `zoho_customer_views`). `CustomersModule` registered in `app.module.ts`.
- **Dynamic column catalog** = cached `zoho_cache.extra` scalar fields + the customer's Zoho custom fields + **app-aggregate** columns: `active_subscriptions`, `domains_mapped`, **`last_quote_number`/`last_quote_date`, `last_invoice_number`/`last_invoice_date`** (batched Prisma `groupBy` + reduce-latest). Customize Columns modal (pick + reorder), saved views, CSV export, sort, pagination — all column-driven.
- `customize-columns-modal.tsx` **moved** to `apps/web/src/components/` and genericized (`CustomizableColumn`, `group: standard|custom|app`); the documents browser now imports the shared copy. New `customers-browser.tsx`; `customers/page.tsx` is a thin shell.
- ⚠️ Typecheck-clean; **not yet verified against live Zoho.**

#### Quick Quote page redesigned — "Unified Builder" + Lead+Quote in one submit
- Rebuilt `quote-builder.tsx`: two-mode customer cards (New Customer/Lead default+left, Existing right), progressive New-Customer form (Company\*/Contact/Email\*/Phone/State\*/Country\* + "More Details": Billing Address L1/2/3 · GSTIN/City/Postal), **merged Quote Details + Items** section (Item Details | **Subs. Period** | Qty | Rate | Amount), 3-column Notes/Terms/Internal-Notes, gradient totals card (CGST/SGST split). Cost Price field removed (collected later at domain time). Old New-Lead modal removed.
- **Unified create:** New-Customer mode POSTs `/leads` then submits the quote in one click (client `flushSync` + `requestSubmit`; unchanged quick-quotes contract). **Organization chosen in-form** (dropdown for new lead; locked when an existing lead is attached / editing). `quick-quotes.service.create` flips a linked lead `New/Contacted`→**`Quoted`** (Draft, no auto-send).

### Changed (Session 2026-07-15)
- **Domain + Service dates moved out of the Quote form → Convert/Push step.** Quote line items keep only the **Subs./Service Period** selector; Domain + Service Start are collected at convert (new shared `conversion-details-fields.tsx`, both required), and the End Date auto-computes from the period (`addCycle`) and is editable on the subscription page.
  - Backend: `TriggerConversionDto` + new `ConvertQuoteDto` gained `domainName`/`serviceStartDate`; `conversions.service` (`buildInvoiceLineItems`, `triggerConversion`, `convertExistingCustomerQuote`, subscription prefill, `getPostConvertInfo`) uses them (fallback `lead.primaryDomain`/today) and computes end. `CreateLeadDto` + `leads.service.create` gained **`country`**.
  - Frontend: `convert-lead-panel.tsx`, `convert-from-quote-button.tsx`, `quote-action-bar.tsx`, the two `[id]/page.tsx`, and both `actions.ts` thread `defaultDomain` / `domain_name` / `service_start_date`.
- **Dashboard Subscription Alerts grouped by customer** — the "Expiring in 30 Days" and "Expired" blocks now group by customer (`groupByCustomer` helper): customer name once + a "N subscriptions" badge when >1 + per-domain clickable rows. (`apps/web/src/app/dashboard/page.tsx`.)

### Fixed (Session 2026-07-15)
- **Subscriptions "Expiring in N days" filter returned an empty list.** `findAll`/`countByStatus` filtered on the invalid enum literal `'ExpiringSoon'` instead of the actual Prisma member `'Expiring_Soon'`, so Prisma rejected the query and the swallowed error rendered the empty state. Corrected both occurrences in `subscriptions.service.ts`. (BUG-014)

> ⚠️ **All 2026-07-15 work is typecheck-clean (both apps, exit 0) but NOT yet verified against live Zoho.**

### Performance — Zoho-API-call reduction (Session 2026-07-14)

Implements `AI_CONTEXT/PERF_PLAN.md`. Goal: fewer Zoho Books API calls + lower latency. Backend-only; no behaviour change. Files: `apps/api/src/zoho/{zoho.service.ts,zoho-api.client.ts,webhook.service.ts}`, `apps/api/src/documents/documents.service.ts`.

- **Doc-detail read cache (PERF_PLAN #1):** new `ZohoService.getDocDetailCached()` — short-TTL (10 min) in-memory cache for estimate/invoice detail. The **Quotes & Invoices browser** did **1 detail call per row**; repeat page views now cost **0 Zoho calls**. (In-memory / process-local; DB-backed upgrade via `zoho_cache` is the documented follow-up.)
- **Cross-link columns local-first (PERF_PLAN #2):** `documents.addLinkedFields()` now fills the linked Invoice# / Date / Status / Payment from local `renewal_history` (webhook-maintained) before any Zoho call — most rows resolve with **0 extra calls**; falls back to the cached detail otherwise.
- **Webhook cache invalidation (PERF_PLAN #3):** `WebhookService` now drops the cached estimate/invoice detail on `estimate_updated` / `invoice_created` / `payment_added`, so the browser never serves a stale status. (`WebhookService` now depends on `ZohoService`.)
- **In-memory token cache (PERF_PLAN #4):** `getValidAccessToken()` serves a per-org decrypted access token from memory — removes a DB read + AES decrypt on **every** Zoho request. Kept in step on refresh; cleared on disconnect / reconnect / revoke.
- **Customer detail TTL (PERF_PLAN #5):** `getCustomerDetail()` serves the cached full Zoho contact when COMPLETE (has `billing_address`) and FRESH (<6 h), and persists it back to `zoho_cache` otherwise — was a live contact fetch on **every** page view.
- **Org-settings memo + concurrency (PERF_PLAN #6):** `getOrgMeta()` memoizes `org_settings.metadata` (1-min TTL, invalidated on mapping writes), collapsing the repeated `orgSettings.findUnique` in `buildCustomFields` / `getBusinessTypeLabel` / `getBillingOptions` / `getItemFieldMappings`. Bottleneck `maxConcurrent` 5→8 (still bounded by the 80/min reservoir).
- **Deferred (by decision):** import wizard left uncached (deliberate one-shot sync wants fresh data); delta-sync (`last_modified_time`) and web-layer read caching + a webhook queue — noted in PERF_PLAN.md, need live verification / infra.
- ⚠️ **Verified by code inspection only — `tsc` not run** (sandbox file-mount glitch). Run `pnpm typecheck` before trusting; drive the documents browser against live Zoho to confirm cache + cross-link behaviour.

### Added (Session 2026-07-14)

#### Quotes & Invoices browser (new page `/dashboard/documents`)
- New **read-only, filter-then-fetch** live browser for Zoho estimates/invoices + sidebar item **"Quotes & Invoices"** (after Quick Quotes).
- **New `documents` API module:** `GET /api/organizations/:id/documents` (filtered + paginated live fetch, normalized flat field map per row), `GET /api/organizations/:id/document-columns` (column catalog), `GET/POST/DELETE /api/document-views` (per-user saved views).
- **Dynamic column catalog:** standard fields + the org's custom fields (from `custom_field_mappings[docType]`) + **cross-linked columns** — Quotes show the converted **Invoice# / Invoice Date / Invoice Status / Payment Date**; Invoices show the originating **Quote# / Quote Date / Quote Status / Payment Date**.
- **Customize Columns** modal (pick + reorder, Zoho-style), **private per-user saved views** (docType + filters + columns + sort, stored in `user_preferences` key `zoho_document_views`), **Export CSV**, column sorting, Next/Prev pagination, and `#/quotes/` deep links.
- ⚠️ Typecheck-clean; **not yet verified against live Zoho.** Cross-link columns cost one extra Zoho call per linked row.

#### Post-"Generate Bulk Quotes" workflow — Batch review screen (send + track)
- "Generate Bulk Quotes" now returns `batchIds` and **navigates to the Renewal Batch review screen** (`/dashboard/subscriptions/renewal-batches?ids=…`) with a "✓ N quotes created — review & send" banner (previously a dead-end `alert()`).
- **Renewal Batch History upgraded to an actionable review screen:** Status column (Draft/Sent/Accepted/Declined/Invoiced/Paid), estimate # as a `#/quotes/` deep link, checkboxes + **Send Selected / Send All** (Zoho default template), per-row **✉ Send** (compose modal), per-row + **Refresh All** (status sync).
- **New endpoints:** `POST /api/subscriptions/renewal-batches/:batchId/send` (with/without compose override), `POST /api/subscriptions/renewal-batches/:batchId/refresh`, `GET /api/subscriptions/renewal-batches/:batchId/email-preview`.
- `GET /api/subscriptions/renewal-batches` gained an `ids` filter, a per-batch derived `status`, and the org relation (for the deep link).
- The per-row compose modal was **generalized** into a shared `SendEmailModal` (`apps/web/src/components/send-email-modal.tsx`), reused by the subscription-detail and batch flows.
- ⚠️ Typecheck-clean; **not yet verified against live Zoho.** Out of scope (by decision): convert-accepted→invoice, roll-dates-on-paid.

### Fixed (Session 2026-07-14)
- **Quote deep links 404'd ("Page Not Found").** Estimate deep links were built as `#/estimates/{id}`, but Zoho Books' web app routes estimates under `#/quotes/{id}`. Both builders (`zohoUrl`, `zohoBooksUrl`) now map the `estimates` entity to a `quotes` path segment (web-route-only; the Zoho REST API entity stays `estimates`). (BUG-013)

### Added (Session 2026-07-11 — Part 2)

#### Combined Quote — one multi-line estimate per customer
- **New** `POST /api/subscriptions/combined-renewal-quote` (`combinedRenewalQuote()`, `CombinedRenewalQuoteDto`): collapses many subscriptions of **one customer** (mixed items / cycles / renewal months) into a **single multi-line Zoho estimate**. Validates same org+customer; only quotes renewable subs (Active/Expiring_Soon/Expired). Returns `{ renewalBatchId, zohoEstimateId, zohoEstimateNumber, lineCount, domainCount, totalAmount, skippedCount, subscriptionIds }`.
- **Line merge:** subs sharing **item + renewal start/end + rate** collapse into one line; that line's description lists `domain.com (qty)` per domain, line quantity = Σ per-domain qty. Different rate → separate line.
- **Header custom fields** taken from the sub with the **nearest / most-overdue renewal date** (earliest endDate).
- **Per-line ≥100 domains** → summary description + a **Technical Annexure PDF** attached for that line. `AnnexureService.generateAndUploadAnnexure` extended with an optional `opts` ({ subtitle, fileLabel }) and an optional per-domain `quantity` (renders a **Qty** column) — backward-compatible with the "Generate Bulk Quotes" caller.
- **Persistence:** one `RenewalBatch` links every sub's `renewal_history` (still one row per domain) to the single estimate; per-domain breakdown stored in `annexureData`.
- **Customer page:** new client component `customers/[zohoId]/_components/customer-subscriptions.tsx` owns the Active Subscriptions card with two right-aligned header buttons — **+ New Subscription** and **Combined Quote** (selection mode → generate).
- **New-subscription form** gained a `mode=manual` path: org + customer pre-filled & **locked**, item/domain/dates entered manually (for the customer-context "+ New Subscription").
- ⚠️ Typecheck-clean; **not yet verified against live Zoho.**

#### Renewal Batch History — domain search
- `GET /api/subscriptions/renewal-batches` `search` now also matches **domain names** (via `renewalHistories.some.domain.domainName`); each batch gains **`matchedDomains: string[]`**. The Batch History page placeholder now includes "domain" and renders matched-domain 🔗 badges.

### Changed (Session 2026-07-11 — Part 2)
- **Subscriptions list table:** column header **"End Date" → "Subs. Period"**; the cell now shows **`start → end`** with the day count below (e.g. `28 May 2026 → 27 May 2026` / `266 days`). No backend change (`startDate` already on the row).
- `AnnexureService.generateAndUploadAnnexure(...)` signature extended with optional `opts?: { subtitle?; fileLabel? }` and optional `quantity` on each domain (backward-compatible; the bulk caller is unchanged).

### Fixed (Session 2026-07-11 — Part 1)

#### Generate Bulk Quotes (was silently failing)
- **Estimate create no longer 400s.** `bulkRenewalQuote` sent a hardcoded `{ label: 'Business Type', … }` custom field, but this org's field is labelled **"Business Type?"**, so Zoho rejected the whole create (HTTP 400, code 120129). Now builds all custom fields via the org-aware `buildCustomFields()` + `getBusinessTypeLabel()` / `getBillingOptions()` (no hardcoded Zoho labels/api_names). (BUG-009)
- **Failures are surfaced.** `POST /api/subscriptions/bulk-renewal-quote` now returns `createdCount` / `failedCount` / `estimateNumbers` / `errors`; the subscriptions table shows the real Zoho error on failure instead of a blanket "success", and no longer prints a misleading hardcoded `₹` total. (BUG-010)
- **Number custom fields no longer store `0`.** `buildCustomFields` now keys custom fields by **`api_name`** for every module **except `contacts`** (was `index` for non-item modules). Verified live: `index` silently zeroes number fields such as `cf_total_licences`. (BUG-011)
- **All estimate fields now populated.** Added header **Domain Name** + **Service Expiry Date** and line-item **Domain Name / Start Date / End Date / Cost Price** (previously never sent). **Subs Period** falls back to a static label map when the org's `billing_period_options` metadata is empty. Domain Name shows **"first-domain +N more"** (single aggregated line kept). Description dates now render **`DD/MM/YYYY`** (Zoho date fields stay ISO). (BUG-012)
- All fixes verified end-to-end against **live Zoho** (create → inspect → delete). Both apps typecheck clean.

### Added (Session 2026-07-11)

#### Multi-currency (Phase 2 — started)
- Subscriptions **list table** price column is now currency-aware — reuses the `money()` helper + currency symbol map from the subscription detail page, so USD/AED/etc. rows show `$1.65` instead of `₹1.65`. (`₹` still hardcoded in the **Export CSV** and **PDF/quote builder** — remaining Phase 2 work.)

### Added (Session 2026-07-10)

#### Import-from-Zoho: quotes as a source + more filters (Track C completion)
- Wizard can now fetch from **Quotes (Estimates)** as well as Invoices (`GET /api/organizations/:id/estimates-preview`), normalized to the same grouping pipeline.
- New Step-1 filters: **Document Source**, **Business Type** (All/Renewal/Fresh/Pro-rata/Transfer), **Service Expiry From/To** range (post-filtered in-app on `cf_new_business` / `cf_next_invoice_date`), plus the existing Reference No. / status / dates.
- **Estimate import is status-gated**: a quote creates a subscription only when its status is Accepted/Invoiced; otherwise it links as history to an existing sub (quote-only history rows → `renewalStatus=Quoted`, dedup by quoteId).

#### Multi-currency (Phase 1)
- `subscriptions` + `renewal_history` gained **`currency`** + **`exchange_rate`** columns (schema.sql + Prisma; `db push`). Selling prices are stored in the customer's billing currency (not INR-converted); base-equivalent = amount × exchange_rate.
- **Convention:** `currency`/`exchange_rate` describe the **selling side** (`subscriptionPrice`, `nextRenewalPrice`); **`costPrice` is always the org base currency (INR)** — matches "charge client in USD, pay vendor in INR".
- Both importers capture currency: Import-from-Zoho reads invoice/estimate `currency_code`+`exchange_rate`; CSV importer adds an optional **Currency** column (defaults to the customer's Zoho currency) + optional **Exchange Rate**, with a warning for foreign currency lacking a rate.
- **CSV currency guard:** if the `Currency` column is provided and doesn't match the customer's Zoho currency, the row is **rejected with an error** (blank still auto-defaults to the customer's currency).
- **Subscription detail page** now formats **Price / Renewal Price** in the subscription's currency (e.g. `$1.65`) via a `money()` helper + symbol map; renewal-history subtotals use each event's own currency; a **Cost (base)** row shows cost in ₹.
- **Customer detail** page now shows Currency + Country. Wizard shows a currency chip on non-INR rates.
- Phase 2 pending: Lead country/currency form; `₹`→currency symbol in the subscriptions **list table** + **PDF/quote builder**; currency-aware dashboard totals.

### Added (Session 2026-07-09)

#### Subscription import & history linking
- **CSV bulk-create importer** — `POST /api/subscriptions/import-create-csv` + new web page `/dashboard/subscriptions/import-csv`. Resolves Zoho Customer Number (via `zoho_cache.extra.contact_number`), Item by SKU/ID→Name, and Organization; validates and reports a 3-bucket result (created / enriched / warnings / errors) with downloadable warnings+errors CSV and a sample template. Lifecycle status computed from dates.
- **Enrich-existing mode** — the shared `importGrouped`/`applyImportItem` core now attaches missing renewal history to already-existing subscriptions (idempotent, dedup by invoiceId) instead of skipping, and refreshes the last-invoice snapshot. Never creates duplicates.
- **Quote linking** — Import-from-Zoho now follows each `invoice.estimate_id` to resolve and persist the originating quote into renewal history (`quoteId/quoteNumber/quoteDate/zohoEstimateStatus`).
- **Flexible wizard filters** — Import-from-Zoho gained a Reference-No. fetch filter (+ `customer_id` passthrough) and instant client-side refine filters (business type, cycle, domain, product, rate range).

### Changed (Session 2026-07-09)
- `csv_import_logs` gained `created_count`, `enriched_count`, `warning_rows` columns (schema.sql + Prisma; applied via `db push`).
- `import result` in the Import-from-Zoho wizard now reports `created / enriched / skipped`.

### Added (Session 2026-07-08)

#### Domain Mapping page redesign (`/dashboard/domains`)
- New client table `domains/_components/domains-table.tsx`: click-to-expand rows revealing "Linked Subscriptions" (Sub # / Item / Qty / End Date / Status / Last Invoice·Quote / **Last Doc Status**), wireframe theme, status pills.
- Filter bar: search + **All Organizations** dropdown + **All Statuses** dropdown + **Export CSV**; four stat cards (Total / Active / Suspended / Inactive).
- Sub # links to the subscription page; customer sub-line is an **"Open in Zoho Books"** link; invoice/quote numbers are Zoho deep links.
- Backend `domains.service.ts`: `list()` gained a `status` filter, inline `subscriptions`, `activeSubsCount` (Active + Expiring_Soon), and a `stats` block; new `exportCsv()`. Org select now includes `zohoOrgId` + `dataCenter`.
- **`GET /api/domains/export-csv`** (new endpoint, registered before `@Get(':id')`); `GET /api/domains` gained a `status` query param.

#### Subscription detail page redesign (`/dashboard/subscriptions/[id]`)
- **Edit button + modal** (`_components/edit-subscription-modal.tsx`): Billing Cycle, Price, Renewal Price, Start/End Date, Auto Renew (Item read-only).
- **Renewal History timeline**: colored status dots + `Quote# → Invoice# → Status (Paid/Unpaid/Overdue)`, Zoho deep links, per-row actions.
- `proforma-actions.tsx`: dual-mode compose modal (Quote **and** Tax Invoice), **Resend Tax Invoice** action once converted, and an animated circular-arrow **Refresh/sync** icon.
- Renewal & Pro-rata widgets: **Notes fields removed**; Renewal widget defaults to the **Renewal Price**.
- **`zohoInvoiceStatus`** column added to `RenewalHistory`; `refreshProformaStatus` now syncs estimate → invoice → payment and persists status + invoice/payment refs.
- **`GET /api/subscriptions/renewal-history/:historyId/invoice-email-preview`** and **`POST /api/subscriptions/renewal-history/:historyId/send-invoice`** (new endpoints).
- `billingCycle` added to `UpdateSubscriptionDto`; `findOne` org select includes `dataCenter`.

#### Customer detail page update (`/dashboard/customers/[zohoId]`)
- Header: `ORG: {ORG NAME}` eyebrow (uppercase), **external-link icon** on the company name ("Open in Zoho Books"), email + phone with icons, **Zoho Customer Number** badge (from `contact_number`), support-status badge moved into the header.
- Profile: **primary contact person**, **Portal Status** (replaces Support Status), **Billing Address incl. Country**.
- Backend `getCustomerDetail` now fetches the **full Zoho contact** live and merges it into `customer.extra`.

#### Sidebar (`dashboard/layout.tsx`)
- Removed the Subscriptions sub-menu ("Create New", "Import from Zoho"); added a `NavItem` type.
- Reordered nav: Dashboard → Leads → Quick Quotes → Customers → Subscriptions → Domains → User Access (Settings pinned below the divider).

### Changed (Session 2026-07-08)
- All Zoho Books deep links now use `https://books.zoho.{tld}/app/{zohoOrgId}#/{entity}/{id}` (TLD from the org `dataCenter`).
- `schema.sql`: backfilled `zoho_estimate_status` + `sent_at` columns on `renewal_history` (doc drift) alongside the new `zoho_invoice_status`.

### Fixed (Session 2026-07-08)
- **Zoho deep links 404'd** — links omitted the org id and hardcoded `.in`; now built correctly (BUG-006).
- **Subscription detail 404** after adding `zohoInvoiceStatus` — the new column was missing in the DB; applied via `prisma db push --skip-generate` (BUG-007).
- **Web typecheck** — typed `api.post` in `subscriptions-table.tsx`, clearing two pre-existing `TS18046` errors; web now builds clean (BUG-008).

### Added (Session 2026-07-01 — Earlier)

#### Renewal Batch History Feature (End-to-End)
- **New page `/dashboard/subscriptions/renewal-batches`** (`apps/web/src/app/dashboard/subscriptions/renewal-batches/page.tsx`): Server Component showing all past bulk renewal runs. Columns: Date, Customer, Item, Billing Cycle, Domains, Unit Price, Total Amount, Zoho Estimate Number, Annexure badge, Actions. Includes summary stats, search filter, and pagination.
- **"View Subscriptions (N) →" action per batch**: Navigates to `/dashboard/subscriptions?ids=<csv-of-ids>`, pre-selecting all subscriptions from that batch for immediate re-renewal.
- **Annexure badge**: Shows "📎 PDF" badge on batch rows where `hasAnnexure === true` (≥100 domains).
- **`GET /api/subscriptions/renewal-batches`** (new endpoint): Returns `{ batches, total, page, limit }` with `subscriptionIds[]` per batch (from nested `renewalHistories` include). Supports `page`, `limit`, `search` query params. Placed before `@Get(':id')` per route-ordering rule.
- **`GET /api/subscriptions?ids=<csv>`** (new param): Added `ids?: string[]` filter to existing list endpoint; passes comma-separated subscription IDs through to `where.id = { in: ids }`.
- **`initialSelectedIds` prop on `SubscriptionsTable`**: Pre-checks checkboxes on render when navigating from batch history, enabling one-click "Generate Bulk Quotes" without re-selection.
- **Batch filter banner on subscriptions page**: Purple banner shown when `?ids=` param is active, indicating filtered/pre-selected state. Single "×" dismiss button.
- **"📦 Batch History" button** in subscriptions page header linking to the new batch history page.

#### UI Fixes
- **Customer detail page** (`customers/[zohoId]/page.tsx`): Static "ZOHO CUSTOMER" eyebrow label replaced with dynamic `{orgName} Customer` (e.g., "Excel Cloud AI Customer"). Org name fetched in parallel from `GET /organizations`.
- **Quick-quotes list** (`quick-quotes/page.tsx`): "Zoho Customer" type badge under customer name replaced with `{orgName} Customer`.
- **Subscriptions batch banner dismiss**: "Clear filter ×" simplified to "×" (removed redundant text).

### Added (Session 2026-07-01 — Earlier)
- **`renewal_batches` in `schema.sql`**: Backfilled the table definition that existed only in Prisma schema. Added CREATE TABLE, `bulk_renewal_batch_id` FK + `ON DELETE SET NULL` on `renewal_history`, 3 new indexes, updated section numbering (4.8) and footer.
- **Section 14 wireframe** in `04_UI_WIREFRAMES.html`: "Renewal Batches History" screen with stats cards, filter bar, 12-column table, expandable domain preview, legend, and empty state.
- **CSV Import Audit Logging**: `CsvImportLog` / `csv_import_logs` table persisting every import run. Added `GET /import-logs`, `GET /import-logs/:logId`, `GET /import-logs/:logId/errors-csv` endpoints. Frontend replaced truncated `alert()` with inline non-truncated panel + "Download report" link.

### Changed (Session 2026-07-01 — Latest)
- `SubscriptionsTable` component signature extended with optional `initialSelectedIds?: string[]` prop (backward compatible — defaults to `[]`).
- Subscriptions page `searchParams` interface extended with `ids?: string` (backward compatible).

### Fixed (Session 2026-07-01 — Latest)
- Customer detail page Tailwind class typo: `tracking-widests` → removed (was an invalid class).
- Quick-quotes list showing generic "Zoho Customer" instead of actual organization name.

### Fixed (Earlier Sessions)
- `api-client` import path in frontend components.
- Syntax error in `subscriptions/page.tsx` caused by a stray curly brace.
- `@Get('export-csv')` route ordering bug (was masked by `@Get(':id')`).
