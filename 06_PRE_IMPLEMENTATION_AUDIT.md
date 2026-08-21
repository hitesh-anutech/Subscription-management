# Pre-Implementation Specification Audit

**Document Version:** 1.0
**Date:** 15 May 2026
**Status:** Action Required — Address blockers before Sprint 1
**Author:** Audit pass over specification package
**Scope:** REVISED_PRD_v4.md · schema.sql · 01_OPEN_QUESTIONS_RESOLUTION.md · 02_ZOHO_INTEGRATION_SPEC.md · 03_API_CONTRACTS_OPENAPI.yaml · 04_UI_WIREFRAMES.html · 05_prisma_schema.prisma

---

## 0. Executive Summary

आपकी specification package **~75% implementation-ready** है। Foundations strong हैं — schema and Prisma structurally match, PRD and OpenAPI cover most features, Zoho integration topology is well-thought-out। But there are **2 hard blockers** और **~12 high-severity gaps** जो Sprint 1 शुरू करने से पहले resolve होने चाहिए, otherwise rework cost बढ़ेगा।

### Verdict by File

| File | Maturity | Status |
|---|---|---|
| `REVISED_PRD_v4.md` | Comprehensive, internally consistent | Ready — minor clarifications needed |
| `schema.sql` | Production-ready, rich constraints | Ready (source of truth) |
| `05_prisma_schema.prisma` | Structurally matches, but loses CHECK/enum/partial-index richness | **Needs regeneration** |
| `01_OPEN_QUESTIONS_RESOLUTION.md` | Decisions captured | Needs `seed_default_settings.sql` to encode |
| `02_ZOHO_INTEGRATION_SPEC.md` | ~60% complete | **Needs 5 additions before integration coding** |
| `03_API_CONTRACTS_OPENAPI.yaml` | ~85% coverage | **Needs auth model + missing endpoints + typed Settings schemas** |
| `04_UI_WIREFRAMES.html` | ~50% coverage of MVP features | Needs 8 more screens + 2 PRD contradictions fixed |

### Top 5 Blockers (Must Fix Before Coding)

1. **No `users` table in schema.sql** — yet OpenAPI defines `User` schema and login flow; multiple FK columns (`leads.assigned_to_user_id`, `quick_quotes.created_by_user_id`, `app_settings.updated_by_user_id`, `lead_conversions.converted_by_user_id`) point to nothing. Login literally cannot work.
2. **No `settings_audit_log` table** despite PRD §5A.1 requiring "audit everything" and §5A.5 referencing it; OpenAPI's `GET /settings/audit-log` is also missing.
3. **No `seed_default_settings.sql`** exists, although schema.sql:1121 references it. ~12 runtime decisions (renewal reminders, lead archive days, grace period, rate limits, retry counts, timezone, date format) will read NULL on first run.
4. **Zoho spec missing the atomic Lead→Customer+Estimate sequence with rollback** — PRD §9 spells out 7-step transaction but Zoho spec has no compensating-transaction design.
5. **Zoho spec missing Pro-rata invariant handling** — PRD §5.4 + §8A.2 require subscription `start_date`/`end_date` to NOT change on Pro-rata payment; webhook handler for `invoice_paid` does not branch on `cf_business_type`.

---

## 1. Schema.sql ↔ Prisma Schema Drift

**Verdict:** Structurally aligned (all 15 tables present in both), but Prisma loses critical metadata.

### High-Severity Drift

| # | Issue | Fix |
|---|---|---|
| 1 | `leads.lead_number`, `quick_quotes.quote_number`, `subscriptions.subscription_number` have `DEFAULT generate_*_number()` in SQL but no default in Prisma | Add `@default(dbgenerated("generate_lead_number()"))` etc. |
| 2 | ~22 CHECK enum constraints (Lead.status, QuickQuote.status, Subscription.lifecycle_status/process_status/business_type, billing_cycle, domain.status, connection_status, app_settings.category/value_type, email_templates.category, master_data_lists.list_type, lead_conversions.conversion_status, webhook_events.processing_status, zoho_cache.entity_type, org_settings.pdf_template, etc.) are bare `String` in Prisma | Convert to Prisma `enum` types — biggest single quality win |
| 3 | `idx_qq_zoho_estimate`, `idx_we_failed_for_retry`, `idx_email_templates_org` partial indexes — **missing entirely** in Prisma | Document in raw migration; Prisma can't express partial indexes natively |

