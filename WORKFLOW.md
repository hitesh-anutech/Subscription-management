# Subscription Management Tool — Complete Workflow

**App:** Excel Technologies — Subscription Management with Zoho Books
**Stack:** NestJS API (`:3001`) + Next.js 14 (`:3000`) + PostgreSQL/Prisma
**Run:** `pnpm dev` (root) — दोनों apps parallel start होते हैं

---

## Guiding Principle

> **Zoho Books** = paying customers का master + accounting (invoices, payments, tax)
> **Central App** = lead management + quote builder + subscription brain + cross-org view

Lead तब तक Zoho में नहीं जाता जब तक deal close न हो। Unconverted leads Central App में ही रहते हैं।

---

## PART A — One-Time Setup (Admin)

### Step 1 — Organization Connect करो
```
Settings → Organizations & Zoho Connection → Add Organization
   → Name + Zoho Org ID डालो
   → "Connect Zoho" → OAuth flow → token encrypted save
   → Status: ✓ Connected
```
चारों Zoho Books orgs अलग-अलग connect होती हैं (हर org का अपना OAuth)।

### Step 2 — Custom Fields Map करो (हर org के लिए)
```
Org card → 🗂️ Item Custom Field Mapping → "Fetch Custom Fields from Zoho"
   → Zoho के Items/Invoices/Estimates/Contacts के custom fields आ जाएँगे
   → हर field [Module] Label · api_name (type) format में दिखेगा
   → Map करो:
        Domain Name            → cf_domain_name
        Subscription Start Date → cf_subscription_start_date
        Subscription End Date   → cf_subscription_end_date
        Cost Price             → cf_cost_price
   → Save Mapping
```
> App Zoho में fields **create नहीं** करता — मौजूदा fields को map करता है। यह mapping invoice import और subscription generation में use होती है।

### Step 3 — Per-Org Sender Email
```
Org card → 📧 Sender Email Config → From + Reply-To address → Save
```
हर org के नाम से अपनी email ID से quotes/emails जाएँगी।

### Step 4 — Customers + Items Sync करो
```
Org card → 🔄 Sync → Zoho से customers + items cache (zoho_cache) में आ जाएँगे
```
इससे quote builder में customer/item search काम करता है।

### Step 5 — बाकी Settings (one-time defaults)
```
Settings → Email Config (SendGrid key) · PDF Branding · Tax & GST ·
           Quick Quote defaults · Subscription Lifecycle (reminder days) ·
           Lead Management (sources/industries) · Master Data (billing cycles) ·
           Notifications · User Access (कौन user कौन सी org देखेगा)
```

---

## PART B — Fresh Sale Flow (Lead → Customer)

### Step 1 — Lead Add करो
```
Leads → New Lead
   Tab 1 — Contact:  Organization (mandatory) + Email (mandatory) +
                     Contact Name, Phone, Company Name (optional), Domain, Close Date
   Tab 2 — Address & GST:  address fields → GSTIN, GST Treatment
   Tab 3 — Other:  Industry, Lead Source, Notes
   → Create Lead
```
- **Org यहीं चुनी जाती है** — आगे quote/invoice उसी org में बनेगा।
- एक ही email से कई leads बन सकती हैं (duplicate detection setting: warn/block/allow)।

### Step 2 — Smart Next-Step
```
Lead बनते ही → "📄 Create Quote" banner दिखेगा (cursor के पास)
```

### Step 3 — Quote बनाओ
```
Quote Builder (lead से pre-filled):
   - Organization: lead से fixed (read-only)
   - Customer details: editable (company/contact/email/phone)
   - Quote Number (blank=auto) · Quote Date · Expiry (+15 days) · Reference
   - Item Table (Zoho-style):
        Item search (synced items से) → name + description + domain
        Subscription Period dropdown (default subscription; "Non-subscription" toggle)
        Cost Price · Qty · Rate · Amount
   → Create Quote (Draft)
```

### Step 4 — Quote भेजो
```
Quote detail → "Send Quote"
   Lead mode → Central PDF + public link email → customer view/accept/reject
   Lead accept → status: Accepted, lead: Won
```

### Step 5 — Convert to Customer
```
Lead detail → "Convert to Customer" (org पहले से set है)
   ↓
   1. Zoho Contact create (mapped custom fields के साथ)
   2. Domain record create
   3. Zoho INVOICE create (Estimate नहीं) — Zoho का serial invoice number
   4. Lead → Converted, Quote → Pushed_To_Zoho, audit row
   ↓
   → Subscription Creation page पर redirect
```

