# Subscription Management Tool — PRD v4.1

**Document Version:** 4.1
**Date:** 29 June 2026
**Status:** Active — supersedes v4.0
**Author:** Hitesh (Excel Technologies)
**Last Updated By:** Antigravity AI (based on Claude Code build history analysis)

**What's new in v4.1 vs v4.0:**
- **Build status updated** — Sprint 1–5 actual completion status documented (Sections 5A.8 और 11)
- **Schema updates** — `leads` table में `gst_treatment` column add, `quick_quote_items` में `cost_price` field
- **New API endpoints documented** — `POST /leads/:id/sync-to-zoho`, `POST /organizations/:orgId/customers/:zohoId/sync`, `POST /conversions/quote/:id`
- **Section 10 expanded** — Invoice line-item custom fields (4 नए `invoice_item` entity fields) documented
- **New Section 15A** — Critical Zoho API Technical Discoveries (production-verified gotchas)
- **New Section 15B** — GST Sync Feature Specification (pending implementation)
- **Open Questions (Section 15)** — resolved questions marked
- **Email template list updated** — `payment_received` removed (Zoho handles it), 9 templates remain

**What's new in v4.0 vs v3.0:**
- **Quick Quote module simplified and unified** — single interface for both existing customers और new customers (leads)
- Customer type selection (radio toggle) at quote creation
- Two backend paths but same UX
- Schema updated: `quick_quotes` table now supports both lead-based और direct customer-based quotes
- **NEW (v4.0 clarification):** Four distinct quote types explicitly documented — Lead Quote, Cross-sell Quote, Renewal Quote, Pro-rata Quote — flowing through two modules (Quick Quote vs Subscription)
- **NEW (v4.0 addition):** Comprehensive Settings & Configuration Management section (Section 5A) — 13 categories of admin-configurable behavior, MVP vs Phase 2 scoping
- Cleaner, shorter, more focused PRD

---

## 1. Executive Summary

Central Application जो Zoho Books के साथ काम करके तीन काम करेगी:

1. **Quick Quote Module** — किसी भी customer (existing या new) को 2-3 minutes में professional quote भेजना
2. **Subscription Lifecycle Management** — renewal alerts, pro-rata, expiry tracking
3. **Cross-Org Unified View** — चारों Zoho Books orgs का एक dashboard

**Guiding Philosophy:**

> **Zoho Books = master for paying customers + accounting**
> **Central App = quote builder + subscription brain + lead management**

Zoho में सिर्फ वो customers जाएंगे जिन्होंने deal close किया है। Unconverted leads Central App में ही रहेंगे, ताकि Zoho customer master clean रहे।

---

## 2. Business Context

**Excel Technologies** — B2B Cloud / SaaS Reseller (Google Workspace, Microsoft 365, etc.) — चार Zoho Books orgs में distributed।

### Three Current Pain Points

1. **Subscription tracking manual है** — कौन सी कब expire हो रही है, manually track होता है
2. **Zoho customer master pollution** — हर prospect को quote भेजने के लिए Zoho में customer add करना पड़ता है, जिससे dead leads भी permanent record बन जाते हैं
3. **Cross-org silos** — 4 orgs में data बंटा, unified search नहीं

---

## 3. Core Architectural Principles

### 3.1 What Lives Where

| Concern | Lives in |
|---|---|
| Paying customer master | **Zoho Books** |
| Item / Product master | **Zoho Books** |
| Final tax invoice | **Zoho Books** |
| Payment recording | **Zoho Books** |
| GST / tax accounting | **Zoho Books** |
| **Leads / Prospects** | **Central App** |
| **Quick Quotes (drafts + lead-based)** | **Central App** |
| **Subscription master** | **Central App** |
| Domain ↔ Customer ↔ Org mapping | **Central App** |
| Renewal scheduling & alerts | **Central App** |
| Pro-rata calculation | **Central App** |

### 3.2 Customer Hygiene Boundary

```
LEAD (Central only) ──────[on quote accept]──────► CUSTOMER (Zoho)
                                                        │
EXISTING CUSTOMER (Zoho) ◄──────[direct quote]──────────┘
```

- New प्रोस्पेक्ट को quote भेजना है? → Lead बनाओ, quote Central में रहेगी
- Existing customer को quote भेजना है? → Zoho cache से select करो, quote सीधे Zoho में Estimate बने
- Lead accept करे तभी Zoho में customer create हो

### 3.3 Four Quote Types in the System (Critical Clarification)

System में 4 distinct quote scenarios हैं, जो **2 अलग modules** से flow करते हैं:

| # | Quote Type | Trigger Point | Customer | Pre-fill | Storage | Linked to Existing Subscription? |
|---|---|---|---|---|---|---|
| 1 | **Lead Quote** | Quick Quote → "New Customer" | Lead (Central only) | Manual entry | `quick_quotes` | No (sub created on conversion) |
| 2 | **Cross-sell Quote** | Quick Quote → "Existing Customer" | Zoho customer | Customer auto-filled | `quick_quotes` | No (new sub created on invoice paid) |
| 3 | **Renewal Quote** | Subscription detail → "Renew & Customize" or "Direct Renew" | Zoho customer (existing sub) | **Auto-prefilled** from subscription with new dates | `quick_quotes` (draft) / `renewal_history` (on paid) | **Yes — extends existing subscription** |
| 4 | **Pro-rata Quote** | Subscription detail → "Pro-rata" | Zoho customer (existing sub) | **Auto-prefilled** from subscription with partial period | `renewal_history` | **Yes — adds quantity to existing sub** |

#### Module Responsibilities

- **Quick Quote Module** → Quote Types **1 & 2** (Fresh Sales)
  - "मैं कुछ नया बेच रहा हूं" — sales motion
  - कोई existing subscription context नहीं
  - New customer (Lead) या existing customer को नया product
  
- **Subscription Module** → Quote Types **3 & 4** (Lifecycle Operations)
  - "Existing relationship maintain कर रहा हूं" — account management motion
  - Existing subscription is the starting context
  - Renewal या mid-cycle license addition

#### Shared Quote Builder UI Component

सभी 4 quote types **same Quote Builder UI** use करते हैं — UX consistent रखने के लिए। Only the pre-fill data और backend storage differ:

| Type | Pre-fill Source | Backend Storage |
|---|---|---|
| 1 — Lead | Manual entry of all fields | `quick_quotes` + `quick_quote_items` |
| 2 — Cross-sell | Customer pre-filled from Zoho cache; line items fresh | `quick_quotes` + `quick_quote_items` |
| 3 — Renewal | Customer + item + new dates pre-filled from existing subscription | `quick_quotes` draft → `renewal_history` on paid (linked to subscription) |
| 4 — Pro-rata | Customer + item + partial period rate pre-filled from existing subscription | `renewal_history` (linked to subscription) |

#### Zoho Side — All Four Create Estimates (Distinguished by Custom Fields)

Zoho में चारों quote types **Estimate document** ही बनाते हैं। Central App identification custom fields से होती है:

```
Lead Quote (Type 1) & Cross-sell Quote (Type 2):
   cf_central_quote_id = "<quick_quote UUID>"
   cf_central_subscription_id = (empty — no existing sub)

Renewal Quote (Type 3):
   cf_central_quote_id = (empty)
   cf_central_subscription_id = "<existing subscription UUID>"
   cf_business_type = "Renewal"

Pro-rata Quote (Type 4):
   cf_central_quote_id = (empty)
   cf_central_subscription_id = "<existing subscription UUID>"
   cf_business_type = "Pro-rata"
```

