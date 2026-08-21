# Task Tracker

## In Progress
- [ ] **In-app document PDFs — UAT (2026-07-18, typecheck-clean, not live-run).**
  - [ ] **View PDF** — open a Zoho quote & invoice PDF from all 4 surfaces (Quotes & Invoices browser, Renewal Batch review, Subscription-detail renewal history, converted-invoice "📄 Invoice PDF"); confirm it opens in a new tab, re-open is instant (DB cache), and after an accept/invoice/payment webhook the PDF refreshes.
  - [ ] **Quote email attachment** — send a quick-quote via SendGrid with a recipient; confirm `{quoteNumber}.pdf` is attached and its layout is correct.
  - [ ] **Branding** — with a **PNG/JPG** logo + signature uploaded (Settings → PDF Branding): confirm both appear on the attached quote PDF **and** on `/quotes/[id]/print`. Note: an **SVG/WebP** logo will NOT appear in the generated PDF (pdf-lib limit) but WILL on the print page — recommend PNG/JPG for the PDF.
- [ ] **Bulk-domains fresh-quote flow — remaining UAT (2026-07-16).** ✅ Core flow **live-verified by the user**: bulk-domains quote (2 items × 3 domains, per-domain qty) → Accept → Convert → invoice INV-000048 (aggregated lines, domains in description) → subscriptions auto-created. Still to verify live: (a) a **≥100-domain line** → Technical Annexure PDF attaches to the invoice; (b) **"बाद में"** decision → post-convert "🚀 Create N Subscriptions" button + **re-running it** (should enrich/skip, never duplicate); (c) email/public/print compact display of a bulk line.
- [ ] **Live-Zoho UAT of the per-customer "Generate Bulk Quotes" grouping (2026-07-16)** — re-select the 6 Demo Company subscriptions (2 items × 3 domains, same cycle/dates) → Generate Bulk Quotes → expect **ONE estimate with 2 lines** ("Combined (2 lines · 6 domains)" row in Batch review); also delete the two stale drafts QT-000086/87 in Zoho from the pre-fix run. A uniform selection (single item+rate) should still produce the old single-line estimate. **Typecheck-clean only — not run against live Zoho.**
- [ ] **UAT of Quick Quote email send + per-org senders (2026-07-15/16, SendGrid)** — (1) ✅ basic send verified live via Gmail (SendGrid works); (2) confirm the **final email format**: PDF-like white sheet (org header, BILL TO, `# | Item | Qty | Rate | Amount`, totals, T&C), **NO links/buttons in the mail** (user decision — accept is manual in the app), domains/emails NOT auto-linked, `Domain Name:` / `Subscription Period:` labelled lines; (3) set an org's **Sender Email Config** (SendGrid-verified From) and confirm the mail goes **From that org's address** with the org's Display Name; (4) save an **Email Signature** (HTML) on that org and confirm it renders below the sheet; (5) **↩ Resend** on a Sent quote re-emails with the same public link (validity refreshed); (6) **Undo Accept** cycle (Accepted → Sent/Draft, lead Won → Quoted); (7) **public page via Copy Link**: Accept confirm + Decline-with-reason work (`Rejected` + lead `Lost`); (8) **subscription decision at Convert** — `create_now` auto-opens the Subscription page, `later` keeps the Create Subscription button, `never` hides it and the undo link brings it back. All typecheck-clean; only (1) driven live so far.
- [ ] **Live-Zoho UAT of the 2026-07-15 sales-flow pass** (all typecheck-clean, not yet run against live Zoho):
  - [ ] **Customers browser** (`/dashboard/customers`) — fetch rows, customize columns (incl. app-aggregate Active Subs / Domains Mapped / Last Quote #/date / Last Invoice #/date), save/load/delete a private view, sort, Export CSV.
  - [ ] **Quick Quote Unified Builder** — New-Customer mode creates **one Lead + one Quote** in the in-form-chosen Organization and flips the lead to **Quoted** (stays Draft, no auto-send); Existing-Customer mode still creates a Type-2 quote; edit-draft still locks the customer.
  - [ ] **Convert/Push domain + dates** — Domain + Service Start required at convert; End auto-computes from the period and is editable; the Zoho invoice line carries domain/start/end.
  - [ ] **Dashboard grouping** — a customer with multiple expiring/expired subs shows as one group with the "N subscriptions" badge.
- [ ] **Live-Zoho UAT of the Batch review screen (send + track)** — Subscriptions → select → Generate Bulk Quotes → lands on `/dashboard/subscriptions/renewal-batches?ids=…`. Confirm: **Send Selected / Send All** email the estimates via Zoho's default template; per-row **✉ Send** compose modal edits To/CC/subject/body and sends; **Refresh / Refresh All** sync live status (Draft/Sent/Accepted/Declined/Invoiced/Paid); estimate # opens the `#/quotes/` deep link. **Typecheck-clean only — not run against live Zoho.**
- [ ] **Live-Zoho UAT of the Quotes & Invoices browser** (`/dashboard/documents`) — fetch quotes/invoices for a live org; verify the dynamic column catalog (standard + org custom fields + cross-linked Invoice#/Date/Status/Payment for quotes, Quote#/Date/Status/Payment for invoices); Customize Columns pick+reorder; Save/Load/Delete a private view; Export CSV; `#/quotes/` deep links. **Typecheck-clean only — not run against live Zoho.**
- [ ] **Live-Zoho UAT of the Combined Quote flow** (customer page → Combined Quote → select → generate). Confirm: single multi-line estimate; subs with same item+dates+rate merged into one line with `domain (qty)` description; header custom fields taken from the nearest-renewal/expired sub; a ≥100-domain line shows the annexure summary + a PDF (with Qty column) attaches. **Typecheck-clean only — never run against live Zoho yet.**
- [ ] **UAT the customer-page "+ New Subscription" (customer-context, `mode=manual`)** — confirm org + customer come pre-filled & locked and a subscription saves for that customer.
- [ ] **Re-run Generate Bulk Quotes in the running app** and confirm QT-0000xx now has all fields populated (header Domain Name / Subs Period / Service Expiry + line-item Domain/Start/End/Cost; description in DD/MM/YYYY). Payload was verified live via replay, but not yet driven through the app UI by the user after the fix.
- [ ] **Manual UAT of the import feature in the running app** (Import-from-Zoho: Quotes source + filters + enrich; Import CSV page) against a live Zoho-connected org. Backend is verified against the dev DB, but not driven through the app's own Zoho OAuth yet.
- [ ] UAT of the three redesigned pages (Domain Mapping, Subscription detail, Customer detail) against real Zoho data.

## Pending (To Do)

### Multi-currency Phase 2
- [ ] Add **Country + Currency** to the standalone **Lead create form** (`/dashboard/leads/new`) + a **`currency` column on `leads`**. NOTE (2026-07-15): `CreateLeadDto` + `leads.service.create` **now accept `country`**, and the **Quick Quote Unified Builder** already collects Country when creating a lead; still missing = the standalone lead form's Country/Currency inputs and the `leads.currency` column.
- [x] ~~Replace hardcoded `₹` in the **subscriptions list table**~~ — DONE 2026-07-11 (`money()` + symbol map).
- [ ] Replace hardcoded `₹` in the **Export CSV** and the **PDF / quote builder** (reuse the `money()` + symbol-map approach from the subscription detail page). Still outstanding.
- [ ] Make **dashboard "total value"** currency-aware (group per-currency, or sum the INR-equivalent = amount × exchange_rate). NOTE: the bulk-quote success alert no longer prints a misleading `₹` total, but the dashboard totals are still INR-labelled.

### Other
- [ ] (PERF_PLAN follow-ups, deferred by decision 2026-07-14) **Delta sync** (`syncCustomers`/`syncItems` via Zoho `last_modified_time`) — needs live verification of Zoho's timestamp format (wrong format silently drops records). **Web-layer read caching** (`apps/web/src/lib/api.ts` is global `no-store`). **Webhook queue** (processing is synchronous / MVP). **DB-backed doc cache** (upgrade the in-memory `docCache` to reuse `zoho_cache`, shared across instances).
- [ ] (Optional) **Quotes & Invoices browser — Customer filter.** The filter bar deliberately omits a Customer picker (there's no cached customers-list endpoint yet; `GET /organizations/:id/customers/:zohoId` is detail-only). Add a customers-list/search endpoint + a searchable Customer select, passed through as `customer_id`.
- [x] ~~(Optional) **Quotes & Invoices browser** … **1 detail call per row** … Consider caching~~ — DONE 2026-07-14 (PERF_PLAN #1/#2: short-TTL doc-detail cache + local-first cross-link). See CHANGELOG.
- [ ] Setup production deployment pipelines (CI/CD).
- [ ] Finalize environment variables for Production (Database, Zoho OAuth, etc.).
- [ ] (Optional) Move the DB workflow from `prisma db push` to committed migrations before production, so schema history is auditable.
- [x] ~~(Optional) Consider caching / debouncing the live full-contact fetch on the customer detail page~~ — DONE 2026-07-14 (PERF_PLAN #5: `getCustomerDetail` TTL-gated, 6h, persists to `zoho_cache`).
- [ ] (Optional) Import wizard fetches ≤50 docs then post-filters (business type / expiry) in-app — matching rows beyond 50 can be missed. Consider server-side narrowing or pagination if large fetches are common.
- [ ] (Optional) **Combined Quote — multiple ≥100-domain lines** attach multiple annexure PDFs to the one estimate (one per large line). Assumed OK (Zoho multi-attachment); confirm Zoho doesn't cap/replace attachments if this case arises. Rare in practice.
- [ ] (Optional) **Combined Quote RenewalBatch scalar columns** (`unitPrice`, `zohoItemId`, `billingCycle`) hold representative/header values only — the Batch History row for a combined batch shows those, not a true aggregate. If combined batches become common, consider a dedicated display path reading `annexureData`.

## Operational Notes (not bugs)
- Before importing (CSV **or** Zoho) for an org, its **customers AND items** must be synced into `zoho_cache` (Settings → Organizations → **Sync**). Items-not-synced surfaces as "Item … not found in Zoho cache".

## Blocked
- None

## Completed

### Session 2026-07-18 (in-app document PDFs)
- [x] **View PDF (DB-cached Zoho estimate/invoice PDF)** — `zoho_document_pdf` table (`db push`); `ZohoApiClient.getBinary`; `ZohoService.getDocumentPdf`/`invalidateDocPdf`; `GET /organizations/:id/documents/:kind/:docId/pdf`; webhook invalidation; reusable `ViewPdfButton`; wired into Quotes & Invoices browser, Renewal Batch review, Subscription-detail history, converted-invoice actions.
- [x] **Quote PDF attached to quick-quote SendGrid email** — `EmailService.send` attachments + `QuickQuotesService.buildQuotePdf` (pdf-lib); Zoho-sent emails left as-is (native attach).
- [x] **PDF Branding (logo + signature)** embedded in `buildQuotePdf` (PNG/JPEG) and rendered on `/quotes/[id]/print` (via `GET /org-settings/:orgId`).
- Both apps typecheck-clean (exit 0). **Not yet run against live Zoho/SendGrid.**

### Session 2026-07-16 (convert flow + bulk-domains fresh sales — same continuous session as 07-15 Part 2)
- [x] **Subscription decision at Convert** — radio (create_now/later/never) in the Convert form; `quick_quotes.subscription_decision` via `db push`; both convert paths persist; `POST /conversions/quote/:quoteId/subscription-decision` for post-convert changes; redirects fire only on `create_now`.
- [x] **"🧾 Create Invoice" for already-in-Zoho customers** — `convertExistingCustomerQuote` accepts lead-quotes via `lead.convertedToZohoCustomerId`; mode-aware labels; org-mismatch guard (BUG-017) + builder customer-first cross-org picker (org auto-locks); Convert form → popup modal.
- [x] **Bulk-domains fresh quotes (Option A)** — `quick_quote_items.domain_list` JSONB; builder textarea (`domain[, qty]`); compact display (app/email/public/print); convert = one aggregated line + ≥100 annexure on the invoice; `POST /subscriptions/bulk-create-from-quote` (one sub per domain via `applyImportItem`, `originQuickQuoteId` stamped); ✅ **core flow live-verified** (INV-000048 + subscriptions).
- [x] **"Generate Bulk Quotes" grouped per customer** — mixed items → one multi-line estimate via `combinedRenewalQuote` delegation; uniform groups unchanged.
- [x] **Undo Accept** — `POST /quick-quotes/:id/unaccept` + amber button (Accepted-only); accept flows no longer downgrade `Converted` leads (BUG-019) + lead page `isConverted` from durable field; 3 leads data-fixed.
- [x] **Converted-invoice email through the shared compose modal** — invoice-email-preview endpoint + `EmailInvoiceDto` override.
- [x] **Optional Domain column on quote items** (prefills Convert); **BUG-018** redirect race fixed (direct submit handler); lead page Convert panel hidden until an accepted quote exists.

### Session 2026-07-15 — Part 2 (Quick Quote email via SendGrid + per-org senders — typecheck-clean, **not** live-tested)
- [x] **Quick Quote send emails the quote** — `send()` persists token+Sent then `sendFromTemplate('quote_sent', …)` with absolute `WEB_BASE_URL` public link + currency-aware total; email only when `recipient_email` given; response gains `emailSent`/`emailTo`/`emailError`. `QuickQuotesModule` imports `EmailModule`.
- [x] **Compose modal** — `quote-actions.tsx` Send button opens To-prefilled modal (lead email threaded via `QuoteActionBar` from `[id]/page.tsx`); link-only fallback; green/amber/red result states.
- [x] **Per-org sender resolution** — `EmailService.send()/sendFromTemplate()/sendTestEmail()` accept `organizationId`; `org_settings.emailFromAddress`/`emailReplyTo` (+ Display Name as From name) override the global sender; quick-quote send + scheduler reminders pass the org. The Settings → Organizations "📧 Sender Email Config" values are now actually used.
- [x] **SMTP built then removed same-session** (user decision — SendGrid only): nodemailer uninstalled, provider/smtp settings + UI reverted; Email Configuration labels now "Default From…" + per-org pointer.
- [x] **Per-org email signature** — `EmailService.send()` appends `org_settings.emailSignatureHtml` (when set) to the HTML body + text fallback; new signature textarea in `org-email-config.tsx` (saved via existing `PUT /org-settings/:orgId`); `Organization.orgSettings` type in `apps/web/src/lib/api.ts` gained the field.

### Session 2026-07-15 — Part 1 (sales-flow UX pass — typecheck-clean, **not** live-verified)
- [x] **BUG-014** — Subscriptions "Expiring in N days" filter returned empty. `findAll`/`countByStatus` used invalid enum literal `'ExpiringSoon'`; corrected to `'Expiring_Soon'` (both occurrences) in `subscriptions.service.ts`.
- [x] **Customizable Customers list-view** (`/dashboard/customers`).
  - [x] New `customers` API module: `GET /organizations/:id/customer-columns` (dynamic catalog), `GET /organizations/:id/customer-rows` (paginated + search), `GET/POST/DELETE /customer-views` (per-user, `user_preferences` key `zoho_customer_views`). Registered `CustomersModule` in `app.module.ts`.
  - [x] Dynamic catalog = cached `extra` scalar fields + customer custom fields + **app-aggregate** columns (`active_subscriptions`, `domains_mapped`, `last_quote_number`/`last_quote_date`, `last_invoice_number`/`last_invoice_date`) via batched `groupBy` + reduce-latest.
  - [x] `customize-columns-modal.tsx` moved to `apps/web/src/components/` + genericized (`CustomizableColumn`, `group: standard|custom|app`); documents browser updated to import the shared copy. New `customers-browser.tsx`; `customers/page.tsx` is a thin shell.
- [x] **Domain + Service dates moved out of the Quote form → Convert/Push step.**
  - [x] Quote line items keep only the **Subs./Service Period** selector; Domain + Service Start collected at convert; End auto-computed from period (`addCycle`), editable on the subscription page.
  - [x] Backend: `TriggerConversionDto` + new `ConvertQuoteDto` (`domainName`, `serviceStartDate`); `conversions.service` `buildInvoiceLineItems`, `triggerConversion`, `convertExistingCustomerQuote`, subscription prefill + `getPostConvertInfo`. `CreateLeadDto` + `leads.service.create` gained `country`.
  - [x] Frontend: new `conversion-details-fields.tsx` wired into `convert-lead-panel.tsx` + `convert-from-quote-button.tsx`; `quote-action-bar.tsx` / `[id]/page.tsx` / `leads/[id]/page.tsx` thread `defaultDomain`; both `actions.ts` thread `domain_name` + `service_start_date`.
- [x] **Quick Quote redesigned — "Unified Builder"** (`quote-builder.tsx`) + **Lead+Quote in one submit.**
  - [x] Two-mode customer cards (New Customer/Lead default+left, Existing right); progressive New-Customer form (Company\*/Contact/Email\*/Phone/State\*/Country\* + "More Details": Billing Address L1/2/3 · GSTIN/City/Postal); merged Quote Details + Items (Item Details | Subs. Period | Qty | Rate | Amount; Cost Price removed); 3-column Notes/Terms/Internal-Notes; gradient totals card (CGST/SGST split).
  - [x] Client-orchestrated unified create (`flushSync` + `requestSubmit`): New-Customer mode POSTs `/leads` then submits the quote; **Organization chosen in-form** (dropdown for new lead; locked when existing lead attached / editing). `quick-quotes.service.create` flips linked lead `New/Contacted`→**`Quoted`** (Draft, no auto-send).
- [x] **Dashboard Subscription Alerts grouped by customer** — `groupByCustomer` helper; Expiring + Expired blocks show customer once + "N subscriptions" badge + per-domain rows (still clickable). `apps/web/src/app/dashboard/page.tsx`.

### Session 2026-07-14
- [x] **Performance — Zoho-API-call reduction** (implements `PERF_PLAN.md`; backend-only, no behaviour change). #1 short-TTL doc-detail cache (`getDocDetailCached`), #2 cross-link columns local-first (from `renewal_history`), #3 webhook cache invalidation, #4 in-memory token cache, #5 `getCustomerDetail` TTL (6h) + persist, #6 org-meta memo (`getOrgMeta`) + Bottleneck 5→8. Files: `zoho.service.ts`, `zoho-api.client.ts`, `webhook.service.ts`, `documents.service.ts`. ⚠️ **Verified by inspection only — `tsc` not run (sandbox mount glitch); run `pnpm typecheck` + live-Zoho check the documents browser.** See CHANGELOG.
- [x] **Quote deep-link fix** — estimate deep links now use the Zoho web route `#/quotes/{id}` (was `#/estimates/{id}` → "Page Not Found"). Both builders (`zohoUrl`, `zohoBooksUrl`) map `estimates`→`quotes` in the path only; REST API entity stays `estimates`. Verified in the browser (auto-redirects to the org custom domain).
- [x] **Post-"Generate Bulk Quotes" workflow — Batch review screen** (typecheck-clean; **not** live-verified).
  - [x] Generate Bulk Quotes now returns `batchIds` and **navigates** to `/dashboard/subscriptions/renewal-batches?ids=…` with a "review & send" banner (was a dead-end `alert()`).
  - [x] Renewal Batch History upgraded to an **actionable review screen** — Status column, checkboxes, **Send Selected / Send All** (Zoho default template), per-row **✉ Send** (compose modal), per-row + **Refresh All** (status sync), estimate # as `#/quotes/` deep link.
  - [x] New endpoints: `POST /renewal-batches/:batchId/send` (with/without compose override), `POST /renewal-batches/:batchId/refresh`, `GET /renewal-batches/:batchId/email-preview`. `listRenewalBatches` gained `ids` filter + derived `status` + org relation.
  - [x] Generalized the per-row compose modal into a shared `SendEmailModal` (`apps/web/src/components/send-email-modal.tsx`); subscription-detail + batch flows both reuse it.
- [x] **Quotes & Invoices browser** — new read-only page `/dashboard/documents` + sidebar item (typecheck-clean; **not** live-verified).
  - [x] New `documents` API module: `GET /organizations/:id/documents` (filtered + paginated live fetch), `GET /organizations/:id/document-columns` (catalog), `GET/POST/DELETE /document-views` (per-user).
  - [x] Dynamic column catalog: standard + org custom fields + cross-linked columns (Quotes→Invoice#/Date/Status/Payment; Invoices→Quote#/Date/Status/Payment).
  - [x] Customize Columns modal (pick + reorder), private per-user saved views (`user_preferences` key `zoho_document_views`), CSV export, Next/Prev pagination, `#/quotes/` deep links.

### Session 2026-07-11 — Part 2
- [x] **Combined Quote feature** — one multi-line Zoho estimate per customer across mixed items/dates. (Typecheck-clean; **not** live-verified.)
  - [x] `POST /api/subscriptions/combined-renewal-quote` + `combinedRenewalQuote()`; `CombinedRenewalQuoteDto`. Same-org+customer validation; only renewable (Active/Expiring_Soon/Expired) subs quoted.
  - [x] Line merge by **item + renewal start/end + rate**; domains listed as `domain.com (qty)` in the line description; line qty = Σ domain qty. Different rate → separate line.
  - [x] Header custom fields from the **nearest-renewal / most-overdue** sub (earliest endDate) — user decision.
  - [x] **Per-line ≥100 domains** → summary description + Technical Annexure PDF (with Qty column + item/period subtitle). `AnnexureService.generateAndUploadAnnexure` gained optional `opts` (subtitle/fileLabel) + optional `quantity` per domain — backward-compatible with the bulk caller.
  - [x] One `RenewalBatch` links all subs' `renewal_history` (one row per domain) to the single estimate; per-domain breakdown in `annexureData`.
  - [x] Customer page: new `customer-subscriptions.tsx` client component — **+ New Subscription** + **Combined Quote** header buttons; selection mode; result banner.
  - [x] New-subscription form `mode=manual` — customer/org pre-filled & locked, item/domain/dates manual.
- [x] **Renewal Batch History: domain search** — `listRenewalBatches` search matches domain names; response adds `matchedDomains[]`; page placeholder + green matched-domain badges.
- [x] **Subscriptions list "Subs. Period" column** — header "End Date" → "Subs. Period"; cell shows `start → end` + `N days`.

### Session 2026-07-11 — Part 1
- [x] **Fixed Generate Bulk Quotes** (was 400-failing on every run and mis-reporting success).
  - [x] Root cause: hardcoded `{ label: 'Business Type', … }` custom field — this org's label is **"Business Type?"** → Zoho 400 (code 120129). Replaced with org-aware `buildCustomFields()` + `getBusinessTypeLabel()` / `getBillingOptions()`.
  - [x] `buildCustomFields` now keys by **`api_name`** for all modules **except `contacts`** (was `index`). `index` silently stores **0** for number fields (`cf_total_licences`); verified live.
  - [x] Silent-success fixed: endpoint returns `createdCount`/`failedCount`/`estimateNumbers`/`errors`; table surfaces real Zoho errors; dropped misleading `₹` total.
  - [x] Field population: header **Domain Name** + **Service Expiry**; line-item **Domain/Start/End/Cost**; **Subs Period** static fallback (metadata-independent); Domain Name = "first +N more"; description dates **DD/MM/YYYY**.
  - [x] Verified end-to-end against **live Zoho** (create → inspect all fields → delete).
- [x] **Multi-currency Phase 2 (start):** subscriptions **list table** price column is now currency-aware (`money()` + symbol map); USD rows show `$1.65`. See [[multi-currency-design]].

### Session 2026-07-10
- [x] **Import-from-Zoho: Quotes source + filters (Track C completion)** — `GET /api/organizations/:id/estimates-preview`; Document Source selector, Business Type + Service Expiry From/To filters (in-app post-filter), source-aware status options. Estimate import **status-gated** (create only if Accepted/Invoiced, else link-as-history; quote-only history → `renewalStatus=Quoted`, dedup by quoteId). Verified vs real DB.
- [x] **Multi-currency Phase 1** — `currency` + `exchange_rate` on `subscriptions` + `renewal_history` (schema.sql + Prisma + `db push`). Convention: currency/rate = selling side, cost always base INR. Both importers capture currency; CSV **rejects** currency-vs-customer mismatch. Subscription detail page shows Price/Renewal in customer currency (`money()` helper); customer detail shows Currency + Country. Verified vs real DB (USD row, mismatch rejection, estimate gating). See [[multi-currency-design]].

### Session 2026-07-09
- [x] **Subscription import & history linking** — full spec + implementation notes in [PLAN_CSV_SUBSCRIPTION_IMPORT.md](PLAN_CSV_SUBSCRIPTION_IMPORT.md). Verified against real DB + live Zoho; API + web typecheck clean.
  - [x] **Schema** — `csv_import_logs` gained `created_count`, `enriched_count`, `warning_rows` (schema.sql + Prisma + `db push`).
  - [x] **Shared core** — refactored `importGrouped` → `applyImportItem`; **enrich-existing** (attach missing history, refresh last-invoice, never duplicate) + idempotent `backfillHistory` (dedup by invoiceId).
  - [x] **Track B.2** — link originating **quotes** into history via `invoice.estimate_id` (resolved in `fetchInvoicesForImport`; persisted `quoteId/quoteNumber/quoteDate/zohoEstimateStatus`).
  - [x] **Track A** — `importCreateCsv` + `POST /api/subscriptions/import-create-csv`; resolves Customer Number/Item(SKU→Name)/Org, 3-bucket result (created/enriched/warnings/errors), lifecycle computed from dates; new web page `subscriptions/import-csv` (sample CSV + instructions + warnings/errors CSV).
  - [x] **Track C** — wizard filters: `reference_number`/`customer_id` server passthrough + instant client-side refine (business type, cycle, domain, product, rate range). (Server-side custom-field filtering intentionally skipped — see plan §C note.)

### Session 2026-07-08 (This Session)
- [x] **Domain Mapping page redesign** — new interactive table (`domains/_components/domains-table.tsx`), wireframe theme, org/status filters, stat cards, CSV export, expandable Linked Subscriptions, Zoho deep links, "Last Doc Status" column, subscription-number links.
- [x] **Backend domains** — `status` filter, inline subscriptions, `activeSubsCount`, `stats` block on `list()`; new `GET /api/domains/export-csv`; org select includes `zohoOrgId` + `dataCenter`.
- [x] **Subscription detail page redesign** — Edit button/modal (Billing Cycle, Price, Renewal Price, Start/End Date, Auto Renew; Item read-only); Renewal History timeline (Quote → Invoice → Status); Resend Quote / Resend Tax Invoice / animated Refresh; removed Notes from Renewal & Pro-rata widgets; Renewal defaults to Renewal Price.
- [x] **Backend subscriptions** — `zohoInvoiceStatus` field added; `refreshProformaStatus` syncs estimate → invoice → payment + persists; `getInvoiceEmailPreview()` + `sendInvoice()` methods and endpoints; `billingCycle` in `UpdateSubscriptionDto`; `findOne` org select includes `dataCenter`.
- [x] **Customer detail page** — `ORG:` eyebrow, external-link icon (Open in Zoho Books), email+phone icons, Zoho Customer Number badge, header support-status badge; Profile now shows primary contact person, Portal Status (replaces Support Status), Billing Address incl. Country.
- [x] **Backend customer** — `getCustomerDetail` fetches the full Zoho contact live and merges into `customer.extra` (billing_address, contact_persons, portal_status, contact_number).
- [x] **Zoho Books deep links fixed** — correct `/app/{zohoOrgId}#/{entity}/{id}` + data-center TLD across domains, customer, and subscription-history links.
- [x] **Sidebar** — removed Subscriptions sub-menu; reordered nav (Dashboard, Leads, Quick Quotes, Customers, Subscriptions, Domains, User Access); added `NavItem` type.
- [x] **Build fix** — typed `api.post` in `subscriptions-table.tsx`; web app now typechecks with zero errors.
- [x] **DB** — added `zoho_invoice_status` column via `prisma db push`; backfilled `zoho_estimate_status`/`sent_at` doc drift in `schema.sql`.

### Session 2026-07-01
- [x] Renewal Batch History page + backend endpoint + `?ids=` filter + pre-selection UX.
- [x] `renewal_batches` backfilled into `schema.sql`; Section 14 wireframe added.
- [x] CSV Import audit logging (`csv_import_logs`, import-logs endpoints, non-truncated UI panel).
- [x] UI label fixes (customer detail org name, quick-quotes badge, batch banner dismiss).

### Earlier Sessions
- [x] Phase 1: Database updates (added `RenewalBatch` to Prisma schema).
- [x] Phase 2: Backend bulk logic (grouping, totals, Zoho Estimates).
- [x] Phase 3: PDF Generation & Zoho Attachment (`AnnexureService`, `multipart/form-data`).
- [x] Phase 4: Frontend UI (extracted `SubscriptionsTable`, bulk actions, checkboxes).
- [x] Phase 5: Bulk Subscription Status Management (CSV Export/Import, Bulk Cancel, Bulk Paste Domain List).
- [x] Fixed `export-csv` route ordering bug.