### Medium-Severity Drift

- `quote_date DEFAULT CURRENT_DATE` (SQL, Date type) → Prisma uses `@default(now())` which returns DateTime — semantically off but functionally works.
- ~10 partial indexes (`WHERE … IS NOT NULL` or `WHERE status IN (…)`) are full indexes in Prisma — wider, slower, but correct results.
- Numeric range CHECKs (`chk_qq_amounts_non_negative`, `chk_qqi_quantity_positive`, `chk_sub_dates`, etc.) not reflected as Prisma comments.

### Low-Severity Drift

- GIN/trigram full-text indexes on `leads`, `zoho_cache`, `domains` not modeled — Prisma `previewFeatures` enables fulltext but no `@@fulltext` directives present.
- `Organization.leads` back-relation naming reads as "owned by org" but actually means "where org is the conversion target" — pure semantic.

### Recommendation

- **`schema.sql` is the source of truth** (already designated by PRD).
- **Regenerate** `05_prisma_schema.prisma` via `npx prisma db pull` against a DB created by `schema.sql`, then:
  1. Add `@default(dbgenerated(...))` to the three numbering fields.
  2. Convert all 22 CHECK-string columns to Prisma `enum` types.
  3. Add inline `///` comments mirroring CHECK constraints.
  4. Note GIN/full-text indexes as raw SQL migration in a header comment.

---

## 2. OpenAPI ↔ PRD ↔ Schema Alignment

**Verdict:** ~85% coverage; 2 BLOCKERS, 5 HIGH, 6 MEDIUM, 5 LOW issues.

### Blockers

| # | Issue | Section refs |
|---|---|---|
| B1 | OpenAPI defines `User` schema, `/auth/login`, `/me` but `schema.sql` has **no `users` table**. All user-FK columns dangle. | OpenAPI §Auth, PRD §11 |
| B2 | `leads.assigned_to_user_id`, `quick_quotes.created_by_user_id`, `app_settings.updated_by_user_id`, `lead_conversions.converted_by_user_id` reference a non-existent table | schema.sql multiple |

### High-Severity Gaps

| # | Missing | PRD reference |
|---|---|---|
| H1 | `POST /quick-quotes/{id}/push-to-zoho` endpoint | PRD §7.1 names it explicitly |
| H2 | `GET /settings/audit-log` endpoint + `settings_audit_log` table | PRD §5A.1, §5A.5, §5A.6 |
| H3 | `PATCH /organizations/{id}` and `DELETE /organizations/{id}` | PRD §5A.3.1 "Add / Edit / Remove Zoho org" |
| H4 | `GET /lead-conversions/{id}` to poll async conversion status (returned as 202) | PRD §9 Step 7, §12 #3 |
| H5 | `QuickQuote` response schema omits `is_intra_state`, `cgst_rate`, `sgst_rate`, `igst_rate`, line-item `discount_amount`, `revision_of_quote_id`, `rejection_reason`, `public_token_expires_at`, `pushed_to_zoho_at` — GST breakdown is tax-compliance required | OpenAPI vs schema |
| H6 | `/settings/{category}` returns `type: object` (untyped) — defeats the openapi-typescript codegen goal | OpenAPI top-of-file intent |

### Medium-Severity Gaps

- Missing `POST /public/quote/{token}/view` view tracker (`viewed_at`, `view_count` columns exist for it).
- Missing `POST /organizations/{id}/disconnect-zoho` and reconnect.
- Missing `GET /webhook-events` list and `POST /webhook-events/{id}/retry` (PRD §5A.3.13 lists "Failed jobs replay interface").
- `OrgBranding` returns flat `address: string` but schema stores columnar `address_line1/line2/city/state/...` — needs mapper.
- `Lead` and `Subscription` response schemas omit columns needed for §5.7 universal search and §5.6 timeline display.
- No `GET /webhook-events/*` endpoints despite schema table being primary observability surface.

