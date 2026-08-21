# Open Questions Resolution Document

**Document Version:** 1.0
**Date:** 14 May 2026
**Part of:** Path B — Pre-Implementation Specification Package
**Status:** Recommended decisions awaiting stakeholder confirmation
**Related PRD:** REVISED_PRD_v4.md (Section 15 — Open Questions)

---

## Purpose

PRD v4.0 में 15+ open questions थे जो implementation start करने से पहले resolve होने चाहिए। यह document हर एक का **recommended decision** present करता है, strong rationale और implementation impact के साथ।

**Decision Authority:**
- ✅ **Auto-decided (technical/best-practice):** मैंने industry best practice से decide कर दिया
- 🟡 **Recommended (please confirm):** सुझाव दिया है, business preference हो तो revise
- 🔴 **Stakeholder required:** आपकी input चाहिए

---

## Section 1: Business / Workflow Decisions

### Q1.1 — Quote Validity Default

**Decision:** 🟡 **15 days**

**Rationale:**
- B2B SaaS industry standard
- Urgency create करता है (forces decision)
- Per-quote override always available
- Settings में admin change कर सकता है

**Impact:** `quick_quotes.validity_days DEFAULT 15`, settings में editable

---

### Q1.2 — Renewal Reminder Schedule

**Decision:** 🟡 **60, 30, 15, 7 days before expiry**

**Rationale:**
- 60 days: awareness phase ("subscription due in 2 months")
- 30 days: planning phase ("budget approval initiate")
- 15 days: action phase ("quote generate and approve")
- 7 days: urgency phase ("payment chase")
- Settings में customizable per organization

**Impact:** `app_settings` में `subscription.renewal_reminder_days = [60, 30, 15, 7]`

---

### Q1.3 — Lead Auto-Archive Period

**Decision:** ✅ **180 days of inactivity**

**Rationale:**
- B2B sales cycles can be 3-6 months
- 180 days enough for slow-moving deals
- Auto-archive ≠ delete — leads still visible in archived view
- Configurable via settings

**Impact:** Background job daily runs, marks `leads.status = 'Archived'` जहां last activity > 180 days

---

### Q1.4 — Subscription Expiry Grace Period

**Decision:** ✅ **60 days after end_date → auto-mark Inactive**

**Rationale:**
- Customers often delay renewal by a few weeks
- 60 days buffer prevents premature inactivation
- After 60 days, subscription likely truly lost
- Manual revival always possible

**Impact:** Background job updates `subscriptions.lifecycle_status = 'Inactive'`

---

### Q1.5 — Conversion Trigger (Lead → Customer)

**Decision:** ✅ **Manual for Phase 1, Auto toggle for Phase 2**

**Rationale:**
- Manual conversion = sales person verifies lead details (GSTIN, address, legal name)
- Catches typos before they reach Zoho
- Phase 2 में per-customer "auto-convert on accept" flag add होगा
- Reduces risk of Zoho data quality issues

**Impact:** "Convert to Customer" button on lead detail page after quote acceptance

---

### Q1.6 — Existing Customer Quote Email Path (Mode A)

**Decision:** ✅ **Trigger Zoho's email**

**Rationale:**
- Zoho का audit trail captures send event
- Customer-facing communications केंद्रित में एक जगह
- Zoho's email templates already configured by customer
- Less infrastructure on Central App side

**Implementation:** Zoho API call `POST /estimates` with `send_now = true` flag

---

### Q1.7 — Public Quote URL Pattern (Lead Mode)

**Decision:** ✅ **Path-based: `https://app.exceltechnologies.in/q/{token}`**

**Rationale:**
- No additional DNS / subdomain setup
- Single SSL certificate
- Easier to implement in Next.js routing
- Token security same in both approaches

**Alternative considered:** Subdomain `quote.exceltechnologies.in/{token}` — rejected for simplicity

---

### Q1.8 — Lead Duplicate Detection

**Decision:** ✅ **Warn-only on email match (allow override)**

**Rationale:**
- Different legal entities may share procurement email
- Different domains under same parent company possible
- Hard block too restrictive
- Show "Possible duplicate" warning with link to existing lead

**Impact:** API endpoint returns warning, frontend shows confirmation dialog

---

### Q1.9 — Cross-sell Quote Storage

**Decision:** ✅ **Stays in `quick_quotes` table (not `renewal_history`)**

**Rationale:**
- `renewal_history` only for subscription-linked events (Types 3 & 4)
- Cross-sell creates **new** subscription, not extends existing
- Cleaner separation of concerns
- When new subscription created post-payment, link via `subscriptions.origin_quick_quote_id`

