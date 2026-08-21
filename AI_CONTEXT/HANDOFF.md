# Developer Handoff

**Date:** 2026-07-18
**Session:** In-app document PDFs — View PDF (Zoho, DB-cached) · quote-PDF email attachment (SendGrid) · PDF Branding on the quote PDF + print page
**Language Note:** User communicates in Hindi (Devanagari) mixed with English technical terms — respond in Hindi.

---

## Project Summary

Subscription-based Billing & Renewal Automation System integrated with Zoho Books (4 orgs, multi-data-center). Stack: Next.js 14 App Router (`apps/web`, :3000), NestJS + Prisma + PostgreSQL (`apps/api`, :3001), pnpm monorepo, `packages/db` (Prisma; sync via **`prisma db push`**, not migrations). Zoho Books is the source of truth for estimates/invoices; the app owns leads, quick quotes, subscriptions, domains, renewal batches/history. App-native emails go via **SendGrid**; renewal/invoice emails to customers go via **Zoho's own email API**. Live context hub = `AI_CONTEXT/`.

---

## What Was Completed This Session

### A. View PDF — Zoho estimate/invoice PDFs, DB-cached
1. **`zoho_document_pdf` table** (bytea) caches PDF bytes, keyed `(organization_id, entity_type, zoho_doc_id)`. Prisma model + `schema.sql` §4.2b + `db push` (done).
2. **`ZohoApiClient.getBinary()`** — raw binary fetch (bypasses the UTF-8 `transformResponse`) → Buffer.
3. **`ZohoService.getDocumentPdf(orgId, kind, docId, {force?})`** — DB-cache-first; miss/force → `GET /{estimates|invoices}/{id}?accept=pdf`, upsert, return. **`invalidateDocPdf()`** drops a stored row.
4. **Endpoint** `GET /api/organizations/:id/documents/:kind/:docId/pdf` — streams `application/pdf` (`?download=1`, `?force=1`); behind the global auth guard.
5. **Webhook invalidation** — `estimate_updated` / `invoice_created` / `payment_added` drop the stored PDF (alongside the doc-detail cache).
6. **`ViewPdfButton`** (`apps/web/src/components/view-pdf-button.tsx`) — blob + `credentials:'include'`, popup-safe (opens tab in the click gesture), anchor fallback, "⚠ Retry". Wired into: **Quotes & Invoices browser** (always-on PDF column), **Renewal Batch review** (per-batch estimate PDF; added `organizationId` to the batch interface — backend already returned it), **Subscription-detail** renewal-history (📄 next to each quote/invoice link), **converted-invoice actions** ("📄 Invoice PDF"; kept the app "Quote Sheet" print link).

