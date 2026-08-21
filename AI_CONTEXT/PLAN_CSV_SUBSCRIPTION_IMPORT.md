# Plan — Subscription Import & History Linking

**Status:** ✅ IMPLEMENTED (2026-07-09) — all tracks shipped + verified against real DB/Zoho. Typechecks clean.
**Author:** AI session 2026-07-09
**Requested by:** hitesh@anutech.in
**Scope:** Three tracks —
  - **Track A** ✅ — full CSV bulk-**create** importer (from an Excel export)
  - **Track B** ✅ — extend the existing **Import-from-Zoho** feature: enrich already-existing subscriptions + link old **quotes** (not just invoices) into renewal history
  - **Track C** ✅ — flexible wizard filters

### Implementation notes (what actually shipped)
- **Schema:** `csv_import_logs` gained `created_count`, `enriched_count`, `warning_rows` (schema.sql + Prisma + `db push`).
- **Shared core:** `importGrouped` → `applyImportItem` core; enrich-existing (no duplicate) + idempotent `backfillHistory` (dedup by invoiceId).
- **Track B.2:** quote fields resolved via `invoice.estimate_id` in `fetchInvoicesForImport`, persisted in history (`quoteId/quoteNumber/quoteDate/zohoEstimateStatus`).
- **Track A:** `importCreateCsv` + `POST /api/subscriptions/import-create-csv`; new web page `subscriptions/import-csv` (sample CSV, instructions, 3-bucket result).
- **Track C — deviation from §C plan:** server-side custom-field filtering was NOT used (raw Zoho `/invoices` custom-field query syntax is unreliable — the §C.2 caveat). Instead: reliable params (`customer_id`, `reference_number`, status, dates) narrow the server fetch; **business type / cycle / domain / product / rate-range** are **instant client-side refine filters** over the parsed candidates. Same user outcome, no API-syntax risk. Server-side cf filters can be revisited if ever needed.

---

## 0. Context — what already exists (don't rebuild)