### Low-Severity Gaps

- `RenewalHistoryEvent.business_type` enum includes `Fresh` but PRD §3.3 only documents Renewal/Pro-rata living in `renewal_history` — minor inconsistency.
- Orphan `POST /domains` and `PATCH /domains/{id}` (PRD treats domain rows as auto-created during conversion §9 Step 2).
- No `Organization.metadata`, `Domain.metadata` fields in responses though schema has them.

---

## 3. UI Wireframes ↔ PRD Coverage

**Verdict:** ~50% coverage; 8 missing screens + 2 PRD contradictions.

### Missing Wireframes (High/Medium)

1. **Customer Detail Page** — PRD §3.3 names it as a trigger point for Type 2 Cross-sell Quote. **High**
2. **Pro-rata Calculator UI** — PRD §5.4 specifies qty/effective-date inputs and per-day rate display; wireframe shows only a "Pro-rata" button. **High**
3. **Domain Mapping View** — PRD §5.5 is a documented feature; wireframe has only a sidebar link. **High**
4. **System Health & Diagnostics dashboard** — PRD §5A.3.13 lists 11 widgets; wireframe has only a sidebar link. **High**
5. **Lead-mode quote builder state** — toggle exists but only Existing-customer state rendered; New-customer inline lead form not shown. **High**
6. **9 of 10 Settings detail panels** — only "Organizations" panel rendered. **Medium**
7. **OAuth Connect / Reconnect modal flow** — only "Reconnect" button shown, no consent or new-org connect modal. **Medium**
8. **Renewal/Pro-rata pre-filled builder state** — single shared component is supposed to render differently in those modes. **Medium**

### PRD Contradictions in Wireframes (must be fixed)

| # | Where | Contradiction |
|---|---|---|
| C1 | Screen 2 Subscriptions List → **"+ New Subscription" button** (line 199) | PRD §3.3/§5.3/§5.4: subscriptions created **only via quote acceptance + invoice payment**; no manual creation path. Remove the button or repurpose as "+ Import Subscription" for one-time legacy migration only. |

(Initial audit flagged Screen 6's "Convert to Customer" CTA as a contradiction; verification on lines 583, 625, 634 confirms the screen depicts a Lead-mode quote (has public link `app.excel...q/abc123`; CTA text reads "Convert this lead to a paying customer"). "Acme Corporation" is the lead's company name. Screen 6 is internally consistent with PRD §4.4.)

### Numbering Inconsistency

Screen 3 shows a Pro-rata renewal as `EST-2025-0089` while Quick Quotes use `QQ-` prefix. PRD has no prefix scheme defined for renewal/pro-rata estimate numbers. Add to PRD §5A.3.2 or document Zoho's auto-numbered estimate scheme.

---

## 4. Zoho Integration Spec — Implementation Readiness

**Verdict:** ~60% ready. Type 2 (Cross-sell) is codeable today; Types 1, 3, 4 need spec additions.

### Coverage Matrix

| Concern | Quality | Blocker? |
|---|---|---|
| Type 1 Lead Quote (atomic conversion) | Skeleton | **YES** |
| Type 2 Cross-sell | Detailed | No |
| Type 3 Renewal | Skeleton | **YES** |
| Type 4 Pro-rata (dates-unchanged invariant) | Missing | **YES** |
| Webhook signature verification | Weak (one global env secret for 4 orgs) | **YES** |
| Webhook per-event handler routing | Missing | **YES** |
| Idempotency keys for writes | Missing | **YES** |
| Initial sync vs delta sync (3 AM IST) | Missing | **YES** |
| Custom fields manual setup | Detailed | No |
| OAuth connect + scopes + refresh | Detailed | No |
| Rate limit (80/min) + 5xx/429 retry | Detailed | No |
| Org onboarding checklist | Detailed | No |
| Disconnect flow | Missing | Minor |
| Circuit breaker | Missing | Minor |

### Five Spec Additions Required