### B. Quote PDF attached to the quick-quote email (SendGrid)
7. **`EmailService.send()` gained `attachments`** (SendGrid base64).
8. **`QuickQuotesService.buildQuotePdf()`** (pdf-lib) renders the quote (header, quote #/date/valid, BILL TO, items, totals, notes, terms, sign-off) → attached as `{quoteNumber}.pdf` on `POST /quick-quotes/:id/send`. Best-effort: a PDF failure logs a warning; the email still sends. Quick quotes are app-native at send time (no Zoho estimate) → generated, not fetched.
9. **Zoho-sent invoice/quote/batch emails left unchanged** — user confirmed Zoho already attaches the document PDF natively (adding ours would duplicate).

### C. PDF Branding (logo + signature)
10. `buildQuotePdf` embeds the org **logo** (header) + **signature** (sign-off) from `org_settings.logoUrl`/`signatureImageUrl` (base64 data-URLs, Settings → PDF Branding). `embedImage()` = **PNG/JPEG only** (pdf-lib can't SVG/WebP); money uses **ISO currency code**; non-Latin-1 text stripped.
11. **`/quotes/[id]/print`** now renders logo (header), signature (bottom-right "Authorised Signatory") + footer text, fetched via `GET /org-settings/:orgId` using the quote's `targetOrganizationId`. Browser `<img>` → SVG/WebP/₹/Hindi all render fine here.

---

## Files Modified (key ones)

| Area | Files |
|---|---|
| DB | `packages/db/prisma/schema.prisma` (+ `ZohoDocumentPdf`), root `schema.sql` (§4.2b) |
| Zoho client/service | `apps/api/src/zoho/zoho-api.client.ts` (`getBinary`), `zoho.service.ts` (`getDocumentPdf`/`invalidateDocPdf`), `webhook.service.ts` (PDF invalidation) |
| Documents API | `apps/api/src/documents/documents.controller.ts` (PDF endpoint), `documents.service.ts` (`getPdf` passthrough) |
| Email | `apps/api/src/email/email.service.ts` (attachments) |
| Quick quotes | `apps/api/src/quick-quotes/quick-quotes.service.ts` (`buildQuotePdf` + attach in `send()`) |
| Web components | `apps/web/src/components/view-pdf-button.tsx` (new) |
| Web surfaces | `documents/_components/documents-browser.tsx`, `subscriptions/renewal-batches/_components/batch-review-table.tsx`, `subscriptions/[id]/page.tsx`, `quick-quotes/_components/converted-invoice-actions.tsx`, `quotes/[id]/print/page.tsx` |

---

## Database Changes (via `npx prisma db push`; schema.sql backfilled §4.2b)

| Table | Purpose |
|---|---|
| `zoho_document_pdf` | Cached PDF bytes (`pdf_data BYTEA`) of Zoho estimates/invoices; unique `(organization_id, entity_type, zoho_doc_id)`; `entity_type IN ('estimate','invoice')`. |

---

## APIs Added

- `GET /api/organizations/:id/documents/:kind/:docId/pdf` — stream a Zoho estimate/invoice PDF (DB-cached; `?download=1`, `?force=1`).
- `EmailService.send()` now accepts optional `attachments` (internal).
- `POST /api/quick-quotes/:id/send` — now also attaches the generated quote PDF when a recipient is given.

---

## Remaining Bugs

**None open.** Operational gotchas (not defects): the pdf-lib quote PDF is **PNG/JPEG-only** (SVG/WebP logos skipped), uses the **ISO currency code** and **strips non-Latin-1 text** — the print page has no such limit (see BUGS.md). Prior gotchas still apply (bulk-create needs cache-selected items; documents browser API-heavy; stray `email.smtp_*` rows ignored).

---

## Pending Tasks (top of TASKS.md)

1. **This session's UAT** (typecheck-clean, not live-run): View PDF on all 4 surfaces + cache re-open + webhook refresh; quick-quote email PDF attachment + layout; branding (PNG/JPG) on the attached PDF **and** the print page.
2. Bulk-domains remaining UAT; per-customer "Generate Bulk Quotes" UAT; SendGrid/email UAT; 2026-07-14/15 UAT backlog; multi-currency Phase 2; PERF_PLAN follow-ups; production CI/CD + env.

---

## Exact Next Step

Live-test the View PDF flow: in the Quotes & Invoices browser fetch a live org's quotes/invoices → click **PDF** → confirm it opens; re-open (should be instant from `zoho_document_pdf`). Then send a quick quote via SendGrid with a **PNG/JPG** logo+signature configured and confirm the attached `{quoteNumber}.pdf` shows both.

---

## Warnings for the Next Developer

1. **DB sync is `prisma db push`** (never `migrate dev`); Windows dev-server locks the query-engine DLL → types still regenerate, or use `--skip-generate`.
2. **pdf-lib = PNG/JPEG + WinAnsi only.** Any generated PDF (quote PDF here, AnnexureService) can't embed SVG/WebP or non-Latin-1 glyphs (₹, Devanagari). Use PNG/JPG images, ISO currency codes, ASCII/Latin-1 text — or embed a Unicode font + rasterize SVG.
3. **Zoho transaction emails auto-attach the doc PDF** — don't also attach it yourself (duplicate). Only app-native (SendGrid) sends need a generated attachment.
4. **New `organizations/:id/...` routes** live in `DocumentsController` (`@Controller()` with full paths) — keep specific paths from colliding with `organizations/:id/documents`.
5. **Zoho web deep links:** `#/quotes/{id}` (not `#/estimates/`); the REST entity stays `estimates`.
6. **All DTOs are class-validator** (a nestjs-zod DTO silently fails the global `forbidNonWhitelisted` pipe — BUG-016).
7. **IDE diagnostics on `AI_CONTEXT/*.md` are spell-checker noise** (flags "Zoho"/Hindi) — not real errors.