### Step 6 — Subscription Create करो
```
Subscription Creation page (invoice से pre-filled):
   Billing Cycle · Start Date · End Date (auto-calc, editable) · Qty · Price
   → "Create Subscription" → status: Active
```

---

## PART C — Subscription Lifecycle

### Manual Start (Pending subscription के लिए)
```
Subscription detail → "▶ Start Subscription"
   Start/End date set → Zoho में Estimate या Invoice बनाने का choice
   (payment नहीं मिली → Estimate; credit period/paid → Invoice)
   → status: Active
```

### Expiry Tracking (automatic — cron)
```
रोज़ check:
   Active → Expiring_Soon (30 days बचे)
   Expiring_Soon → Expired (date निकल गई)
Dashboard पर alerts: ❌ Expired + ⏳ Expiring in 30 days
```

### Renewal Reminders (automatic — cron)
```
60/30/15/7 days पहले → customer को reminder email (template से)
```

### Renewal Quote (Type 3)
```
Subscription detail → "Generate Renewal Quote"
   sub से pre-filled (नई dates = end+1 → +billing cycle)
   → Zoho Estimate → renewal_history (Quoted)
   → payment पर: sub dates extend, status Active
```

### Pro-rata Quote (Type 4)
```
Subscription detail → "Pro-rata Quote"
   additional licenses + effective date → live calculator
   → Zoho Estimate → renewal_history (ProRata)
   → payment पर: sub quantity बढ़े (dates UNCHANGED)
```

---

## PART D — Import Existing Subscriptions from Zoho

पुराने Zoho invoices से subscriptions बनाने के लिए (onboarding)।

```
Subscriptions → "↓ Import from Zoho"
   Step 1: Org + status + date range चुनो → "Fetch & Group Invoices"
   Step 2: Grouped preview:
        एक row = एक subscription (customer + domain + product से grouped)
        2022/23/24/25 के invoices → 1 subscription + renewal_history
        Business Type badges: 🔵 Fresh 🟢 Renewal 🟣 Pro-rata
        ⚠️ same domain+customer पर अलग product → duplicate flag (choose one)
   Step 3: Select करो → "Import Selected"
        → idempotent (दोबारा import पर duplicate नहीं)
```
- Identity natural key से बनती है: **customer + domain + product** (कोई SUB_ID नहीं चाहिए)।
- Item-level values (`item_custom_fields`) से domain/start/end/cost पढ़े जाते हैं।

---

## PART E — Cross-Org & Search

- **Dashboard** — सभी orgs के active subs, open quotes, new leads + expiry alerts
- **Subscriptions** — cross-org list, filter by org/status/expiry window
- **Domains** — domain ↔ customer ↔ org ↔ subscriptions
- **Universal Search (Ctrl+K)** — leads, quotes, subscriptions, domains, Zoho customers एक साथ
- **User Access** — admin हर user को orgs assign करता है (data isolation)

---

## Data Flow Summary

```
CENTRAL APP DB                       ZOHO BOOKS
──────────────                       ──────────
leads            ──convert──────►    contacts
quick_quotes     ──convert──────►    invoices  (Zoho serial number)
subscriptions    ──renewal/prorata►  estimates / invoices
renewal_history  ◄──webhook──────    invoices / payments
zoho_cache       ◄──sync─────────    customers + items
                 ◄──import────────   historical invoices → subscriptions
```

### Zoho Integration Points
| Trigger | Central → Zoho |
|---|---|
| Lead Convert | POST /contacts + POST /invoices |
| Subscription Start | POST /estimates OR /invoices |
| Renewal / Pro-rata | POST /estimates |

| Zoho → Central (webhook) | Effect |
|---|---|
| estimate_updated (accepted) | Quote status update |
| invoice_created | renewal_history से link |
| payment_added | Subscription dates extend / qty add, status Active |

---

## Quote Types Reference

| # | Type | Module | Trigger | Storage |
|---|---|---|---|---|
| 1 | Lead Quote | Quick Quote | New customer | `quick_quotes` |
| 2 | Cross-sell | Quick Quote | Existing customer | `quick_quotes` |
| 3 | Renewal | Subscription | Renew button | `renewal_history` |
| 4 | Pro-rata | Subscription | Pro-rata button | `renewal_history` |

---

*Detail के लिए देखो: `REVISED_PRD_v4.md` (PRD v5.0).*