#### UI Trigger Points

| Starting Point in UI | Quote Type Triggered |
|---|---|
| **Subscriptions Dashboard** → row "Renew" action | Type 3: Renewal |
| **Subscription detail page** → "Renew" button | Type 3: Renewal |
| **Subscription detail page** → "Pro-rata" button | Type 4: Pro-rata |
| **Customer detail page** → "Send New Quote" | Type 2: Cross-sell |
| **Top nav** → "+ New Quote" | Type 1 or 2 (user chooses) |
| **Lead detail page** → "Send Quote" | Type 1: Lead |
| **Subscriptions Dashboard** → bulk "Renew Selected" | Type 3: Multiple Renewals |

#### Post-Acceptance Behavior — Subscription Impact

| Quote Type | When Customer Pays Invoice |
|---|---|
| Type 1 (Lead) | Lead converted to Zoho customer + **new** subscription created |
| Type 2 (Cross-sell) | **New** subscription created (additional to existing) |
| Type 3 (Renewal) | **Existing** subscription dates extended, last_invoice updated |
| Type 4 (Pro-rata) | **Existing** subscription quantity increased; dates **NOT** changed |

---

## 4. Unified Quick Quote Module (Quote Types 1 & 2 — Fresh Sales)

> **Scope clarification:** यह module सिर्फ **fresh sales** (नई selling motion) के लिए है — चाहे new customer (Lead) हो या existing customer को नया product/service बेचना हो।
>
> **यह module Renewal या Pro-rata नहीं handle करता।** उनके लिए Subscription Module use होगा (देखें Section 8A)।
>
> Quote Builder UI component सभी 4 quote types में shared है — सिर्फ pre-fill data और backend storage अलग है।

### 4.1 Single Interface, Two Paths

Quick Quote create करते समय user **पहले step में choose करेगा** कि quote किसके लिए है:

```
┌─────────────────────────────────────────────┐
│  NEW QUICK QUOTE                            │
├─────────────────────────────────────────────┤
│  Quote for:                                  │
│    ( ● ) Existing Customer                   │
│    (   ) New Customer / Lead                 │
│                                              │
│  [search and select customer ▼]              │
│  → Acme Corporation (Zoho Org-2)             │
│  → GST: 27AAAPL1234C1Z5                      │
│  → Email: billing@acme.com                   │
└─────────────────────────────────────────────┘
```

**Mode A — Existing Customer:**
- Customer पहले से Zoho में है, इसलिए customer creation skip
- Quote build करो → "Send" पर सीधे Zoho में Estimate बनेगा
- Zoho का PDF + email infrastructure use होगा
- Status webhook से Central में update होगा

**Mode B — New Customer / Lead:**
- Lead Central में बने (inline form या pre-existing lead select)
- Quote build करो → "Send" पर Central PDF generate + public link email
- Zoho touch नहीं होगा जब तक lead accept न करे
- Accept करने पर → conversion (lead → Zoho customer + quote → Zoho Estimate)

### 4.2 Quote Builder UI (Same for Both Modes)

```
┌─────────────────────────────────────────────┐
│  Quote Number: QQ-2026-0042 (auto)          │
│  Quote Date: 14 May 2026                     │
│  Valid Until: 29 May 2026 (15 days)         │
│                                              │
│  CUSTOMER                                    │
│  [Existing ⦿] [New Customer ⦾]               │
│  [Customer details auto-filled or form]      │
│                                              │
│  LINE ITEMS                                  │
│  ┌──────────────────────────────────────┐   │
│  │ Item │ Qty │ Rate │ Tax │ Amount    │   │
│  ├──────────────────────────────────────┤   │
│  │ Google Workspace Business Standard   │   │
│  │   acme.com │ 10 │ 750 │ 18% │ 8,850 │   │
│  │   [edit] [remove] [dates...]         │   │
│  ├──────────────────────────────────────┤   │
│  │ [+ Add Item]                          │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Subtotal:       ₹7,500                      │
│  GST (18%):      ₹1,350                      │
│  Total:          ₹8,850                      │
│                                              │
│  TERMS & CONDITIONS [editable]               │
│  NOTES TO CUSTOMER [editable]                │
│                                              │
│  [Save Draft]  [Preview PDF]  [Send Quote]   │
└─────────────────────────────────────────────┘
```

### 4.3 "Send Quote" Behavior

| Customer Type | What Happens on Send |
|---|---|
| **Existing Customer** | Zoho API call → Estimate created in customer's org → Zoho sends email (या Central can also send) → Status tracked via webhook |
| **New Customer / Lead** | Central App generates PDF → Email sent to lead with public quote link → Lead views/accepts/rejects on link → On accept, conversion triggers |

### 4.4 Lead Quote Acceptance → Conversion Flow

```
Lead opens public quote link
   ↓
Clicks "Accept"
   ↓
Quote status → "Accepted"
   ↓
Notification to sales user
   ↓
Sales clicks "Convert to Customer" (manual confirm)
   OR auto-conversion if enabled
   ↓
Atomic Conversion Job:
  1. Create Zoho Customer (target org)
  2. Create domain record
  3. Push Quote to Zoho as Estimate
  4. Create Subscription record (Pending)
  5. Update lead.status = "Converted"
   ↓
Standard subscription lifecycle starts
```

### 4.5 Why This Design is Simple

- **एक ही form** — user को दो जगह नहीं जाना
- **Customer type शुरू में decide** — बाकी फॉर्म identical
- **Backend में path अलग**, frontend identical → UX clean
- **Customer hygiene preserved** — lead जो convert नहीं हुआ वो Zoho में नहीं जाएगा

---

## 5. Other Core Features (Phase 1 MVP)

### 5.1 Subscriptions Dashboard

- Cross-org unified list of all subscriptions
- Filters: org, customer, domain, status, expiring window
- Quick actions: renewal quote, pro-rata, cancel, view in Zoho
- Color-coded renewal dates

### 5.2 Expiry Alerts & Reminders

- 60/30/15/7 days before expiry → admin emails + dashboard badges
- Auto status update: `Active → Expiring Soon → Expired`

### 5.3 Renewal Quote Generation (Quote Type 3)