---

### Q1.10 — Conversion Failure Recovery

**Decision:** ✅ **3 auto-retries with exponential backoff, then manual queue**

**Rationale:**
- Retry intervals: 5 seconds → 30 seconds → 5 minutes
- Most transient issues (network, Zoho 5xx) self-resolve
- Persistent failures (validation errors) need human attention
- "Failed Conversions" admin page for review and manual retry

**Impact:** BullMQ job with retry config; `lead_conversions.conversion_status = 'failed'`

---

## Section 2: Technology Stack Decisions

### Q2.1 — Frontend Framework

**Decision:** ✅ **Next.js 14+ (App Router)**

**Rationale:**
- Server components + API routes in one codebase
- Built-in SSR for public quote view (SEO + sharing)
- Excellent TypeScript support
- Mature ecosystem

**Specifics:** Next.js 14.2+, TypeScript 5.x, React 18+

---

### Q2.2 — UI Component Library

**Decision:** ✅ **shadcn/ui (Tailwind CSS + Radix UI)**

**Rationale:**
- Copy-paste components (no vendor lock-in)
- Highly customizable for branding
- Accessible by default (Radix primitives)
- Modern aesthetic, can match Excel Tech branding

**Alternative considered:** Material UI — rejected for less customization flexibility

---

### Q2.3 — Backend / API

**Decision:** ✅ **Next.js API Routes (Phase 1) → NestJS migration if needed (Phase 2)**

**Rationale:**
- Phase 1 monolith simpler to deploy
- Background jobs as separate worker process
- NestJS migration possible later when team scales

---

### Q2.4 — Database

**Decision:** ✅ **PostgreSQL 15+**

**Rationale:**
- Strong relational + JSONB flexibility
- Full-text search built-in (gin indexes)
- Mature, reliable, well-documented

---

### Q2.5 — ORM

**Decision:** ✅ **Prisma**

**Rationale:**
- Type-safe queries auto-generated from schema
- Schema-first migrations
- Excellent Next.js integration
- Active development

---

### Q2.6 — Cache & Queue

**Decision:** ✅ **Redis + BullMQ**

**Rationale:**
- Redis for settings cache, search index, rate limiting
- BullMQ for background jobs (Zoho sync, email send, PDF gen)
- Both supported by all hosting platforms

---

### Q2.7 — PDF Generation Engine

**Decision:** ✅ **Puppeteer (server-side HTML → PDF)**

**Rationale:**
- React components for templates (designer-friendly)
- Full CSS support (better-looking PDFs)
- Tested at scale
- Can run in serverless via @sparticuz/chromium

**Alternative considered:** `@react-pdf/renderer` — rejected because limited CSS, harder to design

**Implementation:** PDF templates as React components, rendered via Puppeteer

---

### Q2.8 — Email Service Provider

**Decision:** ✅ **Google Workspace SMTP** (confirmed by stakeholder)

**Rationale:**
- Already paying for Google Workspace — zero additional cost
- Sends from your real business email (e.g., quotes@exceltechnologies.in)
- Better deliverability vs new domain SES (established reputation)
- 2000 emails/day per user — sufficient for Phase 1 volume
- Single vendor relationship

**Implementation Details:**
- SMTP Server: `smtp.gmail.com:587` (TLS)
- Authentication: **OAuth 2.0** (recommended — secure, no password storage)
  - Alternative: **App Password** (simpler, requires 2FA enabled on Workspace account)
- Library: `nodemailer` with Google OAuth2 auth flow
- Implementation wrapper: `IEmailService` interface so future provider swap is easy

**Setup Steps:**
1. Create Google Cloud project
2. Enable Gmail API
3. Create OAuth 2.0 credentials (web application)
4. Authorize the Workspace account for SMTP send
5. Store refresh token in environment variables (encrypted)

**Daily Limits (Phase 1 sufficient):**
- Workspace Standard: 2000 recipients/day
- Workspace Business Plus: 10,000/day

**Phase 2 Consideration:** If volume exceeds Workspace limits, add SendGrid/SES as fallback via the abstraction layer.

**Stakeholder Confirmed:** ✅ 14 May 2026

---

### Q2.9 — Authentication

**Decision:** ✅ **NextAuth.js v5 (Auth.js) with email/password**

**Rationale:**
- Built for Next.js
- Easy to add OAuth providers later (Google, Microsoft)
- Session management built-in
- Phase 2: Add 2FA (TOTP via @next-auth/totp-provider)

---

### Q2.10 — State Management