1. **Atomic Lead-Conversion Sequence (Zoho perspective)** — explicit ordered API calls (POST /contacts → POST /estimates), compensating rollback design (orphan Zoho contact cleanup if estimate POST fails), idempotency via pre-check on `cf_central_lead_id`.
2. **Pro-rata `invoice_paid` Handler Branch** — webhook handler logic must check `cf_business_type` and apply different DB mutations: `Renewal` extends `end_date`, `Pro-rata` increments `quantity` without touching dates.
3. **Sync Engine Strategy** — daily 3 AM IST full sync covers what entities? Cursor pagination? `last_modified_time` filter? Deleted-record detection? Sync state checkpointing in `organizations.last_sync_at` or a dedicated table?
4. **Per-Org Webhook Secrets** — current `process.env.ZOHO_WEBHOOK_SECRET` is global; for 4 orgs store per-org secret on `organizations` table, support rotation.
5. **Per-Event Handler Routing Table** — explicit map: `estimate_accepted` → `QuickQuoteWebhookHandler.onAccepted`, `invoice_paid` → `SubscriptionWebhookHandler.onPaid` (branches on `cf_business_type`), etc. Also add `estimate_viewed` event (PRD §5A.3.8 needs it for notification).

---

## 5. Decision Encoding — Resolution Doc vs Reality

**Verdict:** 6 decisions fully encoded; ~12 paper-only. **No contradictions** (good).

### Critical Gap: `seed_default_settings.sql` does not exist

`schema.sql:1121` references it as "separate file" but file is absent. This single file would move 12+ decisions from paper to runtime.

### Required Seed Rows (for `seed_default_settings.sql`)

```
quick_quote.default_validity_days         = 15            -- Q1.1
quick_quote.public_token_expiry_days      = 30            -- Q5.10
quick_quote.number_format                 = "QQ-YYYY-NNNN" -- Q5.1
subscription.renewal_reminder_days        = [60,30,15,7]  -- Q1.2  (HIGH)
subscription.expiry_grace_days            = 60            -- Q1.4  (HIGH)
lead.auto_archive_days                    = 180           -- Q1.3  (HIGH)
tax.default_gst_rate                      = 18            -- Q5.4
tax.tax_mode                              = "exclusive"   -- Q5.5
localization.currency                     = "INR"         -- Q5.6
localization.timezone                     = "Asia/Kolkata" -- Q5.7
localization.date_format                  = "DD/MM/YYYY"  -- Q5.8
zoho.api_rate_limit_per_min               = 80            -- Q4.5  (HIGH)
zoho.webhook_max_retries                  = 5             -- Q4.4  (HIGH)
zoho.webhook_retry_intervals              = [60,300,1800,7200,86400]  -- Q4.4
security.password_min_length              = 12            -- Q6.3
security.session_idle_timeout_hrs         = 24            -- Q6.4
conversion.max_auto_retries               = 3             -- Q1.10
conversion.retry_intervals_seconds        = [5,30,300]    -- Q1.10
```

### Fully Encoded (no action needed)

Q1.1 quote validity 15d (column default), Q5.4 GST 18% (column default), Q5.6 currency INR (column default), Q6.2 token 128 chars (column type), Q5.1/5.2/5.3 numbering formats (DB functions), Q1.5 manual lead conversion (endpoint).

### Partially Encoded

- Q5.10 public token expiry 30d: column exists, but no default — application must set `public_token_expires_at = quote_date + 30 days` at insert time. Document this as a service-layer requirement.
- Q4.4 webhook 5 retries: `retry_count` column exists but no CHECK enforcing the cap.
- Q1.10 conversion retries: `conversion_status` column exists but retry config is paper-only.

---

## 6. Tech Stack Recommendation

Based on PRD requirements (self-hosted, 4-org multi-tenant, scheduled jobs, public quote links, PDF generation, webhook ingestion, complex domain logic, India GST):

### Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| **Backend** | **NestJS + TypeScript + Prisma** | Modular structure fits 13 settings categories + 4 quote types + 10 PRD modules; built-in DI for `ZohoApiClient`, `OrgResolver`, `WebhookDispatcher`; decorators for auth guards + validation; large ecosystem for queues (Bull/BullMQ), schedulers (`@nestjs/schedule`), Swagger (`@nestjs/swagger`) auto-generates OpenAPI |
| **Frontend** | **Next.js 14 (App Router) + Tailwind + shadcn/ui + React Query** | SSR is essential for the **public quote link** (`/q/{token}` must serve to anyone, SEO/preview unblocked); admin dashboards benefit from RSC; shadcn/ui matches the clean wireframe aesthetic; React Query for the heavy data-fetching dashboards |
| **Database** | **PostgreSQL 15+** (already in schema) | JSONB for `metadata`, GIN trigram for fuzzy search (universal search §5.7), partial indexes, sequences for numbering — all already used in schema.sql |
| **ORM** | **Prisma** (already chosen) | Type-safe, migrations workflow good for an evolving spec; one caveat in §1 — regenerate from SQL, don't author Prisma-first |
| **Auth** | **NextAuth.js (Auth.js v5) with database sessions** | First-party Next.js, supports JWT, 2FA in Phase 2, works with Prisma adapter; create the missing `users` + `accounts` + `sessions` tables via its standard schema |
| **Queues / Jobs** | **BullMQ + Redis** | Webhook retries, daily 3 AM IST sync cron, reminder schedules (60/30/15/7d), lead archival cron, lead-conversion async pipeline |
| **PDF** | **Puppeteer** (headless Chromium) rendering an HTML template, or **PDFKit** for finer control | HTML template wins for branded PDFs with logos/colors per org (PRD §5A.3.3); Puppeteer image is heavier but the HTML→PDF workflow is fast to iterate |
| **Email** | **Nodemailer** wrapper around configurable provider (SendGrid / SES / SMTP) per PRD §5A.3.4 | Provider abstraction satisfies the "test email" button + per-org From address |
| **Cache** | **Redis** (already implied) | Settings cache, OAuth token cache, rate-limit token bucket per org |
| **File Storage** | **Local filesystem (self-hosted)** for PDFs initially, with `pdf_storage_path` column already in schema; abstract behind storage service to swap for S3-compatible later | PRD says "self-hosted" so local is fine; abstraction keeps options open |
| **Validation** | **Zod** (or `class-validator` for NestJS) | Mirror OpenAPI schemas; share types end-to-end via openapi-typescript |
| **Observability** | **Pino** (structured logging) + **Sentry** (errors) + **Prometheus** metrics endpoint | System Health dashboard (§5A.3.13) needs concrete telemetry; pino-pretty for dev |
| **Testing** | **Vitest** (unit), **Supertest** (API), **Playwright** (e2e), **Pact** (contract test against OpenAPI) | Pact especially valuable given OpenAPI is the contract |
| **Deployment** | **Docker Compose** (one-box self-hosted) → optionally Kubernetes later | Single-tenant deployment matches the PRD self-hosted assumption |

### Why NestJS over Express

The PRD has 10 functional modules, 4 quote types with overlapping logic, 13 settings categories with audit, webhook dispatch, multi-org middleware, scheduled jobs, and a need for Swagger generation. Express works but every cross-cutting concern (auth, validation, logging, transactional commits, request-scoped Zoho client) becomes manual wiring. NestJS gives you these out of the box.

### Why Next.js over Vite SPA

The single deciding factor is the **public quote link**. A lead opens `/q/abc123…` from an email — that page must be server-rendered (fast, no auth hydration delay, OpenGraph preview when shared, robust against client-side JS failures on corporate networks). Vite SPA can't do this without an extra Express renderer. Next.js handles it natively.

---

## 7. Recommended Action Plan (Before Sprint 1)