- **Module:** Subscription Module (not Quick Quote)
- **Trigger:** Subscription detail page → "Renew" button, या Subscriptions Dashboard बल्क action
- For existing customer's existing subscription whose end_date approaching है
- One-click → creates Estimate in Zoho with subscription context
- **Reuses Quote Builder UI** (same component as Quick Quote), but pre-fills from existing subscription:
  - Same customer (from Zoho via subscription's zoho_customer_id)
  - Same item (from subscription)
  - New dates auto-calculated (current end_date + billing cycle)
  - `next_renewal_price` से pricing (fallback: `subscription_price`)
- **Storage:** `renewal_history` table (not `quick_quotes`)
- **Zoho linkage:** `cf_central_subscription_id` populated with existing sub UUID
- **On payment:** Subscription's end_date extends, last_invoice_* updates
- **Subscription number stays the same** — same subscription, new term

### 5.4 Pro-rata Calculator (Quote Type 4)

- **Module:** Subscription Module (not Quick Quote)
- **Trigger:** Subscription detail page → "Pro-rata" button
- For mid-cycle license additions on existing subscription
- User inputs: additional licenses count + effective date
- Auto-calculates: period days × per-license daily rate × additional licenses
- **Reuses Quote Builder UI** with partial-period pricing pre-fill
- **Storage:** `renewal_history` table with `business_type = 'Pro-rata'`
- **Zoho linkage:** `cf_central_subscription_id` + `cf_business_type = "Pro-rata"`
- **Critical rule:** Subscription's start_date / end_date **never overwritten**; only quantity adjusted on invoice payment

### 5.5 Domain Mapping View

- Domain ↔ customer ↔ org table
- Search domain → see all linked subscriptions

### 5.6 Renewal History Timeline

Per-subscription visual timeline of past quotes, invoices, payments, pro-ratas.

### 5.7 Quick Search Box (Universal)

Searches across:
- Leads (company, contact, email, domain, GSTIN)
- Quick Quotes (quote number, customer name)
- Customers (Zoho cache)
- Domains
- Subscriptions
- Zoho invoices/estimates

Result types shown with tags:
```
🟡 Lead: Acme Corp — Quoted 5 May
🟢 Customer: Acme Corporation (Org-2) — 3 active subs
🔵 Domain: acme.com
📄 Quote QQ-2026-0042 — Accepted
🧾 Invoice INV-001234 (Org-2)
```

---

## 5A. Settings & Configuration Management

Application को **user-friendly और flexible** बनाने के लिए comprehensive Settings interface। Admin और sales users यहां से application की सारी configurable behavior control कर सकेंगे, बिना developer help के।

### 5A.1 Design Principles

- **DB-backed, not .env-hardcoded** — सारी business config database में, runtime editable
- **Self-service** — admins को developer नहीं चाहिए normal config changes के लिए
- **Audit everything** — हर settings change log हो (who/when/what)
- **Test where applicable** — email test, Zoho connection test buttons
- **Defaults seeded on install** — fresh install पर sensible defaults present हों
- **Cached for performance** — Redis में low-TTL cache, frequent reads fast

### 5A.2 Settings Sidebar Structure

```
⚙️ Settings
   ├── 🏢 Organizations & Zoho Connection      [MVP]
   ├── 📄 Quick Quote Settings                 [MVP]
   ├── 🎨 PDF Branding (per Org)               [MVP]
   ├── 📧 Email Configuration                  [MVP]
   ├── 🔄 Subscription Lifecycle Rules         [MVP]
   ├── 🎯 Lead Management                      [MVP]
   ├── 💰 Tax & GST Settings                   [MVP]
   ├── 🔔 Notification Preferences             [MVP]
   ├── 📋 Master Data & Lists                  [MVP]
   ├── 👥 Users & Roles                        [Phase 2]
   ├── 🛡️ Security & Audit Logs               [Phase 2]
   ├── 🌐 Localization & Display               [Phase 2]
   └── 🩺 System Health & Diagnostics          [MVP]
```

### 5A.3 Settings Categories — Detail

#### 5A.3.1 Organizations & Zoho Connection (MVP)

- Add / Edit / Remove Zoho Books organization
- OAuth Connect / Reconnect / Disconnect per org
- Connection health indicator (token status, expiry, last sync)
- Manual sync triggers (Customers, Items, Full Sync)
- Default organization for new quotes
- Org-specific identifiers (base currency, supplier state, GSTIN)
- API rate limit override per org

#### 5A.3.2 Quick Quote Settings (MVP)

- Quote, Lead, and Subscription number formats (customizable per-organization in settings using placeholders: `{ORG}` (short name, e.g. ECA), `{FY}` (2-digit financial year, e.g. 26-27), `{YYYY}`, `{YY}`, `{NNNN}`)
- Default validity period (15 / 30 / custom days)
- Default Terms & Conditions (rich text editor, per-org override allowed)
- Default Notes to Customer (boilerplate)
- Public quote token expiry days
- Quote auto-expiry action (mark expired / send reminder)
- Quote revision behavior (archive old / keep visible)
- Default tax rate fallback (for non-catalog items)
- Maximum allowed discount percentage (cap)

#### 5A.3.3 PDF Branding — per Organization (MVP)

- Company logo upload (PNG/SVG)
- Header info: legal name, address, GSTIN, PAN, phone, email, website
- Footer text (custom message, bank details if needed)
- Brand accent color
- PDF template choice (Modern / Classic / Minimal / Compact)
- Signature / seal image upload
- Watermark options (DRAFT, DUPLICATE)
- Show/hide sections toggle (cost price, internal notes, etc.)

#### 5A.3.4 Email Configuration (MVP) ✅ BUILT

- Email provider selection (SendGrid only — v4.1) ✅
- API key / SMTP credentials (encrypted) ✅
- From address (global or per-org) ✅
- Reply-to address ✅
- Email signature (HTML editor) ✅
- "Send Test Email" button ✅
- **Email template library** (editable, with placeholder variables) ✅
  - `quote_sent` — Quote sent to customer
  - `quote_viewed` — Quote viewed notification (to sales)
  - `quote_accepted` — Quote accepted notification
  - `renewal_reminder_60` / `renewal_reminder_30` / `renewal_reminder_15` / `renewal_reminder_7` — Renewal reminders
  - `welcome_post_conversion` — Welcome email (post-conversion)
  - `conversion_failed_admin` — Conversion failed alert (to admin)
  - ~~Payment received confirmation~~ — **REMOVED** (Zoho handles this automatically)
  - ~~Pro-rata quote notification~~ — Handled by Zoho estimate email
- Template variable helper (e.g., `{{customer_name}}`, `{{quote_number}}`) ✅
- Placeholder chip insert UI (click to insert at cursor) ✅
- HTML Source / Preview tabs ✅

> **Architecture Decision (v4.1):** Hybrid email approach — Zoho handles Estimate/Invoice/Payment emails automatically. Central App handles Lead quotes, Renewal reminders, Internal notifications. This avoids email duplication.

#### 5A.3.5 Subscription Lifecycle Rules (MVP)

- Renewal reminder schedule (customizable days before expiry)
- Reminder recipients (sales team / customer / both)
- Grace period after expiry (days subscription remains renewable)
- Auto-cancel expired subscriptions (after N days)
- Default billing cycles enabled (Monthly, Quarterly, Annual, etc.)
- Auto-renew default for new subscriptions (on/off)
- Pro-rata calculation method (daily rate / monthly rate)
- Pro-rata rounding rule
- Next renewal date calculation method
- Quote-to-invoice auto-convert behavior

#### 5A.3.6 Lead Management (MVP)

- Lead source options (custom editable list)
- Industry options (custom editable list)
- Required fields configuration (which fields mandatory at lead creation)
- Auto-archive inactive leads (after N days, default 180)
- Lost reason options (Budget, Competitor, Timing, No Decision, etc.)
- Duplicate detection rules (warn-only / block on email match)
- Default lead assignment method (manual / round-robin)
- Auto-status transitions (e.g., quote sent → "Quoted")

#### 5A.3.7 Tax & GST Settings (MVP)

- Supplier state per Zoho org (for place-of-supply determination)
- Default GST rate (18% standard)
- Available GST rates list (0%, 5%, 12%, 18%, 28%)
- HSN/SAC code defaults per item category
- Intra-state vs inter-state auto-determination rules
- Reverse charge mechanism toggle
- TCS / TDS settings for high-value transactions
- Tax-inclusive vs exclusive pricing default

#### 5A.3.8 Notification Preferences (MVP)

- Channel toggle (in-app / email; Phase 2: WhatsApp, SMS)
- Per-event toggle:
  - Quote sent / viewed / accepted / rejected
  - Renewal due reminders
  - Payment received
  - Conversion completed / failed
  - OAuth token expiring
  - Webhook processing failures
  - Daily summary digest
- Quiet hours (no notifications during specific times)
- Digest mode (real-time vs daily summary)

#### 5A.3.9 Master Data & Lists (MVP)

- Custom tags (for subscriptions, leads, quotes)
- Subscription categories (Cloud Services, Email, Backup, etc.)
- Item categories
- Currency list (with conversion rates — Phase 2)
- Country / State / City lists (with GST state codes pre-loaded for India)
- Bank account details (for invoice/quote footer)
- Predefined quote templates (quick-start for common deals)

#### 5A.3.10 Users & Roles (Phase 2)

- Add / invite users via email
- Roles: Admin, Sales, Manager, Viewer
- Custom role builder (granular permission toggles)
- User assignment (leads, subscriptions, orgs to specific users)
- Two-factor authentication enforcement
- Password policy (min length, complexity, expiry)
- Session timeout configuration
- Personal API tokens
- Per-user activity log

#### 5A.3.11 Security & Audit Logs (Phase 2)

- Login audit (successful, failed attempts, IP addresses)
- Action audit (who created/edited/deleted what, when)
- Log filtering and export (CSV / Excel)
- IP whitelist for admin actions
- Audit log retention period (1 year / 2 years / indefinite)
- Sensitive action re-auth requirements
- Data export access controls

#### 5A.3.12 Localization & Display (Phase 2)

- Time zone (IST default, user override)
- Date format (DD/MM/YYYY, MM-DD-YYYY, YYYY-MM-DD)
- Number format (Indian lakhs vs international)
- Currency display format
- Language (English / Hindi planned)
- Theme (Light / Dark / System)
- Sidebar density (Comfortable / Compact)
- Default landing page

#### 5A.3.13 System Health & Diagnostics (MVP)

- Zoho connection status dashboard (live status per org)
- Sync status (last sync time, customer/item counts per org)
- Background job queue (pending / processing / failed counts)
- Failed jobs replay interface
- Webhook event log (recent events, processing status)
- Error logs viewer (recent application errors with details)
- API rate limit usage per org
- Database statistics (record counts per table)
- Cache statistics (Redis hit rate, stale records)
- System version info (app version, schema version, last deploy)

### 5A.4 Per-User Profile Settings (Top-Right Menu)

Settings page से अलग, हर logged-in user के लिए quick-access menu:

- Personal info (name, email, phone, profile picture)
- Default views / filters (e.g., "Show only my leads")
- Personal email signature
- Notification preferences (subset of 5A.3.8)
- Password change
- Theme preference

### 5A.5 Schema Impact — Additional Tables

Settings के लिए **5 नई tables** add होंगी (schema में currently नहीं हैं):

| Table | Purpose | Phase |
|---|---|---|
| `app_settings` | Global key-value settings (singleton-style or key-value pairs) | MVP |
| `org_settings` | Per-organization settings + branding (FK to organizations) | MVP |
| `email_templates` | Customizable email templates per event type | MVP |
| `master_data_lists` | Custom dropdown lists (lead sources, industries, tags, etc.) | MVP |
| `user_preferences` | Per-user UI preferences (requires `users` table) | Phase 2 |

Plus, `settings_audit_log` table (या existing audit infrastructure) for tracking changes.

**Design hints:**

- JSONB columns flexibility देंगे — नए settings add करने के लिए frequent schema migration की जरूरत नहीं
- Critical settings (Zoho OAuth, email credentials) encrypted at application layer
- Caching layer (Redis) — settings frequently read, rarely written

### 5A.6 API Endpoints (Settings)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/settings` | Get all settings (grouped by category) |
| GET | `/api/settings/:category` | Get specific category |
| PATCH | `/api/settings/:category` | Update settings in a category |
| POST | `/api/settings/test-email` | Send test email |
| POST | `/api/settings/test-zoho-connection/:orgId` | Test Zoho API connection |
| GET | `/api/settings/email-templates` | List email templates |
| PATCH | `/api/settings/email-templates/:id` | Update email template |
| GET | `/api/settings/master-data/:listType` | Get a custom list |
| PATCH | `/api/settings/master-data/:listType` | Update custom list items |
| GET | `/api/settings/audit-log` | Settings change history |
| GET | `/api/settings/system-health` | System health metrics |

### 5A.7 MVP Scope vs Phase 2

**MVP Categories (Phase 1, Weeks 1–8):**
1. Organizations & Zoho Connection
2. Quick Quote Settings
3. PDF Branding (per org)
4. Email Configuration
5. Tax & GST Settings
6. Subscription Lifecycle Rules
7. Lead Management
8. Notification Preferences (basic, admin-level only)
9. Master Data & Lists
10. System Health Dashboard

**Phase 2 Categories:**
- Users & Roles management
- Advanced Security & Audit
- Localization & Display
- Per-user preferences

### 5A.8 Implementation Priority (within MVP)

Settings categories का development order Phase 1 के अंदर:

| Sprint | Settings to Build | Why First | Status |
|---|---|---|---|
| Week 1–2 | Organizations & Zoho Connection | Foundation — कुछ भी काम नहीं करेगा बिना इसके | ✅ **COMPLETE** |
| Week 3 | Email Configuration | Quote send करने के लिए जरूरी | ✅ **COMPLETE** |
| Week 4 | PDF Branding | Quick Quote PDF का look-and-feel | ✅ **COMPLETE** |
| Week 5 | Quick Quote defaults + Tax & GST | Quote generation logic depend करती है | ✅ **COMPLETE** (Quote builder + Zoho push) |
| Week 6 | Lead Management + Master Data | Lead lifecycle smooth करने के लिए | 🔄 **~80% DONE** (GST sync pending) |
| Week 7 | Subscription Lifecycle Rules | Renewal automation activate करने के लिए | 🔜 **NOT STARTED** |
| Week 8 | Notifications + System Health | Operational visibility और alerts | 🔜 **NOT STARTED** |
| Phase 2 | Users & Roles + Security & Audit Logs | Access management and compliance | ✅ **COMPLETE** |

> **v4.1 Note:** Week 5 में Quick Quote + Lead Management दोनों mostly complete हुए। Customer module (Zoho sync, import) भी Week 5-6 में build हुआ।

---

## 6. Database Schema (10 Core Tables + 5 Settings Tables Planned)

> **Note:** Section 6 currently documents the 10 core business tables. Settings-related tables (`app_settings`, `org_settings`, `email_templates`, `master_data_lists`, `user_preferences`) are referenced in Section 5A.5 and will be added in a separate schema addendum during implementation.

### 6.1 `organizations`

```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    zoho_org_id VARCHAR(50) NOT NULL UNIQUE,
    data_center VARCHAR(20) DEFAULT 'in',
    base_currency VARCHAR(10) DEFAULT 'INR',
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT,
    connection_status VARCHAR(30) DEFAULT 'active',
    last_sync_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.2 `leads` — For New Customers Only

```sql
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_number VARCHAR(50) NOT NULL UNIQUE,  -- LD-2026-0001

    company_name VARCHAR(250) NOT NULL,
    contact_name VARCHAR(200),
    email VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    designation VARCHAR(100),

    billing_address_line1 VARCHAR(250),
    billing_address_line2 VARCHAR(250),
    city VARCHAR(100),
    state VARCHAR(100),          -- Zoho Books state name (e.g., "Maharashtra")
    state_code VARCHAR(10),      -- GST state code (e.g., "MH")
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'India',

    gstin VARCHAR(30),
    pan VARCHAR(30),
    gst_treatment VARCHAR(50),   -- ✅ v4.1 ADDED: e.g., 'business_gst', 'consumer', 'overseas', 'business_none'

    primary_domain VARCHAR(255),
    industry VARCHAR(100),
    lead_source VARCHAR(100),

    status VARCHAR(30) NOT NULL DEFAULT 'New',
    assigned_to_user_id UUID,
    estimated_close_date DATE,
    estimated_value NUMERIC(12,2),

    converted_to_zoho_customer_id VARCHAR(80),
    converted_at TIMESTAMPTZ,
    target_organization_id UUID REFERENCES organizations(id),
    lost_reason VARCHAR(250),

    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_search ON leads USING gin(
    to_tsvector('english',
        coalesce(company_name,'') || ' ' ||
        coalesce(contact_name,'') || ' ' ||
        coalesce(email,'') || ' ' ||
        coalesce(primary_domain,'')
    )
);
```

**Lead `status`:** New, Contacted, Quoted, Negotiating, Won, Converted, Lost, Archived

### 6.3 `quick_quotes` — Unified for Both Modes

```sql
CREATE TABLE quick_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number VARCHAR(50) NOT NULL UNIQUE,  -- QQ-2026-0001

    -- Customer type: 'lead' or 'existing'
    customer_type VARCHAR(20) NOT NULL,

    -- For Mode B (Lead): reference to leads table
    lead_id UUID REFERENCES leads(id),

    -- For Mode A (Existing): direct Zoho reference
    zoho_customer_id VARCHAR(80),
    zoho_customer_name VARCHAR(250),

    -- Target org (resolved in both modes)
    target_organization_id UUID NOT NULL REFERENCES organizations(id),

    -- Quote details
    quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
    validity_days INTEGER DEFAULT 15,
    expiry_date DATE NOT NULL,

    -- Pricing
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) DEFAULT 0,
    tax_amount NUMERIC(12,2) DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'INR',

    -- Tax breakdown (India GST context)
    is_intra_state BOOLEAN,
    cgst_rate NUMERIC(5,2),
    sgst_rate NUMERIC(5,2),
    igst_rate NUMERIC(5,2),

    -- Lifecycle
    status VARCHAR(30) NOT NULL DEFAULT 'Draft',
    sent_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    view_count INTEGER DEFAULT 0,
    accepted_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,

    -- Public access (Mode B only)
    public_token VARCHAR(128) UNIQUE,
    public_token_expires_at TIMESTAMPTZ,

    -- Content
    terms_and_conditions TEXT,
    notes_to_customer TEXT,
    internal_notes TEXT,

    -- Revisions
    revision_of_quote_id UUID REFERENCES quick_quotes(id),

    -- Zoho integration (set after push)
    zoho_estimate_id VARCHAR(80),
    zoho_estimate_number VARCHAR(80),
    pushed_to_zoho_at TIMESTAMPTZ,

    -- PDF
    pdf_storage_path TEXT,
    pdf_generated_at TIMESTAMPTZ,

    created_by_user_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_customer_ref CHECK (
        (customer_type = 'lead' AND lead_id IS NOT NULL AND zoho_customer_id IS NULL)
        OR
        (customer_type = 'existing' AND zoho_customer_id IS NOT NULL AND lead_id IS NULL)
    )
);