**Decision:** ✅ **TanStack Query (server state) + Zustand (UI state)**

**Rationale:**
- TanStack Query: caching, refetching, optimistic updates
- Zustand: lightweight UI state (sidebar, modals, filters)
- Minimal boilerplate vs Redux

---

### Q2.11 — Form Handling

**Decision:** ✅ **React Hook Form + Zod**

**Rationale:**
- React Hook Form: best performance for complex forms
- Zod: shared validation between frontend and backend
- TypeScript-first

---

### Q2.12 — Logging

**Decision:** ✅ **Pino (structured JSON) + Better Stack (formerly Logtail)**

**Rationale:**
- Pino: fastest Node.js logger
- Better Stack: affordable log aggregation, good search

---

### Q2.13 — Error Monitoring

**Decision:** ✅ **Sentry**

**Rationale:**
- Industry standard
- Excellent Next.js integration
- Free tier covers Phase 1 scale

---

### Q2.14 — Testing Framework

**Decision:** ✅ **Vitest (unit) + Playwright (E2E)**

**Rationale:**
- Vitest: fast, modern, Jest-compatible API
- Playwright: best E2E for Next.js apps
- Both have excellent TypeScript support

---

## Section 3: Infrastructure / Deployment Decisions

### Q3.1 — Hosting Platform

**Decision:** ✅ **Self-Hosted — Localhost First (confirmed by stakeholder)**

**Rationale:**
- Full control over data (sensitive customer + financial info stays on-premises)
- Zero monthly hosting cost for Phase 1
- Easier to iterate during development
- Production hosting decision deferred to post-MVP based on real usage
- Aligns with "build first, scale later" philosophy