| # | Action | Owner | Output | Effort |
|---|---|---|---|---|
| 1 | Add `users`, `accounts`, `sessions` tables to `schema.sql` (NextAuth standard schema) | Hitesh | Schema migration | 1 day |
| 2 | Add `settings_audit_log` table to `schema.sql` | Hitesh | Schema migration | 0.5 day |
| 3 | Create `seed_default_settings.sql` with the 18 rows in §5 | Hitesh | Seed file | 0.5 day |
| 4 | Regenerate `05_prisma_schema.prisma` (db pull → enum conversion → defaults) | Hitesh | Updated Prisma | 1 day |
| 5 | Update OpenAPI: add missing endpoints (audit-log, push-to-zoho, PATCH/DELETE orgs, lead-conversion poll, view-tracker), type the `/settings/{category}` responses, add GST fields to QuickQuote schema | Hitesh | OpenAPI v1.1 | 1 day |
| 6 | Add Zoho spec §15 "Atomic Lead Conversion Sequence" + §16 "Pro-rata Webhook Handler" + §17 "Sync Engine Strategy" + §18 "Per-Org Webhook Secrets" + §19 "Event Routing Table" | Hitesh | Zoho spec v1.1 | 1 day |
| 7 | Fix wireframe contradiction: remove (or repurpose) "+ New Subscription" button from Screen 2 (line 199) | Hitesh | Wireframe v1.1 | 0.5 day |
| 8 | Add wireframes for: Pro-rata Calculator, Domain Mapping, System Health, Lead-mode quote builder, Customer Detail, OAuth modal (priority 1) | Hitesh | Wireframe v1.1 | 2 days |
| 9 | Add wireframes for remaining 9 Settings detail panels (priority 2; can defer to Sprint as built) | Hitesh | Wireframe v1.2 | 2 days |

**Total: ~9 days of spec work before clean Sprint 1 kickoff.** Worth it — every day saved here is 3-5 days of rework saved later.

---

## 8. What's Already Excellent

To balance the gap focus:

- **Schema rigor** — partial indexes, GIN full-text, CHECK constraints, sequences, helper functions — production-quality DDL.
- **The unified Quick Quote design** (single component, two backend paths) — elegant, low-cognitive-load UX.
- **The 4-quote-type taxonomy** (Lead, Cross-sell, Renewal, Pro-rata) with custom-field differentiation in Zoho — clean separation of concerns.
- **Customer hygiene boundary** (leads in Central, customers in Zoho, atomic conversion on accept) — prevents Zoho master pollution, a real pain that the PRD's business context names explicitly.
- **OpenAPI as a contract** — frontend and backend can parallel-develop with openapi-typescript codegen, once the typed Settings issue is fixed.
- **Settings module philosophy** (DB-backed, audited, cached, defaults-seeded) — exactly the right design for a tool that 5 different roles will use.
- **Open-questions resolution doc** — most teams skip this. You did it with rationale and severity tags.

---

## 9. Files Referenced

- `C:\Users\h23ku\OneDrive\Documents\Claude\Projects\Subscription Management with Zoho Zooks\REVISED_PRD_v4.md`
- `C:\Users\h23ku\OneDrive\Documents\Claude\Projects\Subscription Management with Zoho Zooks\schema.sql`
- `C:\Users\h23ku\OneDrive\Documents\Claude\Projects\Subscription Management with Zoho Zooks\01_OPEN_QUESTIONS_RESOLUTION.md`
- `C:\Users\h23ku\OneDrive\Documents\Claude\Projects\Subscription Management with Zoho Zooks\02_ZOHO_INTEGRATION_SPEC.md`
- `C:\Users\h23ku\OneDrive\Documents\Claude\Projects\Subscription Management with Zoho Zooks\03_API_CONTRACTS_OPENAPI.yaml`
- `C:\Users\h23ku\OneDrive\Documents\Claude\Projects\Subscription Management with Zoho Zooks\04_UI_WIREFRAMES.html`
- `C:\Users\h23ku\OneDrive\Documents\Claude\Projects\Subscription Management with Zoho Zooks\05_prisma_schema.prisma`

---

## 10. Bottom Line

**Don't start coding yet.** Fix the 2 blockers (users table + settings_audit_log) and produce the 3 missing artifacts (`seed_default_settings.sql`, Zoho spec additions, wireframe corrections). Then Sprint 1 (Organizations + OAuth) runs clean.

Estimated 9 days of spec polish saves ~30 days of mid-sprint rework.