CREATE INDEX idx_qq_lead ON quick_quotes(lead_id);
CREATE INDEX idx_qq_zoho_customer ON quick_quotes(zoho_customer_id);
CREATE INDEX idx_qq_status ON quick_quotes(status);
CREATE INDEX idx_qq_public_token ON quick_quotes(public_token);
```

**Quote `status`:** Draft, Sent, Viewed, Accepted, Rejected, Expired, Revised, Pushed_To_Zoho

### 6.4 `quick_quote_items`

```sql
CREATE TABLE quick_quote_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quick_quote_id UUID NOT NULL REFERENCES quick_quotes(id) ON DELETE CASCADE,
    line_order INTEGER NOT NULL,

    zoho_item_id VARCHAR(80),
    item_name VARCHAR(250) NOT NULL,
    item_description TEXT,
    hsn_or_sac VARCHAR(20),

    quantity NUMERIC(12,2) NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    discount_percent NUMERIC(5,2) DEFAULT 0,
    discount_amount NUMERIC(12,2) DEFAULT 0,
    tax_rate NUMERIC(5,2) DEFAULT 18,
    line_subtotal NUMERIC(12,2) NOT NULL,
    line_tax NUMERIC(12,2) DEFAULT 0,
    line_total NUMERIC(12,2) NOT NULL,

    -- Subscription context (used at push/conversion)
    is_subscription BOOLEAN DEFAULT TRUE,
    billing_cycle VARCHAR(50),
    service_start_date DATE,
    service_end_date DATE,
    primary_domain VARCHAR(255),
    cost_price NUMERIC(12,2) DEFAULT 0,  -- ✅ v4.1 ADDED: Cost price for margin tracking; maps to cf_cost_price in Zoho invoice_item

    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.5 `domains`