**Development Setup:**
- **Local machine** (developer's laptop / desktop)
- **Docker Compose** stack:
  - PostgreSQL 15+ container
  - Redis container
  - Node.js application (Next.js)
- Single `docker-compose.yml` file for one-command setup

**Phase 1 Production Options (decide later):**
- **Own VPS** (Hetzner / Linode / DigitalOcean Droplet) — $5-20/month
- **On-premise server** (Excel Technologies office) — if you have a always-on machine
- **AWS Lightsail** — managed VPS, $5+/month
- **Indian cloud** (E2E Networks, ESDS) — for data residency

**Self-Hosting Requirements (when going production):**

1. **Domain Setup:**
   - Sub-domain for app (e.g., `app.exceltechnologies.in`)
   - Sub-domain for public quote view (e.g., `app.exceltechnologies.in/q/{token}`)

2. **SSL Certificate:**
   - **Let's Encrypt** (free, auto-renewing) via Certbot or Caddy
   - Auto-renewal cron

3. **Reverse Proxy:**
   - **Caddy** (recommended — auto-SSL, simple config)
   - Or Nginx (more control, more config)

4. **Process Management:**
   - **PM2** (Node.js process manager) — handles crashes, restarts, logs
   - Or Docker for containerization

5. **Backup Strategy:**
   - Daily PostgreSQL backups via cron (`pg_dump` to local disk + optional cloud sync)
   - Weekly full backup to external drive or cloud storage

6. **Monitoring:**
   - **UptimeRobot** (free, 50 monitors) — uptime checking
   - **Sentry** — error tracking
   - **Pino logs** — local files with rotation

7. **Security Hardening:**
   - Firewall (UFW)
   - Fail2ban for SSH protection
   - Regular OS security updates
   - SSH key-only login (disable password)

**Documentation Deliverable:** Self-hosting setup guide in implementation phase.

**Stakeholder Confirmed:** ✅ 14 May 2026

---

### Q3.2 — File / PDF Storage

**Decision:** ✅ **Local disk (self-hosted) with organized folder structure**

**Structure:**
```
/var/app-storage/
├── pdfs/
│   ├── quick_quotes/
│   │   ├── 2026/
│   │   │   ├── 05/
│   │   │   │   ├── QQ-2026-0001.pdf
│   │   │   │   └── ...
│   ├── invoices/  (if generated locally — future)
├── uploads/
│   ├── logos/
│   ├── signatures/
├── backups/
└── temp/
```

**Backup:** PDF folder backed up daily along with database
**Phase 2:** Migrate to S3-compatible storage when scaling

---

### Q3.3 — Environment Strategy

**Decision:** ✅ **2 environments for Phase 1 — Dev + Production**

- **Dev:** Localhost (Docker Compose for Postgres + Redis + App)
- **Production:** Self-hosted server (when ready to launch)

**Staging skipped:** Phase 1 doesn't need separate staging; Dev → Production direct with feature flags for gradual rollout

**Phase 2:** Add staging when team grows beyond 1-2 developers

---

### Q3.4 — CI/CD Pipeline

**Decision:** ✅ **Git-based deployment with manual production push**

**Approach for Self-Hosted:**
1. **Development:** Push to GitHub `develop` branch
2. **Production:** 
   - Pull `main` branch on server
   - Run `npm run build` + `prisma migrate deploy`
   - PM2 restart application
   - Simple bash script: `./deploy.sh`

**Phase 2:** GitHub Actions for automated deployment via SSH webhook

---

### Q3.5 — Database Backups

**Decision:** ✅ **Self-hosted backup strategy**

**Schedule:**
- **Daily 2 AM:** `pg_dump` to local `/var/app-storage/backups/`
- **Weekly Sunday:** Sync to external drive or Google Drive (offsite copy)
- **Monthly:** Manual verification — restore test on separate machine

**Retention:** 
- Daily: 30 days
- Weekly: 12 weeks
- Monthly: 12 months

**Implementation:** Cron job + simple shell script

---

### Q3.6 — Secret Management

**Decision:** ✅ **`.env` file with strict file permissions + encryption at rest**

**Approach for Self-Hosted:**
- `.env.production` file (chmod 600, owned by app user)
- Never committed to Git (`.gitignore`)
- Critical secrets (OAuth tokens, encryption keys) also encrypted in DB
- Backup `.env` securely offsite

**Phase 2:** HashiCorp Vault or Doppler when team grows

---

## Section 4: Zoho Integration Decisions

### Q4.1 — Initial Org Onboarding

**Decision:** ✅ **Manual OAuth flow per org**

**Process:**
1. Admin goes to Settings → Organizations
2. Clicks "Connect Zoho" for each org
3. Redirects to Zoho OAuth consent page
4. Callback stores encrypted tokens
5. Repeat for all 4 orgs

---

### Q4.2 — Zoho Sandbox / Testing Strategy

**Decision:** ✅ **Use Zoho Books trial organization for dev/staging**

**Rationale:**
- Zoho doesn't have proper sandbox, but trial orgs are full-featured
- Create 1 trial org for development
- Create 1 trial org for staging
- Production uses real 4 orgs

---

### Q4.3 — Custom Field Setup in Zoho

**Decision:** ✅ **Documented manual setup checklist per org**

**Fields to create in each Zoho org:**

| Field Name | API Name | Type | Modules |
|---|---|---|---|
| Central Quote ID | `cf_central_quote_id` | Text | Estimate |
| Central Lead ID | `cf_central_lead_id` | Text | Contact |
| Central Subscription ID | `cf_central_subscription_id` | Text | Estimate, Invoice |
| Domain Name | `cf_domain_name` | Text | Contact, Estimate, Invoice |
| Business Type | `cf_business_type` | Dropdown | Estimate, Invoice |

**Provide:** Step-by-step manual setup guide in `02_ZOHO_INTEGRATION_SPEC.md`

---

### Q4.4 — Webhook Failure Handling

**Decision:** ✅ **5 retries with exponential backoff, then DLQ + admin alert**

**Retry intervals:** 1min → 5min → 30min → 2hr → 24hr
**After 5 failures:** Move to dead-letter queue, admin email alert

---

### Q4.5 — API Rate Limit Handling

**Decision:** ✅ **Token bucket per Zoho org with built-in backoff**

**Limits:**
- Zoho Books API: 100 calls/min per org (Zoho's limit)
- Our throttle: 80 calls/min (20% buffer)
- On 429 response: exponential backoff, max 30s wait

---

### Q4.6 — Customer / Item Sync Frequency

**Decision:** ✅ **Webhook-based real-time + daily backup full-sync at 3 AM IST**

---

## Section 5: Settings / Behavior Decisions

### Q5.1 — Quote Number Format

**Decision:** ✅ **`QQ-YYYY-NNNN` (e.g., QQ-2026-0001)**

**Resets:** Annual sequence reset (every Jan 1, sequence restarts at 0001)

**Configurable:** Yes, in settings

---

### Q5.2 — Lead Number Format

**Decision:** ✅ **`LD-YYYY-NNNN`**

---

### Q5.3 — Subscription Number Format

**Decision:** ✅ **`SUB-YYYY-NNNN`**

---

### Q5.4 — Default GST Rate

**Decision:** ✅ **18%** (Indian standard for IT services / SaaS)

---

### Q5.5 — Tax Inclusive vs Exclusive

**Decision:** ✅ **Exclusive (tax shown separately)** — Indian B2B standard

---

### Q5.6 — Currency

**Decision:** ✅ **INR only for Phase 1**

**Phase 2:** Multi-currency with USD/EUR support when international customers added

---

### Q5.7 — Time Zone

**Decision:** ✅ **IST (Asia/Kolkata)** for all displays and timestamps

**Storage:** UTC in database, IST in UI

---

### Q5.8 — Date Format

**Decision:** ✅ **DD/MM/YYYY** (Indian standard)

---

### Q5.9 — Pro-rata Calculation Method

**Decision:** ✅ **Daily rate × period days × additional licenses**

**Formula:**
```
daily_rate = subscription_price / billing_cycle_days
prorata_amount = daily_rate × (subscription.end_date - effective_date) × additional_licenses
```

**Rounding:** 2 decimal places

---

### Q5.10 — Public Quote Token Expiry

**Decision:** ✅ **30 days from quote send**

**Rationale:** Validity is 15 days but token lasts 30 days for grace period and reference

---

## Section 6: Security Decisions

### Q6.1 — OAuth Token Storage

**Decision:** ✅ **AES-256 encryption at application layer before DB storage**

**Encryption key:** Stored in environment variables / secrets manager

---

### Q6.2 — Public Quote Token

**Decision:** ✅ **Signed JWT, 128-character random string**

**Validations:**
- Signature verification
- Expiry check
- Single-quote scope
- Rate-limited endpoint (10 requests/minute per token)

---

### Q6.3 — Password Policy (Admin Users)

**Decision:** ✅ **Minimum 12 characters, complexity not enforced (modern best practice)**

**Phase 2:** Add 2FA enforcement option

---

### Q6.4 — Session Management

**Decision:** ✅ **30-day rolling session (NextAuth default)**

**Idle timeout:** 24 hours of inactivity

---

### Q6.5 — Audit Logging

**Decision:** ✅ **Phase 1: Console + Sentry; Phase 2: Dedicated audit_logs table**

**Phase 1 logged actions:**
- Lead conversion (success/failure)
- Quote generation (Quick Quote + Renewal + Pro-rata)
- Zoho OAuth connect/disconnect
- Settings changes (critical only)

---

## Section 7: Out-of-Scope Confirmations

ये features Phase 1 में नहीं होंगी (PRD में Out of Scope listed हैं, यहाँ re-confirmed):

| Feature | Phase |
|---|---|
| Multi-user roles | Phase 2 |
| Customer self-service portal | Phase 2 |
| Auto-renewal (without manual click) | Phase 2 |
| Customer-specific pricing rules | Phase 2 |
| Discount / coupon engine | Phase 2 |
| Refund / credit note workflows | Phase 3 |
| Payment gateway integration | Phase 3 |
| Vendor side tracking | Phase 3 |
| WhatsApp / SMS | Phase 3 |
| Multi-currency | Phase 2 |
| CRM activity tracking | Phase 3 |
| MRR / churn analytics | Phase 2 |

---

## Summary — All Decisions Confirmed

सभी open questions अब finalized हैं। Key stakeholder confirmations:

| # | Decision | Final Choice |
|---|---|---|
| Q2.8 | Email Service | ✅ **Google Workspace SMTP** |
| Q3.1 | Hosting Platform | ✅ **Self-Hosted (Localhost first)** |
| Q3.2 | File Storage | ✅ Local disk with backups |
| Q3.3 | Environments | ✅ Dev + Production (no staging Phase 1) |
| Q3.4 | CI/CD | ✅ Manual git-based deployment |
| Q3.5 | Backups | ✅ pg_dump + offsite weekly sync |

**Status:** ✅ All decisions finalized. Ready to proceed to Deliverable 2 (Zoho Integration Spec).

---

## What Changes if You Disagree on Any Decision

हर decision का **implementation impact** documented है। Decision change करने पर:

- **Q1.1 - Q1.10 (Business decisions):** Settings में adjustable, no code change
- **Q2.1 - Q2.14 (Tech stack):** Code-level change, but documented for any swap
- **Q3.1 - Q3.6 (Infrastructure):** Deployment config change only
- **Q4.1 - Q4.6 (Zoho):** Setup process change
- **Q5.1 - Q5.10 (Settings defaults):** All editable via Settings UI
- **Q6.1 - Q6.5 (Security):** Code-level, but core architecture supports flexibility

---

**End of Document — Resolution v1.0**
**Next Deliverable:** `02_ZOHO_INTEGRATION_SPEC.md`