- **`importGrouped`** ([subscriptions.service.ts#L634](../apps/api/src/subscriptions/subscriptions.service.ts#L634)) already: resolves/auto-creates domains, dedups by natural key (org+customer+item+domain), creates the subscription at its latest term as `Active`, and **backfills `renewal_history` from every past invoice** (Business Type, invoice #/date, service dates, qty, price; `renewalStatus: 'Paid'`).
- **Import-from-Zoho page** ([subscriptions/import/page.tsx](../apps/web/src/app/dashboard/subscriptions/import/page.tsx)) fetches invoices via `GET /organizations/:id/invoices-preview`, reads **line-item custom fields** (Domain/Start/End/Cost) using the org's `item_field_mappings`, groups multi-year invoices per subscription, detects duplicates + billing cycle, and lets the user review/edit before import.
- **Update-only CSV** `POST /api/subscriptions/import-csv` ([service#L380](../apps/api/src/subscriptions/subscriptions.service.ts#L380)) matches by `ID` and only updates price/dates/status. **Leave untouched.**
- **`CsvImportLog`** already provides audit + an errors-CSV download loop.
- **Zoho invoices carry** Item Name, Domain Name, Start/End Date, Cost, Price — the last four as **custom fields** on invoice line items. Quotes/estimates carry similar fields and an invoice's `reference_number` often points at its originating estimate.

## 0b. SPIKE FINDINGS — Zoho estimate/invoice structure (verified 2026-07-09)

Ran against org **Excel Technologies** (`60007151873`) with real invoices + estimates.

**Where each field lives (do NOT assume — confirmed):**

| Data | Location | api_name |
|---|---|---|
| Domain Name | header **and** line item | `cf_domain_name` |
| Start Date | **line item** `item_custom_fields` | `cf_subscription_start_date` |
| End Date | **line item** `item_custom_fields` | `cf_subscription_end_date` |
| Cost Price | **line item** `item_custom_fields` | `cf_cost_price` |
| Service Expiry (≈ end) | header | `cf_next_invoice_date` |
| Business Type | header | `cf_new_business` (Renewal/Fresh/Transfer/Pro-rata) |
| Billing period | header — **invoice** `cf_subs_period`, **estimate** `cf_billing_period` ⚠️ different api_name |
| Quantity | line item `quantity` (estimate also has header `cf_total_licences`) |
| Price | line item `rate` |
| Item | line item `item_id` + `name` + `sku` |

- **Multi-line reality:** one invoice can hold several products for the *same* domain (e.g. Workspace + Hosting + Domain-Reg), each a distinct `item_id`/rate/cost. Current grouping `customer::domain::item` correctly yields one subscription per product (the UI's "amber duplicate" case is expected, not an error).
- **The current web importer's line-item field names are CORRECT** for this org (`cf_subscription_start_date/end/cost`). Good — no change needed there.
- **Quote→subscription linking is deterministic:** each invoice payload carries **`estimate_id`** pointing at its originating estimate. Follow it to populate `quoteId/quoteNumber/quoteDate`. `reference_number` (e.g. `"savengineer.in (12 Month Renewal)"`) is a human-readable fallback only.
- **Native Zoho filters available** on `list_invoices` / `list_estimates`: `custom_field` / `custom_field_contains` / `custom_field_startswith`, `customer_id`, `customer_name`, `item_id`, `item_name(+startswith/contains)`, `reference_number`, `date_start/end`, `status`, `filter_by` (incl. `Type.NewSubscription`), `last_modified_time`, `total` range. The wizard currently exposes only status + date range → big flexibility headroom (see Track C).

## 1. Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Price source (CSV) | **Price column in CSV** (row fails if missing/invalid) |
| Missing domain | **Auto-create** the domain, linked to the resolved customer |
| CSV vs Zoho role | **Build CSV fully AND extend Zoho import** (two complementary paths) |
| Existing-subscription behavior | **Enrich existing, never duplicate** — attach missing invoice/quote history + refresh last-invoice fields instead of skipping |

---

## TRACK A — Full CSV bulk-create importer

### A.1 Input CSV format

```
Customer Number | Domain Name | Item Name | Quantity | Price | Billing Cycle | Start Date | End Date
```
(+ optional `Cost`, `Organization`). Column semantics as in §A.3 table.

### A.2 Sample template + instructions (user point #1)

- **Downloadable sample CSV** on the import page — reuse the exact header names from `exportCsv` so export→edit→import round-trips cleanly.
- **Instructions popup/modal** on the page: required vs optional columns, accepted date formats (`DD-MM-YYYY`, `DD/MM/YYYY`, ISO), billing-cycle values, and the "sync Zoho first" prerequisite.

### A.3 Column mapping

| Column | Required | Maps to | Notes |
|---|---|---|---|
| Customer Number | ✅ | `zoho_customer_id` (resolved) | Zoho `contact_number`, stored in `zoho_cache.extra` (JSON lookup) |
| Domain Name | ✅ | `domain_id` (resolved / auto-created) | `domains.domain_name` is globally UNIQUE |
| Item ID / SKU | optional | `zoho_item_id` (resolved) | **preferred match key when present** — exact lookup on `zoho_cache.zohoId` (item_id) or item `sku` (e.g. `GWBS`) |
| Item Name | ✅* | `zoho_item_id` (resolved) | fallback match when Item ID/SKU absent — case-insensitive/trimmed vs `zoho_cache.displayName`. *Required only if no ID/SKU column. |
| Quantity | optional | `quantity` | default `1` |
| Price | ✅ | `subscription_price` | number ≥ 0 (DB CHECK `chk_sub_price_non_neg`) |
| Billing Cycle | ✅ | `billing_cycle` enum | friendly-value mapping (see §A.5) |
| Start Date | ✅ | `start_date` | reuse existing `parseDateString` |
| End Date | ✅ | `end_date` | same parser |
| Cost | optional | `cost_price` | default `0` |
| Organization | conditional | `organization_id` | only if >1 active org; else default the single org |

### A.4 Derived / defaulted fields

- `next_renewal_date` = End Date + 1 day (matches `importGrouped`).
- `lifecycle_status` = computed from dates: `Expired` if past, `Expiring_Soon` if ≤30d, else `Active`.
- `business_type` `Renewal`, `process_status` `None`, `auto_renew` false (defaults).
- `zoho_customer_name` / `zoho_item_name` snapshotted from the resolved cache rows.

### A.5 Billing-cycle mapping (case-insensitive)

`monthly` · `quarterly` · `half yearly|half-yearly|semi annual`→`half_yearly` · `annual|yearly|1 year`→`annual` · `biennial|2 years`→`biennial` · `triennial|3 years`→`triennial` · `one time|onetime|one-time`→`one_time`. Unrecognized → **error**.

### A.6 Three-bucket result: created / warnings / errors (user points #2, #3)

- **Errors (row rejected):** unresolved customer/item, unknown billing cycle, unparseable/`end<start` dates, missing required cell, domain owned by a different customer.
- **Warnings (row imported but flagged):**
  - **Billing-cycle discrepancy** — stated cycle ≠ cycle implied by the date span.
  - **Start/End date discrepancy** — span far from the cycle's nominal length (e.g. "annual" but 400 days), or term overlaps an existing subscription's term for that domain.
  - **Duplicate** — natural-key match to an existing subscription (routed to enrich, see §A.7) or a duplicate row within the same CSV.
- **Created:** clean rows.
- Persist all three to `csv_import_logs`; extend the errors-CSV download to a combined **warnings+errors CSV** for fix-and-re-upload.

### A.7 Architecture — thin parser in front of the shared core

Refactor `importGrouped` into a reusable core (`applyImportItem(item, { mode })`) and have the CSV importer **parse+validate → produce `ImportSubscriptionDto[]` → feed the same core**. Benefits: one dedup/domain-create/history path; CSV rows that match an existing sub automatically go through **enrich mode** (§B.1) rather than being rejected.

### A.8 Track-A code changes

| File | Change |
|---|---|
| `subscriptions.service.ts` | extract shared core from `importGrouped`; add `importCreateCsv(buffer, fileName, createdBy)` (parse, validate, warnings, feed core) |
| `subscriptions.controller.ts` | `POST /api/subscriptions/import-create-csv` (`FileInterceptor`), mirroring `import-csv` |
| `subscriptions/dto/subscriptions.dto.ts` | result DTO with `created/warnings/errors` buckets |
| web `subscriptions/import` (or new tab) | sample-CSV download + instructions modal + 3-bucket result UI |
| `schema.sql` + Prisma | migrate `csv_import_logs`: add `created_count`, `enriched_count`, and nullable `warning_rows JSONB` (resolved §D-2) |

---

## TRACK B — Extend Import-from-Zoho (enrich + quotes)

### B.1 Enrich-existing mode (user point #5, core ask)

Change the dedup branch in the shared core (currently `skipped++; continue` at [service#L663](../apps/api/src/subscriptions/subscriptions.service.ts#L663)) so that when a subscription already exists:
- **Do NOT create a duplicate.**
- Attach any **missing** history rows (dedup history by `invoiceId` / `quoteId` so re-runs are idempotent).
- Refresh `lastInvoiceId/Number/Date` (and `lastQuoteId/Number/Date`) if newer.
- Report as `enriched` (distinct from `created`/`skipped`).

This lets a Zoho-import pass **backfill history onto CSV-created (or any pre-existing) subscriptions**.

### B.2 Pull quotes/estimates into history (user point #5)

Currently history is invoice-only (`history[]` has no quote fields; `renewal_history.quoteId/quoteNumber/quoteDate` left null on import). Add quote linking:
- **Fetch estimates** alongside invoices — add `GET /organizations/:id/estimates-preview` (mirror `fetchInvoicesForImport`) OR, per invoice, resolve its originating estimate via the invoice's `reference_number` / linked estimate.
- Extend the `history[]` event shape with `quoteId/quoteNumber/quoteDate` and populate those columns (with `renewalStatus`/`zohoEstimateStatus` as appropriate).
- **Open question (§D):** match quotes to a subscription by (a) invoice `reference_number` → estimate, or (b) independently by estimate line-item custom fields (customer::domain::item), or both. Needs a quick spike against real Zoho estimate payloads.

### B.3 Track-B code changes

| File | Change |
|---|---|
| `zoho.service.ts` / `zoho.controller.ts` | `estimates-preview` fetch (custom-field parsing like invoices) and/or invoice→estimate resolution |
| `subscriptions.service.ts` | shared core: enrich branch (§B.1); history builder accepts quote refs; idempotent history dedup |
| web `subscriptions/import/page.tsx` | show quote badges + an "enrich existing" indicator in the review table |
| `import/actions.ts` | extend `ImportInvoiceRef` with quote fields |

---

---

## TRACK C — Flexible Import-from-Zoho filters (user request)

Make the wizard's fetch step far more flexible by exposing Zoho's native filters (all server-side, so we fetch fewer, more relevant docs). Today only **status + date range** are exposed.

### C.1 New filters to surface in the wizard

| Filter | Zoho param | UI |
|---|---|---|
| Business Type | `custom_field` on `cf_new_business` | dropdown: Renewal / Fresh / Transfer / Pro-rata |
| Billing period | `custom_field` on `cf_subs_period` (inv) / `cf_billing_period` (est) | dropdown: Monthly…One-Time |
| Domain contains | `custom_field_contains` on `cf_domain_name` | text |
| Customer | `customer_id` (from cached picker) or `customer_name` | searchable select |
| Item | `item_name_contains` / `item_id` | text/select |
| Reference number | `reference_number` | text |
| Amount range | `total_start` / `total_end` | number range |
| Status | `status` (existing) | existing |
| Date range | `date_start` / `date_end` (existing) | existing |
| Doc source | invoices vs estimates vs both | toggle (feeds Track B) |

### C.2 Backend change

Extend `fetchInvoicesForImport` ([zoho.service.ts](../apps/api/src/zoho/zoho.service.ts)) + its controller ([zoho.controller.ts#L112](../apps/api/src/zoho/zoho.controller.ts#L112)) to accept and pass through the above query params, and add the `estimates-preview` counterpart (§B.2). Note: Zoho's direct-API custom-field filter uses the field's numeric id / `cf_*` name form — confirm the exact query syntax the `zoho-api.client` needs when wiring `custom_field` (the MCP abstracts it, the raw API does not).

### C.3 Notes

- Custom-field filters are **org-specific** (field api_names vary per org). Drive the dropdown options from the org's configured `item_field_mappings` + a `list_custom_fields` fetch, not hard-coded names.
- Keep client-side grouping/dedup as-is; these filters only narrow what's fetched.

---

## D. Decisions — ALL RESOLVED

1. **Item matching key (CSV)** — ✅ **SKU/ID if present, else Name.** Accept an optional `Item ID`/`SKU` column; match exactly on it when present, otherwise fall back to case-insensitive/trimmed `Item Name`. (Items expose short SKUs e.g. `GWBS` + `item_id`.)
2. **Count storage** — ✅ **Add explicit columns.** Migrate `csv_import_logs` to add `created_count`, `enriched_count`, and `warning_rows JSONB` (schema.sql + Prisma). Do not overload `updated_count`.
3. **Quote→subscription matching (Track B)** — ✅ **RESOLVED by spike:** each invoice payload carries `estimate_id` → follow it to fetch + link the originating quote. Fall back to `reference_number`/domain grouping only when `estimate_id` is absent (e.g. manually-created invoices).
4. **Warning severity policy** — ✅ **Always import + flag.** Soft warnings (cycle/date-span mismatch, term overlap) never block; only hard validation errors reject a row.
5. **Estimate billing-period api_name** — ✅ invoices use `cf_subs_period`, estimates use `cf_billing_period`. Store both in the per-entity mapping (don't share one key).

**Plan is build-ready.** No open decisions remain.

## E. Prerequisites for the user

1. **Sync Zoho first** (customers + items) so Customer Numbers and Item Names resolve.
2. Ensure the org's **`item_field_mappings`** are configured (Settings → Organizations) so Domain/Start/End/Cost pull correctly from invoices/estimates.
3. Prefer an **Item ID/SKU** column in the Excel if item names may not match Zoho exactly.

## F. Testing

- Unit: billing-cycle mapping, date parsing, lifecycle computation, warning detection (cycle mismatch, span mismatch, overlap), history idempotency (invoice + quote dedup).
- Integration: CSV happy path; unknown customer/item; domain conflict; auto-create domain; blank price; duplicate → enrich (no dup); re-upload idempotency; Zoho enrich onto CSV-created sub; quote linking populates `quoteId`.
- Manual: download sample CSV → edit → import; export warnings+errors CSV → fix → re-upload; run Zoho import over CSV-created subs → confirm invoice + quote history attached, no duplicates.

## G. Estimated effort

- Track A (CSV): ~1–1.5 days API + UI.
- Track B (enrich + quotes): ~1 day, plus a short spike on Zoho estimate payloads.