```sql
CREATE TABLE domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    zoho_customer_id VARCHAR(80) NOT NULL,
    zoho_customer_name VARCHAR(250),
    status VARCHAR(30) DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.6 `subscriptions`

```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_number VARCHAR(50) NOT NULL UNIQUE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    domain_id UUID NOT NULL REFERENCES domains(id),
    zoho_customer_id VARCHAR(80) NOT NULL,
    zoho_customer_name VARCHAR(250),
    zoho_item_id VARCHAR(80) NOT NULL,
    zoho_item_name VARCHAR(250),

    -- Origin tracking
    origin_lead_id UUID REFERENCES leads(id),
    origin_quick_quote_id UUID REFERENCES quick_quotes(id),

    quantity NUMERIC(12,2) NOT NULL,
    subscription_price NUMERIC(12,2) NOT NULL,
    next_renewal_price NUMERIC(12,2),
    cost_price NUMERIC(12,2) DEFAULT 0,
    billing_cycle VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    next_renewal_date DATE,
    auto_renew BOOLEAN DEFAULT FALSE,

    lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
    process_status VARCHAR(30) NOT NULL DEFAULT 'None',
    business_type VARCHAR(30) DEFAULT 'Renewal',

    last_quote_id VARCHAR(80),
    last_quote_number VARCHAR(80),
    last_quote_date DATE,
    last_invoice_id VARCHAR(80),
    last_invoice_number VARCHAR(80),
    last_invoice_date DATE,

    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subs_renewal_date ON subscriptions(next_renewal_date) WHERE lifecycle_status = 'Active';
CREATE INDEX idx_subs_org_status ON subscriptions(organization_id, lifecycle_status);
```

### 6.7 `renewal_history`

```sql
CREATE TABLE renewal_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    domain_id UUID NOT NULL REFERENCES domains(id),
    business_type VARCHAR(30) NOT NULL,
    billing_cycle VARCHAR(50),
    service_start_date DATE,
    service_end_date DATE,
    quantity NUMERIC(12,2),
    selling_price NUMERIC(12,2),
    cost_price NUMERIC(12,2),
    subtotal_amount NUMERIC(12,2),
    renewal_status VARCHAR(30) NOT NULL DEFAULT 'Quoted',
    quote_id VARCHAR(80),
    quote_number VARCHAR(80),
    quote_date DATE,
    invoice_id VARCHAR(80),
    invoice_number VARCHAR(80),
    invoice_date DATE,
    payment_id VARCHAR(80),
    payment_date DATE,
    raw_quote_payload JSONB,
    raw_invoice_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.8 `zoho_cache`

```sql
CREATE TABLE zoho_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    entity_type VARCHAR(20) NOT NULL,  -- 'customer' or 'item'
    zoho_id VARCHAR(80) NOT NULL,
    display_name VARCHAR(250),
    email VARCHAR(200),
    phone VARCHAR(50),
    gstin VARCHAR(30),
    extra JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, entity_type, zoho_id)
);

CREATE INDEX idx_cache_search ON zoho_cache USING gin(
    to_tsvector('english',
        coalesce(display_name,'') || ' ' ||
        coalesce(email,'') || ' ' ||
        coalesce(gstin,'')
    )
);
```

### 6.9 `webhook_events`

```sql
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    event_type VARCHAR(100),
    zoho_entity_id VARCHAR(80),
    event_hash VARCHAR(128) UNIQUE,
    payload JSONB NOT NULL,
    processing_status VARCHAR(30) DEFAULT 'pending',
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.10 `lead_conversions` (Audit)

```sql
CREATE TABLE lead_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id),
    quick_quote_id UUID REFERENCES quick_quotes(id),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    zoho_customer_id VARCHAR(80),
    zoho_estimate_id VARCHAR(80),
    zoho_estimate_number VARCHAR(80),
    subscription_ids UUID[],
    conversion_status VARCHAR(30) NOT NULL,
    error_message TEXT,
    zoho_response_payload JSONB,
    converted_by_user_id UUID,
    converted_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. API Endpoints

### 7.1 Quick Quote (Unified)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/quick-quotes` | List all (filterable by type, status) |
| POST | `/api/quick-quotes` | Create draft (specify customer_type) |
| GET | `/api/quick-quotes/:id` | Detail |
| PATCH | `/api/quick-quotes/:id` | Update (only if Draft) |
| POST | `/api/quick-quotes/:id/items` | Add line item |
| PATCH | `/api/quick-quotes/:id/items/:itemId` | Update item |
| DELETE | `/api/quick-quotes/:id/items/:itemId` | Remove item |
| POST | `/api/quick-quotes/:id/generate-pdf` | (Re)generate PDF |
| POST | `/api/quick-quotes/:id/send` | Send (behavior depends on customer_type) |
| POST | `/api/quick-quotes/:id/revise` | Create revision |
| POST | `/api/quick-quotes/:id/cancel` | Cancel |
| POST | `/api/quick-quotes/:id/push-to-zoho` | Manually push to Zoho (for Lead after acceptance) |

### 7.2 Public Quote Access (Lead-mode only)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/public/quote/:token` | Public view (no auth) |
| POST | `/api/public/quote/:token/view` | Track view |
| POST | `/api/public/quote/:token/accept` | Lead accepts |
| POST | `/api/public/quote/:token/reject` | Lead rejects |

### 7.3 Leads

| Method | Endpoint | Purpose | Status |
|---|---|---|---|
| GET | `/api/leads` | List | ✅ Built |
| POST | `/api/leads` | Create | ✅ Built |
| GET | `/api/leads/:id` | Detail + quotes | ✅ Built |
| PATCH | `/api/leads/:id` | Update (DB-only) | ✅ Built |
| POST | `/api/leads/:id/convert` | Manual conversion to Zoho customer | ✅ Built (via `/conversions/quote/:id`) |
| POST | `/api/leads/:id/mark-lost` | Mark lost | ✅ Built |
| DELETE | `/api/leads/:id` | Archive | ✅ Built |
| POST | `/api/leads/:id/sync-to-zoho` | Push lead GST/contact updates to Zoho | 🔜 Pending (GST sync feature) |

### 7.4 Customers

| Method | Endpoint | Purpose | Status |
|---|---|---|---|
| GET | `/api/customers` | Cached list (from zoho_cache) | ✅ Built |
| GET | `/api/customers/:zohoId` | Live fetch detail (cached, read-only) | ✅ Built |
| POST | `/api/organizations/:orgId/customers/sync` | Bulk import customers from Zoho | ✅ Built |
| POST | `/api/organizations/:orgId/customers/:zohoId/sync` | Single customer sync from Zoho | 🔜 Pending (GST sync feature) |

### 7.5 Items (Read-Only)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/items` | Cached list |
| GET | `/api/items/:zohoId` | Live fetch detail |

### 7.6 Subscriptions, Domains, Search, Organizations, Webhooks

(Same as v3.0 — unchanged)

---

## 8. "Send Quote" Logic — Quick Quote Module (Quote Types 1 & 2 only)

> **Note:** This section covers Quick Quote module (fresh sales). For Renewal (Type 3) और Pro-rata (Type 4), see Section 9 (Subscription module flows).

### 8.1 Mode A: Existing Customer (Quote Type 2 — Cross-sell)

```
User clicks "Send Quote"
   ↓
Validate: line items present, total > 0
   ↓
Call Zoho API: POST /estimates with quote payload
   - customer_id: zoho_customer_id
   - line_items: mapped from quick_quote_items
   - custom_fields:
       cf_central_quote_id: <UUID>
       cf_domain_name: <primary_domain>
       cf_central_subscription_id: (empty for now)
   ↓
Save zoho_estimate_id + zoho_estimate_number in quick_quotes
   ↓
Set quick_quotes.status = 'Pushed_To_Zoho'
quick_quotes.pushed_to_zoho_at = NOW()
   ↓
Trigger Zoho to email customer (या Central can send too)
   ↓
Track future status via webhooks
```

### 8.2 Mode B: New Customer / Lead (Quote Type 1)

```
User clicks "Send Quote"
   ↓
Validate: lead has email, line items present
   ↓
Generate PDF via Puppeteer (HTML template + branding)
   ↓
Store PDF (S3 or local)
   ↓
Generate signed public_token (JWT, 30-day expiry)
   ↓
Send email to lead with:
   - PDF attached
   - Public link: https://app.exceltechnologies.in/q/{token}
   ↓
Update quick_quotes.status = 'Sent'
quick_quotes.sent_at = NOW()
   ↓
Update lead.status = 'Quoted' (if was 'New' or 'Contacted')
   ↓
Wait for lead action (view/accept/reject)
```

### 8.3 On Lead Acceptance (Mode B)

```
Lead clicks Accept on public link
   ↓
quick_quotes.status = 'Accepted'
lead.status = 'Won'
   ↓
Notify sales user (dashboard + email)
   ↓
Sales clicks "Convert to Customer" (manual confirm)
   ↓
[Atomic conversion job — see Section 9]
```

---

## 8A. Subscription Module Flows — Renewal & Pro-rata (Quote Types 3 & 4)

> Quote Types 3 (Renewal) और 4 (Pro-rata) Subscription Module से flow होते हैं, Quick Quote module से नहीं। दोनों Zoho में Estimate ही बनाते हैं लेकिन existing subscription से linked रहते हैं।

### 8A.1 Renewal Quote Flow (Type 3)

```
User opens Subscription detail page (existing subscription, expiring soon)
   ↓
Clicks "Generate Renewal Quote"
   ↓
Quote Builder opens — pre-filled:
   - Customer: from subscription's zoho_customer_id (Zoho live fetch)
   - Item: from subscription's zoho_item_id
   - Quantity: from subscription (editable)
   - Service dates: current end_date + 1 day → end_date + billing_cycle
   - Price: next_renewal_price OR fallback subscription_price
   - Custom field: cf_central_subscription_id pre-set
   ↓
User reviews/edits, clicks Send
   ↓
Insert row in renewal_history (status: Quoted, business_type: Renewal)
   ↓
Zoho API → POST /estimates with:
   - customer_id, line_items, custom_fields including cf_central_subscription_id
   ↓
Save zoho_estimate_id, quote_number in renewal_history
   ↓
Update subscription.last_quote_* + process_status = "Quoted"
   ↓
Zoho sends email to customer (या Central can)
   ↓
On invoice paid (webhook):
   - renewal_history.renewal_status = "Paid"
   - subscription.end_date = new end_date
   - subscription.start_date = new start_date (renewal cycle)
   - subscription.last_invoice_* updated
   - subscription.next_renewal_date recalculated
```

### 8A.2 Pro-rata Quote Flow (Type 4)

```
User opens Subscription detail page (active subscription)
   ↓
Clicks "Generate Pro-rata Quote"
   ↓
Form: additional licenses count + effective date
   ↓
Calculator preview:
   - period_days = subscription.end_date - effective_date
   - per_license_daily_rate = subscription_price / days_in_billing_cycle
   - prorata_subtotal = period_days × per_license_daily_rate × additional_licenses
   - GST applied
   ↓
User confirms, clicks Send
   ↓
Insert row in renewal_history (status: Quoted, business_type: Pro-rata)
   ↓
Zoho API → POST /estimates with:
   - customer_id, single line item with pro-rata calculation
   - custom_fields: cf_central_subscription_id, cf_business_type = "Pro-rata"
   ↓
Save zoho_estimate_id in renewal_history
   ↓
On invoice paid (webhook):
   - renewal_history.renewal_status = "Paid"
   - subscription.quantity += additional_licenses
   - [CRITICAL] subscription.start_date / end_date UNCHANGED
   - subscription.last_invoice_* updated (but dates protected)
```

### 8A.3 Why These Use `renewal_history` and not `quick_quotes`

- These quotes are **tied to existing subscriptions** (foreign key relationship)
- They form a **chronological audit trail** of each subscription's lifecycle
- Reporting needs: "show me all renewal/pro-rata events for sub-XYZ" → single table query
- Different data shape from fresh sales (always 1 line item per sub, vs multiple in fresh quotes)
- Subscription dashboard timeline reads from `renewal_history` directly

---

## 9. Conversion Workflow (Lead → Customer) — For Quote Type 1 Only

```
Begin DB transaction
   ↓
Step 1: Zoho API → POST /contacts (create customer in target org)
   - All lead fields mapped to Zoho contact fields
   - Custom field: cf_central_lead_id
   ↓ Save zoho_customer_id
Step 2: Create `domains` record
   - domain_name = lead.primary_domain
   - organization_id, zoho_customer_id, zoho_customer_name
   ↓
Step 3: Zoho API → POST /estimates (mirror quote)
   - customer_id = newly created
   - line_items from quick_quote_items
   - Custom fields populated
   ↓ Save zoho_estimate_id in quick_quotes
Step 4: For each subscription item (is_subscription = true):
   - Create `subscriptions` row (status: Pending)
   - Link origin_lead_id, origin_quick_quote_id
   ↓
Step 5: Update lead.status = 'Converted'
        lead.converted_to_zoho_customer_id = ...
        lead.converted_at = NOW()
   ↓
Step 6: Update quick_quotes.status = 'Pushed_To_Zoho'
        quick_quotes.zoho_estimate_id = ...
   ↓
Step 7: Insert lead_conversions audit row
   ↓
Commit
   ↓
Notify success
```

**On failure:** Rollback DB, attempt Zoho cleanup, mark conversion failed, alert admin.

---

## 10. Zoho Custom Fields (Setup Required)

### 10.1 Contact / Transaction Level Fields (4 per org)

| Field | Type | Modules | Used For |
|---|---|---|---|
| `cf_central_quote_id` | Text | Estimate | Match Zoho estimate to Central quote |
| `cf_central_lead_id` | Text | Customer/Contact | Track which lead became this customer |
| `cf_central_subscription_id` | Text | Estimate, Invoice | Match to Central subscription |
| `cf_domain_name` | Text | Customer, Estimate, Invoice | Domain visible context |

### 10.2 Invoice Line-Item Fields — `invoice_item` entity ✅ v4.1 ADDED

> **Critical (v4.1):** ये 4 fields **`invoice_item`** entity पर हैं, `invoice` entity पर नहीं। Setup में entity सही select करना जरूरी है।

| Field API Name | Type | Entity | Index (Zoho) | Purpose |
|---|---|---|---|---|
| `cf_domain_name` | Text | `invoice_item` | 5 | Domain name per line item |
| `cf_subscription_start_date` | Date | `invoice_item` | 6 | Service start date |
| `cf_subscription_end_date` | Date | `invoice_item` | 7 | Service end date |
| `cf_cost_price` | Number | `invoice_item` | 8 | Cost price for margin calculation |

> **Implementation Note (v4.1):** Line-item custom fields (`line_items[].item_custom_fields`) को **`api_name`** से key करना होगा — `index` काम नहीं करता line-item level पर। Contact/transaction-level fields को `index` से key करें। यह production में verified है (INV-000035 पर end-to-end test हुआ)।

**Total: 4 transaction-level + 4 line-item-level = 8 custom fields per Zoho org.**

**Excel Cloud AI org Zoho ID:** `60066188933`

---

## 11. Implementation Roadmap (8 Weeks) — Updated v4.1

| Week | Original Plan | Actual Build | Status |
|---|---|---|---|
| **1–2** | Foundation: Next.js + Postgres + Prisma, Auth, Zoho OAuth | Organizations CRUD, Zoho OAuth full flow (connect/callback/refresh/disconnect), AES-256-GCM token encryption, Health check | ✅ **COMPLETE** |
| **3** | Sync engine: Customer + item cache, webhook scaffolding | Email Configuration (9 templates), Template editor UI, Email service with `sendFromTemplate()` | ✅ **COMPLETE** |
| **4** | Quick Quote module — UI builder, line items, both modes wiring | PDF Branding (per-org: logo, colors, bank details, watermark), OrgSettings service | ✅ **COMPLETE** |
| **5** | PDF generation + email (for lead mode), Zoho push (for existing mode) | Quick Quote Builder (both modes), State field → Zoho states, Quote edit/PDF view, Zoho push (estimate creation), Lead management | ✅ **COMPLETE** |
| **6** | Lead management + public quote view + acceptance + conversion workflow | Lead→Quote→Accept→Zoho Customer+Invoice flow, Customer module (import, bulk sync), Invoice line-item custom fields (cf_domain_name, cf_subscription_start/end_date, cf_cost_price), GST sync plan (pending) | 🔄 **~80% DONE** |
| **7** | Subscription lifecycle: dashboard, domain mapping, renewal quote, pro-rata | 🔜 NOT STARTED | 🔜 |
| **8** | Quick search, expiry alerts, polish, production deploy | 🔜 NOT STARTED | 🔜 |

> **v4.1 Note:** BullMQ background jobs (renewal reminders, daily sync, webhook retries) अभी wired नहीं हैं — Sprint 7 में जरूरी होंगे।

---

## 12. Production Safeguards

1. **Quote PDF immutable once sent** — only Revise creates new version
2. **Customer hygiene rule** — lead never reaches Zoho until accepted + converted
3. **Conversion atomic** — all-or-nothing transaction with Zoho cleanup on failure
4. **Public quote tokens** — JWT-signed, expirable, rate-limited
5. **Webhook idempotency** — event_hash unique constraint
6. **All Zoho API calls** include resolved `zoho_org_id`
7. **Pro-rata never overwrites** subscription dates
8. **Old invoices don't overwrite** newer subscription state
9. **OAuth token failures** → admin alert
10. **GST calculations recomputed** at conversion (in case state info changed)

---

## 13. Out of Scope (Phase 1)

- Multi-user team roles
- Customer self-service portal
- Auto-renewal (without manual click)
- Customer-specific pricing rules / discount engine
- Refund / credit note workflows
- Payment gateway direct integration
- Vendor side tracking
- WhatsApp / SMS
- Multi-currency advanced flows
- CRM activity tracking (calls, tasks, meetings)
- Lead pipeline Kanban view
- Advanced analytics (MRR, churn, funnel)

---

## 14. Success Metrics

| Metric | Target |
|---|---|
| Time to send first quote | < 5 minutes |
| Quote view rate (lead mode) | > 70% |
| Lead → Customer conversion rate | Track baseline |
| Zoho customer master pollution | 0% (no un-converted lead in Zoho) |
| Time saved per renewal cycle | 70% reduction |
| Missed renewals | < 2% |
| Cross-org search response | < 5 seconds |

---

## 15. Open Questions for Sign-off

| # | Question | Decision | Status |
|---|---|---|---|
| 1 | **Conversion trigger** (Mode B): Auto on lead accept, या manual sales confirmation? | Manual for Phase 1 | ✅ Resolved |
| 2 | **For Mode A (Existing Customer)**: Send email from Central या trigger Zoho's email? | Zoho's email (audit trail) | ✅ Resolved |
| 3 | **PDF generator**: Puppeteer या @react-pdf? | Puppeteer (planned) | ⏳ Not yet implemented |
| 4 | **Email service**: SendGrid / AWS SES / Postmark / Zoho Mail API? | SendGrid | ✅ Resolved |
| 5 | **Quote validity default**: 15 days या 30 days? | 15 days | ✅ Resolved |
| 6 | **Public quote URL pattern**: subdomain या path `/q/{token}`? | Path `/q/{token}` | ✅ Resolved |
| 7 | **Auto-archive leads** after N days inactivity? | 180 days (config) | ⏳ Not implemented yet |
| 8 | **Renewal reminder schedule**: 60/30/15/7 days — adjust? | Keep as-is (seeded) | ✅ Resolved |
| 9 | **Hosting**: Production target platform? | — | ❓ Open |
| 10 | **Existing customer quotes** — Central renewal_history या Zoho native? | Track in Central for unified view | ✅ Resolved |
| 11 | **GST Update flow**: Customer detail page edit form, या Open-in-Zoho link? | Open-in-Zoho link + display-only + Sync-from-Zoho button | ✅ Resolved (v4.1) |
| 12 | **Draft invoice on GST update**: Update contact only, या also update invoice? | Contact-only update | ✅ Resolved (v4.1) |

---

## 15A. Critical Zoho API Technical Discoveries (v4.1)

> ये production-verified discoveries हैं जो development के दौरान मिलीं। Future development में इन्हें ध्यान में रखें।

### 15A.1 Flat Body Rule

**Zoho Books write APIs flat body expect करती हैं।**

```typescript
// ✅ CORRECT
await zohoClient.post('/contacts', contactPayload);

// ❌ WRONG — "Invalid value passed for Customer Name" error आएगा
await zohoClient.post('/contacts', { contact: contactPayload });
```

Error misleading है — actual problem wrapping है, field value नहीं। Estimate और Subscription paths पहले से flat थे (काम कर रहे थे); Conversions service wrapped था (fix हुआ)।

### 15A.2 UTF-8 Response Decoding

**Zoho responses को explicitly UTF-8 decode करना जरूरी है।**

Axios/Node default में emoji dropdown values (e.g., `"✅ Support Paid"`) को Windows-1252 में decode करता है → double-encoded mojibake → Zoho पर write-back fail।

```typescript
// Fix in ZohoApiClient:
responseType: 'arraybuffer',
transformResponse: [(data) => JSON.parse(Buffer.from(data).toString('utf8'))]
```

**Debug tip:** `Buffer.from(value,'utf8').toString('hex')` से raw bytes check करें — terminal rendering फिर से correct दिखाती है।

### 15A.3 Line-Item Custom Fields — `api_name` Use करें

**Invoice line-item custom fields (`line_items[].item_custom_fields`) के rules अलग हैं:**

| Level | Keying Method |
|-------|---|
| Contact fields | `index` (1-10 slot) या `api_name` |
| Transaction custom fields | `api_name` |
| **Line-item fields (`invoice_item`)** | **`api_name` ONLY** — `index` काम नहीं करता |

**Gotcha:** `org_settings.metadata.custom_field_mappings.items` में stored `customfield_id` wrong entity का था (Item-master field ID, `invoice_item` entity का नहीं)। `zoho_api_name` values correct थे। इसलिए `buildCustomFields()` items module के लिए `api_name` emit करती है।

**Excel Cloud AI org item_custom_fields** (entity `invoice_item`, index 5-8):
- `cf_domain_name` (index 5)
- `cf_subscription_start_date` (index 6)
- `cf_subscription_end_date` (index 7)
- `cf_cost_price` (index 8)

**Note:** MCP Zoho tools `item_custom_fields` strip करते हैं — सिर्फ raw axios client (हमारा app) इन्हें भेज सकता है।

### 15A.4 Zoho Client Credentials Storage

**Client ID और Client Secret `.env` में नहीं — `app_settings` DB table में हैं।**
- `client_id`: plain text
- `client_secret`: encrypted (AES-256-GCM via CryptoService)

Test scripts और debugging में `.env` से credentials read मत करो — DB से decrypt करो।

---

## 15B. GST Sync Feature Specification (v4.1 — Pending Implementation)

> यह feature plan-mode में है। Implementation pending है।

### Scenario
Lead create के समय customer ने GSTIN share नहीं किया था। Invoice बनने के बाद customer ने GSTIN और GST registration details share की। अब lead edit करके Zoho में update करना है।

### User Decision (Confirmed)
- **Customer detail page**: Edit form नहीं — "Open in Zoho" link + display-only + "Sync from Zoho" button
- **Lead edit page**: "Update in Zoho" button (जब `convertedToZohoCustomerId` set हो)
- **Draft invoice**: Contact-only update (invoice re-create नहीं)

### Implementation Plan

| Section | Task | File(s) |
|---------|------|---------|
| A | Lead schema: `gst_treatment` column add | `schema.prisma`, migration |
| A | Lead DTO + actions allow-list + dropdown UI | `leads/dto`, `leads/actions.ts` |
| B | `ZohoService.updateContactDetails()` method | `zoho.service.ts` |
| C | `LeadsService.syncToZoho()` + `POST /leads/:id/sync-to-zoho` | `leads.service.ts`, `leads.controller.ts` |
| D | Lead edit page: "Update in Zoho" + "View in Zoho" buttons | `dashboard/leads/[id]/page.tsx` |
| E | Customer page: "Open in Zoho" deep-link + "Sync from Zoho" | `dashboard/customers/[zohoId]/page.tsx` |
| F | Conversion fix: `gst_treatment` at convert time | `conversions.service.ts` |

**Plan file:** `C:\Users\h23ku\.claude\plans\recursive-wiggling-liskov.md`

---

**End of Document — v4.1**
