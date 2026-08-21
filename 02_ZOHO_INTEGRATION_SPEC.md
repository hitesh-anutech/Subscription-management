# Zoho Books Integration Specification

**Document Version:** 1.0
**Date:** 14 May 2026
**Part of:** Path B — Pre-Implementation Specification Package
**Status:** Active — Implementation Reference

---

## Table of Contents

1. Overview & Integration Architecture
2. Zoho API Domain & Endpoints
3. OAuth 2.0 Authentication Flow
4. Custom Fields Setup (Manual — per Org)
5. Customer Module API (Contacts)
6. Item Module API
7. Estimate Module API (Quotes)
8. Invoice Module API
9. Payment Module API
10. Webhook Setup & Payload Reference
11. Error Handling & Rate Limit Strategy
12. Token Refresh & Encryption
13. Initial Org Onboarding Checklist
14. Testing with Trial Organizations

---

## 1. Overview & Integration Architecture

### 1.1 Integration Topology

```
┌──────────────────────────────────────────────────────────┐
│         Central App (Self-Hosted, Node.js)              │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  ZohoApiClient (with org context)                  │  │
│  │  - axios instance                                  │  │
│  │  - automatic token refresh                         │  │
│  │  - rate limit middleware                           │  │
│  │  - retry on 5xx / 429                              │  │
│  └────────────────────────────────────────────────────┘  │
│                         ↓                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │  OrgResolver                                       │  │
│  │  - resolves which Zoho org from domain/customer    │  │
│  │  - fetches OAuth tokens from DB (decrypted)        │  │
│  └────────────────────────────────────────────────────┘  │
│                         ↓                                 │
│         ┌───────────────┼───────────────┐                │
│         ↓               ↓               ↓                │
│      Zoho Org 1     Zoho Org 2     Zoho Org N           │
└──────────────────────────────────────────────────────────┘
                          ↑
                          │ (Webhooks → Central App)
                          │
┌─────────────────────────┴───────────────────────────────┐
│  Zoho Books (4 organizations on Indian data center)      │
└──────────────────────────────────────────────────────────┘
```

### 1.2 Integration Principles

1. **Multi-org aware** — हर API call में `organization_id` query param mandatory
2. **OAuth tokens encrypted at rest** (AES-256, app layer)
3. **Idempotent writes** — duplicate API calls don't create duplicates
4. **Rate limit respect** — Zoho allows 100 req/min per org; we throttle to 80
5. **Webhook-first sync** + daily backup full sync (3 AM IST)
6. **Custom fields carry context** — Central UUIDs travel in Zoho records

---

## 2. Zoho API Domain & Endpoints

### 2.1 Base URLs (India Data Center)

| Service | Base URL |
|---|---|
| **Books API** | `https://www.zohoapis.in/books/v3` |
| **OAuth Authorize** | `https://accounts.zoho.in/oauth/v2/auth` |
| **OAuth Token Exchange** | `https://accounts.zoho.in/oauth/v2/token` |
| **OAuth Token Refresh** | `https://accounts.zoho.in/oauth/v2/token` |

**For other regions:** Replace `.in` with `.com` (US), `.eu` (EU), `.com.au` (AU), `.jp` (JP)

### 2.2 Required OAuth Scopes

```
ZohoBooks.contacts.ALL
ZohoBooks.items.ALL
ZohoBooks.estimates.ALL
ZohoBooks.invoices.ALL
ZohoBooks.customerpayments.ALL
ZohoBooks.settings.READ
```

**Why each scope:**
- `contacts.ALL`: Create customer on lead conversion, read customer details
- `items.ALL`: Read item catalog
- `estimates.ALL`: Create quotes (Mode A + post-conversion)
- `invoices.ALL`: Read invoice status, future invoice creation
- `customerpayments.ALL`: Read payment events for renewal status
- `settings.READ`: Fetch org metadata, custom fields

---

## 3. OAuth 2.0 Authentication Flow

### 3.1 Initial Org Connection (Self-Service from Settings UI)

**Step 1: Register Zoho Self Client (one-time, manual by admin)**

1. Visit https://api-console.zoho.in
2. Create new Self Client → choose "Server-based Applications"
3. Note: `Client ID` and `Client Secret`
4. Add redirect URI: `https://app.exceltechnologies.in/api/auth/zoho/callback` (or `http://localhost:3000/api/auth/zoho/callback` for dev)

**Step 2: Admin Clicks "Connect Zoho" in Settings UI**

Frontend redirects to:

```
https://accounts.zoho.in/oauth/v2/auth?
  scope=ZohoBooks.contacts.ALL,ZohoBooks.items.ALL,ZohoBooks.estimates.ALL,ZohoBooks.invoices.ALL,ZohoBooks.customerpayments.ALL,ZohoBooks.settings.READ&
  client_id={CLIENT_ID}&
  state={ORG_ID}&
  response_type=code&
  redirect_uri={REDIRECT_URI}&
  access_type=offline&
  prompt=consent
```

**Step 3: User Authorizes, Zoho Redirects Back with Code**

```
GET /api/auth/zoho/callback?code={AUTH_CODE}&state={ORG_ID}
```

**Step 4: Exchange Code for Tokens**

```http
POST https://accounts.zoho.in/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}&
redirect_uri={REDIRECT_URI}&
code={AUTH_CODE}
```

**Response:**

```json
{
  "access_token": "1000.xxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxx",
  "refresh_token": "1000.xxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxx",
  "api_domain": "https://www.zohoapis.in",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Step 5: Store Encrypted Tokens**

```typescript
await prisma.organizations.update({
  where: { id: orgId },
  data: {
    access_token_encrypted: encrypt(response.access_token),
    refresh_token_encrypted: encrypt(response.refresh_token),
    token_expires_at: new Date(Date.now() + response.expires_in * 1000),
    scopes: 'ZohoBooks.contacts.ALL,ZohoBooks.items.ALL,...',
    connection_status: 'active'
  }
});
```

### 3.2 Token Refresh (Automatic, Server-Side)

When access_token expires (every hour):

```http
POST https://accounts.zoho.in/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}&
refresh_token={REFRESH_TOKEN}
```

**Response:**

```json
{
  "access_token": "1000.yyyyy.yyyyy",
  "api_domain": "https://www.zohoapis.in",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Note:** Refresh token does **not** expire (unless manually revoked).

### 3.3 Common Headers for All API Calls

```http
Authorization: Zoho-oauthtoken {access_token}
Content-Type: application/json
```

---

## 4. Custom Fields Setup (Manual — Per Org)

प्रत्येक Zoho Books organization में ये custom fields **manually create करनी होंगी** (one-time setup per org):

### 4.1 Setup Steps (per Zoho Org)

1. Login to Zoho Books → Settings → Preferences
2. Navigate to **Custom Fields**
3. Select module → Create field

### 4.2 Required Custom Fields

#### A) Contacts (Customers) Module

| Field Label | API Name (auto-generated) | Type | Mandatory |
|---|---|---|---|
| Central Lead ID | `cf_central_lead_id` | Single Line | No |
| Domain Name | `cf_domain_name` | Single Line | No |

#### B) Estimates (Quotes) Module

| Field Label | API Name | Type | Mandatory |
|---|---|---|---|
| Central Quote ID | `cf_central_quote_id` | Single Line | No |
| Central Subscription ID | `cf_central_subscription_id` | Single Line | No |
| Domain Name | `cf_domain_name` | Single Line | No |
| Business Type | `cf_business_type` | Dropdown (Fresh, Renewal, Pro-rata) | No |

#### C) Invoices Module

| Field Label | API Name | Type | Mandatory |
|---|---|---|---|
| Central Subscription ID | `cf_central_subscription_id` | Single Line | No |
| Central Quote ID | `cf_central_quote_id` | Single Line | No |
| Domain Name | `cf_domain_name` | Single Line | No |
| Business Type | `cf_business_type` | Dropdown | No |

### 4.3 Verifying Custom Fields via API

After creating, verify via API:

```http
GET /settings/customfields?entity=estimate
Authorization: Zoho-oauthtoken {access_token}
```

Response includes field with `placeholder` (API name) — capture for reference.

---

## 5. Customer Module API (Contacts)

### 5.1 List Contacts (Customers)

```http
GET /contacts?organization_id={ZOHO_ORG_ID}&page=1&per_page=200
```

**Response:**

```json
{
  "code": 0,
  "message": "success",
  "contacts": [
    {
      "contact_id": "460000000123456",
      "contact_name": "Acme Corporation",
      "company_name": "Acme Corp",
      "contact_type": "customer",
      "email": "billing@acme.com",
      "phone": "+91-98765-43210",
      "gst_no": "27AAAPL1234C1Z5",
      "currency_code": "INR",
      "status": "active"
    }
  ],
  "page_context": {
    "page": 1,
    "per_page": 200,
    "has_more_page": true,
    "total": 250
  }
}
```

**Pagination:** `per_page` max 200; iterate until `has_more_page: false`

### 5.2 Get Contact Details

```http
GET /contacts/{contact_id}?organization_id={ZOHO_ORG_ID}
```

### 5.3 Create Contact (on Lead Conversion)

```http
POST /contacts?organization_id={ZOHO_ORG_ID}
Content-Type: application/json
Authorization: Zoho-oauthtoken {access_token}

{
  "contact_name": "Acme Corp",
  "company_name": "Acme Corp",
  "contact_type": "customer",
  "currency_id": "460000000000059",
  "gst_no": "27AAAPL1234C1Z5",
  "gst_treatment": "business_gst",
  "pan_no": "AAAPL1234C",
  "place_of_contact": "MH",

  "billing_address": {
    "attention": "John Doe",
    "address": "123 Tech Park, Sector 5",
    "street2": "Andheri East",
    "city": "Mumbai",
    "state": "Maharashtra",
    "zip": "400069",
    "country": "India",
    "phone": "+91-98765-43210"
  },

  "shipping_address": {
    "attention": "John Doe",
    "address": "123 Tech Park, Sector 5",
    "city": "Mumbai",
    "state": "Maharashtra",
    "zip": "400069",
    "country": "India"
  },

  "contact_persons": [
    {
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@acme.com",
      "phone": "+91-98765-43210",
      "designation": "Director",
      "is_primary_contact": true
    }
  ],

  "custom_fields": [
    {
      "label": "Central Lead ID",
      "value": "lead-uuid-from-central"
    },
    {
      "label": "Domain Name",
      "value": "acme.com"
    }
  ],

  "notes": "Converted from Central App on 14 May 2026"
}
```

**Success Response:**

```json
{
  "code": 0,
  "message": "Customer has been created.",
  "contact": {
    "contact_id": "460000000789012",
    "contact_name": "Acme Corp",
    ...
  }
}
```

**Error Codes:**

| Code | Meaning | Action |
|---|---|---|
| 0 | Success | Continue |
| 5 | Invalid OAuth token | Refresh and retry |
| 6 | OAuth token expired | Refresh and retry |
| 1001 | Required field missing | Check payload validation |
| 1002 | Duplicate (GSTIN exists) | Show error to user |
| 4000 | Invalid GSTIN format | Validate before sending |

---

## 6. Item Module API

### 6.1 List Items

```http
GET /items?organization_id={ZOHO_ORG_ID}&page=1&per_page=200
```

**Response:**

```json
{
  "code": 0,
  "items": [
    {
      "item_id": "460000000098765",
      "name": "Google Workspace Business Standard",
      "description": "Per user/month subscription",
      "rate": 750.00,
      "tax_id": "460000000054321",
      "tax_percentage": 18,
      "tax_name": "GST18",
      "unit": "qty",
      "sku": "GWS-BS-001",
      "status": "active",
      "item_type": "service",
      "hsn_or_sac": "998314"
    }
  ]
}
```

### 6.2 Get Item Details

```http
GET /items/{item_id}?organization_id={ZOHO_ORG_ID}
```

---

## 7. Estimate Module API (Quotes)

This is the most-used module — used for **all 4 quote types**.

### 7.1 Create Estimate

```http
POST /estimates?organization_id={ZOHO_ORG_ID}
Content-Type: application/json
Authorization: Zoho-oauthtoken {access_token}

{
  "customer_id": "460000000789012",
  "estimate_number": "EST-2026-0042",
  "reference_number": "QQ-2026-0042",
  "date": "2026-05-14",
  "expiry_date": "2026-05-29",
  "currency_id": "460000000000059",
  "discount": 0,
  "is_discount_before_tax": true,
  "discount_type": "entity_level",
  "is_inclusive_tax": false,

  "line_items": [
    {
      "item_id": "460000000098765",
      "name": "Google Workspace Business Standard",
      "description": "Annual subscription, 10 users, acme.com domain",
      "rate": 750.00,
      "quantity": 10,
      "unit": "qty",
      "tax_id": "460000000054321",
      "discount": 0,
      "hsn_or_sac": "998314",

      "item_custom_fields": [
        {
          "label": "Central Subscription ID",
          "value": "sub-uuid-from-central"
        },
        {
          "label": "Subscription Start Date",
          "value": "2026-05-15"
        },
        {
          "label": "Subscription End Date",
          "value": "2027-05-14"
        }
      ]
    }
  ],

  "custom_fields": [
    {
      "label": "Central Quote ID",
      "value": "qq-uuid-from-central"
    },
    {
      "label": "Central Subscription ID",
      "value": ""
    },
    {
      "label": "Domain Name",
      "value": "acme.com"
    },
    {
      "label": "Business Type",
      "value": "Fresh"
    }
  ],

  "notes": "Thank you for your business",
  "terms": "Payment due within 30 days of invoice"
}
```

**Custom field values for different quote types:**

| Quote Type | cf_central_quote_id | cf_central_subscription_id | cf_business_type |
|---|---|---|---|
| Type 1 (Lead) | `<quick_quote UUID>` | (empty) | `Fresh` |
| Type 2 (Cross-sell) | `<quick_quote UUID>` | (empty) | `Fresh` |
| Type 3 (Renewal) | (empty) | `<subscription UUID>` | `Renewal` |
| Type 4 (Pro-rata) | (empty) | `<subscription UUID>` | `Pro-rata` |

**Success Response:**

```json
{
  "code": 0,
  "message": "The estimate has been created.",
  "estimate": {
    "estimate_id": "460000000234567",
    "estimate_number": "EST-2026-0042",
    "customer_id": "460000000789012",
    "status": "draft",
    "total": 8850.00,
    "sub_total": 7500.00,
    "tax_total": 1350.00,
    "currency_code": "INR"
  }
}
```

### 7.2 Send Estimate via Email (Mode A — Existing Customer)

```http
POST /estimates/{estimate_id}/email?organization_id={ZOHO_ORG_ID}
Content-Type: application/json

{
  "to_mail_ids": ["john@acme.com"],
  "cc_mail_ids": [],
  "subject": "Your Quote from Excel Technologies",
  "body": "Dear John,\n\nPlease find attached quote EST-2026-0042..."
}
```

### 7.3 Convert Estimate to Invoice

```http
POST /estimates/{estimate_id}/status/accepted?organization_id={ZOHO_ORG_ID}
```

Then:

```http
POST /invoices/fromestimate?organization_id={ZOHO_ORG_ID}
Content-Type: application/json

{
  "estimate_id": "460000000234567"
}
```

### 7.4 Get Estimate Status

```http
GET /estimates/{estimate_id}?organization_id={ZOHO_ORG_ID}
```

**Status values:** `draft`, `sent`, `viewed`, `accepted`, `declined`, `expired`, `invoiced`

---

## 8. Invoice Module API

### 8.1 Get Invoice Details

```http
GET /invoices/{invoice_id}?organization_id={ZOHO_ORG_ID}
```

### 8.2 List Invoices for Customer

```http
GET /invoices?organization_id={ZOHO_ORG_ID}&customer_id={CONTACT_ID}
```

### 8.3 Invoice Status Values

`draft`, `sent`, `viewed`, `paid`, `partially_paid`, `overdue`, `void`

---

## 9. Payment Module API

### 9.1 List Payments

```http
GET /customerpayments?organization_id={ZOHO_ORG_ID}&customer_id={CONTACT_ID}
```

### 9.2 Get Payment Details

```http
GET /customerpayments/{payment_id}?organization_id={ZOHO_ORG_ID}
```

**Response:**

```json
{
  "payment": {
    "payment_id": "460000000345678",
    "customer_id": "460000000789012",
    "date": "2026-05-20",
    "amount": 8850.00,
    "payment_mode": "banktransfer",
    "reference_number": "TXN-12345",
    "invoices": [
      {
        "invoice_id": "460000000456789",
        "invoice_number": "INV-2026-0156",
        "invoice_amount": 8850.00,
        "amount_applied": 8850.00
      }
    ]
  }
}
```

---

## 10. Webhook Setup & Payload Reference

### 10.1 Webhook Configuration (per Zoho Org)

**Setup Steps:**

1. In Zoho Books: Settings → Automation → Webhooks
2. Create new webhook with:
   - **URL:** `https://app.exceltechnologies.in/api/webhooks/zoho/{event_type}`
   - **Method:** POST
   - **Content type:** JSON
   - **Headers:** Add `X-Webhook-Secret: {RANDOM_SECRET}` for verification
3. Configure triggers for:
   - Contact: created, updated
   - Item: created, updated
   - Estimate: created, sent, accepted, declined, invoiced
   - Invoice: created, sent, paid, void
   - Payment: created, deleted

### 10.2 Webhook Payload Structures

#### A) Estimate Event Payload

```json
{
  "event": "estimate_accepted",
  "organization_id": "60000000123",
  "timestamp": "2026-05-14T10:30:00+05:30",
  "estimate": {
    "estimate_id": "460000000234567",
    "estimate_number": "EST-2026-0042",
    "customer_id": "460000000789012",
    "status": "accepted",
    "total": 8850.00,
    "custom_field_hash": {
      "cf_central_quote_id": "qq-uuid",
      "cf_central_subscription_id": "",
      "cf_domain_name": "acme.com",
      "cf_business_type": "Fresh"
    }
  }
}
```

#### B) Invoice Event Payload

```json
{
  "event": "invoice_paid",
  "organization_id": "60000000123",
  "invoice": {
    "invoice_id": "460000000456789",
    "invoice_number": "INV-2026-0156",
    "customer_id": "460000000789012",
    "status": "paid",
    "total": 8850.00,
    "balance": 0,
    "estimate_id": "460000000234567",
    "custom_field_hash": {
      "cf_central_subscription_id": "sub-uuid",
      "cf_central_quote_id": "qq-uuid",
      "cf_business_type": "Renewal"
    }
  }
}
```

#### C) Payment Event Payload

```json
{
  "event": "payment_created",
  "organization_id": "60000000123",
  "payment": {
    "payment_id": "460000000345678",
    "customer_id": "460000000789012",
    "amount": 8850.00,
    "date": "2026-05-20",
    "invoices": [
      {"invoice_id": "460000000456789", "amount_applied": 8850.00}
    ]
  }
}
```

### 10.3 Webhook Verification (Server-Side)

```typescript
// Verify the X-Webhook-Secret header matches our stored secret
const receivedSecret = req.headers['x-webhook-secret'];
const expectedSecret = process.env.ZOHO_WEBHOOK_SECRET;

if (receivedSecret !== expectedSecret) {
  return res.status(401).json({ error: 'Invalid webhook signature' });
}
```

### 10.4 Webhook Idempotency

Compute `event_hash` from `(organization_id + entity_id + event_type + status)`:

```typescript
const eventHash = sha256(`${orgId}:${entityId}:${eventType}:${status}`);

// Try to insert into webhook_events with UNIQUE event_hash
// If duplicate, ignore (already processed)
```

---

## 11. Error Handling & Rate Limit Strategy

### 11.1 Zoho Error Code Reference

| Code | Meaning | Recommended Action |
|---|---|---|
| 0 | Success | Continue |
| 5 | Invalid OAuth token | Refresh token, retry |
| 6 | OAuth token expired | Refresh token, retry |
| 14 | Invalid OAuth scope | Re-authorize with correct scopes |
| 57 | Permission denied | Admin notification |
| 1001 | Mandatory field missing | Validate payload, surface to user |
| 1002 | Duplicate record | Surface as user error |
| 4000 | Validation error | Surface specific field error |
| 9001 | Rate limit exceeded | Backoff and retry |
| 5000+ | Server error | Retry with exponential backoff |

### 11.2 Rate Limit Handling

**Zoho's Limit:** 100 API calls per minute per org

**Our Strategy:**

```typescript
// Token bucket per org
const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 750,  // ~80 calls/min, gives 20% headroom
  reservoir: 80,
  reservoirRefreshAmount: 80,
  reservoirRefreshInterval: 60 * 1000
});

// Wrap all API calls
const result = await limiter.schedule(() =>
  axios.post(url, payload, { headers })
);
```

**On 429 Rate Limit Response:**

```typescript
async function callWithRetry(fn, attempt = 1) {
  try {
    return await fn();
  } catch (error) {
    if (error.response?.status === 429 && attempt <= 3) {
      const waitMs = Math.min(2 ** attempt * 1000, 30000);
      await sleep(waitMs);
      return callWithRetry(fn, attempt + 1);
    }
    throw error;
  }
}
```

### 11.3 OAuth Token Refresh on 401

```typescript
async function zohoApiCall(orgId, endpoint, options) {
  let token = await getCachedToken(orgId);

  try {
    return await axios({ url, headers: { Authorization: `Zoho-oauthtoken ${token}` }, ...options });
  } catch (error) {
    if (error.response?.data?.code === 6 || error.response?.status === 401) {
      // Token expired — refresh and retry once
      token = await refreshOrgToken(orgId);
      return await axios({ url, headers: { Authorization: `Zoho-oauthtoken ${token}` }, ...options });
    }
    throw error;
  }
}
```

---

## 12. Token Refresh & Encryption

### 12.1 Encryption Implementation (AES-256-GCM)

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32 bytes
const ALGORITHM = 'aes-256-gcm';

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(12) + authTag(16) + ciphertext, base64-encoded
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
```

### 12.2 Auto-Refresh Strategy

- **Proactive:** If token expires in < 5 minutes, refresh before API call
- **Reactive:** On 401 response, refresh and retry once
- **Cache:** Hold decrypted token in Redis (TTL = expires_in - 5 min)

---

## 13. Initial Org Onboarding Checklist

प्रत्येक Zoho org के लिए complete steps:

### Pre-Setup (one-time, by Excel Tech admin)

- [ ] Register Self Client at https://api-console.zoho.in
- [ ] Note Client ID and Client Secret
- [ ] Configure redirect URI (dev + production URLs)
- [ ] Generate `ENCRYPTION_KEY` (32 random bytes, hex-encoded)
- [ ] Generate `ZOHO_WEBHOOK_SECRET` (random string)

### Per-Org Setup (repeat 4 times for 4 orgs)

#### Phase A — In Zoho Books

- [ ] Login to Zoho Books for this org
- [ ] Settings → Preferences → Custom Fields → create Contact fields (Section 4.2.A)
- [ ] Create Estimate custom fields (Section 4.2.B)
- [ ] Create Invoice custom fields (Section 4.2.C)
- [ ] Settings → Automation → Webhooks → create webhooks (Section 10.1)
- [ ] Verify webhook with test ping

#### Phase B — In Central App

- [ ] Settings → Organizations → Add Organization
- [ ] Enter Zoho Org ID, name, data center
- [ ] Click "Connect Zoho" → complete OAuth flow
- [ ] Verify connection status = "active"
- [ ] Click "Sync Customers" → wait for completion
- [ ] Click "Sync Items" → wait for completion
- [ ] Configure org_settings (branding, supplier state, GSTIN, PAN)
- [ ] Set as default org if applicable

### Validation

- [ ] Test fetch: GET `/api/customers?org={id}` returns synced data
- [ ] Test create: Convert a test lead → verify customer appears in Zoho
- [ ] Test webhook: Send test estimate from Zoho → verify webhook hits Central
- [ ] Test refresh: Manually expire token, verify auto-refresh works

---

## 14. Testing with Trial Organizations

### 14.1 Trial Org Strategy

Zoho Books doesn't have a "sandbox" per se, but offers **free 14-day trials** of paid plans.

**Recommended Test Setup:**

1. **Dev Trial Org:** Create with developer email, used for all development
2. **Staging Trial Org:** Created when staging environment exists (Phase 2)
3. **Production Orgs:** Your 4 real Zoho Books orgs

### 14.2 Test Data

- Create 5-10 test contacts in Trial Org
- Create 5-10 test items
- Create test estimates with sample custom fields
- Test webhook delivery via ngrok for local dev:
  ```
  ngrok http 3000
  # Use ngrok URL in Zoho webhook config
  ```

### 14.3 Pre-Production Test Checklist

- [ ] All 4 orgs OAuth connected
- [ ] Customer sync working bidirectionally
- [ ] Item sync working
- [ ] Quick Quote (Lead) → public link → accept → conversion flow tested end-to-end
- [ ] Quick Quote (Existing Customer) → Zoho estimate creation tested
- [ ] Renewal Quote → Zoho estimate creation tested
- [ ] Pro-rata Quote → Zoho estimate creation tested
- [ ] Estimate sent → webhook received → status updated in Central
- [ ] Invoice paid → webhook → subscription updated
- [ ] Token expiry → auto-refresh tested
- [ ] Rate limit (429) → backoff tested
- [ ] OAuth re-connect after revoke tested

---

## 15. Atomic Lead-Conversion Sequence (Type 1 Quote Path)

**Trigger:** Lead-mode quote (Type 1) is accepted by the prospect on the public link, और sales user clicks **Convert to Customer** (or auto-conversion is enabled via `conversion.auto_convert_on_accept = true`).

**Goal:** एक atomic operation में Zoho Customer + Zoho Estimate + Central Subscription record create करना। अगर बीच में कुछ fail हो, compensating transaction से orphan Zoho records को clean करना।

### 15.1 Sequence (7 Steps)

```
Step 1.  Pre-check idempotency
         GET /contacts?email=<lead.email>&organization_id=<target_org>
         If found → REUSE existing contact_id (do not create duplicate)

Step 2.  Create Zoho Customer (POST /contacts)
         Payload: from leads table + custom field cf_central_lead_id = <lead.id>

Step 3.  Insert/Update Central domain record
         INSERT INTO domains (domain_name, organization_id, zoho_customer_id, ...)
         ON CONFLICT (domain_name) DO UPDATE SET ...

Step 4.  Push Quote to Zoho as Estimate (POST /estimates)
         Payload: from quick_quotes + items;
                  customer_id = <Zoho contact_id from Step 2>;
                  custom fields: cf_central_quote_id, cf_central_lead_id

Step 5.  Create Central Subscription records (one per line item with is_subscription=true)
         INSERT INTO subscriptions (...)
         origin_lead_id, origin_quick_quote_id set
         lifecycle_status = 'Pending' (becomes 'Active' when invoice is paid)

Step 6.  Update Lead status
         UPDATE leads SET status='Converted',
                          converted_to_zoho_customer_id=<contact_id>,
                          converted_at=NOW()
                      WHERE id=<lead.id>

Step 7.  Write lead_conversions audit row
         INSERT INTO lead_conversions (...)
                conversion_status='success'
```

### 15.2 Failure Handling — Compensating Transactions

Failures can happen at any step. Steps 1, 3, 5, 6, 7 are Central DB writes — they roll back automatically inside a single `BEGIN…COMMIT` transaction. Steps 2 and 4 are Zoho API calls — those need explicit compensation.

| Failed Step | Compensating Action |
|---|---|
| 1 (pre-check 5xx) | Retry per §11.1 backoff (max 3 attempts); record `conversion_status='failed'` if still failing |
| 2 (POST contacts) | No compensation needed (nothing created yet); mark `conversion_status='failed'`; alert per §11.3 |
| 3 (Central INSERT) | Triggered before Step 4 → wrap in BEGIN; if fails, no Zoho mutations yet |
| 4 (POST estimates) | **Critical:** Zoho contact already exists. **Do not delete the contact** — it may already have other estimates (race condition). Instead: store `zoho_customer_id` on the lead row, mark `conversion_status='partial'`, alert admin. Retry can pick up from Step 4 using the stored `zoho_customer_id`. |
| 5 (subscriptions INSERT) | Central rollback handles it. Zoho estimate exists with `cf_central_quote_id` set — next retry skips Step 4 (idempotent via `GET /estimates?cf_central_quote_id=...`) |
| 6 (leads UPDATE) | Same as Step 5 |
| 7 (audit INSERT) | Best-effort; log to file fallback if DB unavailable |

### 15.3 Retry Configuration

Read from `app_settings`:
- `conversion.max_auto_retries` = 3 (Decision Q1.10)
- `conversion.retry_intervals_seconds` = `[5, 30, 300]` — exponential backoff
- `conversion.auto_convert_on_accept` = false in MVP (manual confirm)

### 15.4 Idempotency Guarantees

Every retry of the conversion job MUST:
1. **Step 2 idempotency:** Pre-check `GET /contacts?email=<lead.email>&cf_central_lead_id=<lead.id>` — if found, reuse.
2. **Step 4 idempotency:** Pre-check `GET /estimates?cf_central_quote_id=<quick_quote.id>` — if found, skip creation.
3. **Step 5 idempotency:** `subscriptions` table UNIQUE on `(origin_quick_quote_id, zoho_item_id, primary_domain)` — duplicate insert raises constraint violation, treat as success.

### 15.5 Service Code Sketch (NestJS)

```typescript
@Injectable()
export class LeadConversionService {
  async convertLead(leadId: string, userId: string): Promise<LeadConversion> {
    const lead   = await this.leads.findOneOrFail(leadId);
    const quote  = await this.quotes.findLatestAcceptedForLead(leadId);
    const orgId  = lead.targetOrganizationId;
    const zoho   = this.zohoFactory.forOrg(orgId);

    return await this.prisma.$transaction(async (tx) => {
      // Step 1-2: idempotent contact create
      const contact = await this.idempotentCreateContact(zoho, lead);

      // Step 3: upsert domain
      const domain = await tx.domain.upsert({
        where: { domainName: lead.primaryDomain },
        update: { zohoCustomerId: contact.contact_id },
        create: { ... }
      });

      // Step 4: idempotent estimate create
      const estimate = await this.idempotentCreateEstimate(zoho, quote, contact.contact_id);

      // Step 5: subscriptions
      const subs = await this.createSubscriptionsFromQuote(tx, quote, domain.id, contact);

      // Step 6: lead update
      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: 'Converted',
          convertedToZohoCustomerId: contact.contact_id,
          convertedAt: new Date(),
        }
      });

      // Step 7: audit
      return tx.leadConversion.create({
        data: {
          leadId, quickQuoteId: quote.id, organizationId: orgId,
          zohoCustomerId: contact.contact_id,
          zohoEstimateId: estimate.estimate_id,
          subscriptionIds: subs.map(s => s.id),
          conversionStatus: 'success',
          convertedByUserId: userId,
        }
      });
    });
  }
}
```

---

## 16. Pro-rata Webhook Handler (The Dates-Unchanged Invariant)

**Context:** PRD §5.4 + §8A.2 + Safeguard #7 का critical rule:
> Pro-rata invoice paid होने पर subscription के `start_date`/`end_date` **change नहीं** होने चाहिए। सिर्फ `quantity` increment होनी चाहिए।

Renewal में दोनों होते हैं (dates extend + last_invoice_* update)। Pro-rata में सिर्फ quantity बदलती है।

### 16.1 Decision Logic on `invoice_paid` Webhook

```typescript
async function handleInvoicePaid(event: ZohoInvoicePaidPayload, orgId: string) {
  const invoice = event.data.invoice;
  const subId   = invoice.custom_field_hash?.cf_central_subscription_id;
  const bizType = invoice.custom_field_hash?.cf_business_type;  // 'Renewal' | 'Pro-rata' | 'Fresh'

  // Fresh (Type 1/2) → handled by lead-conversion path or new-subscription path
  if (!subId || bizType === 'Fresh') {
    return await this.handleFreshInvoicePaid(invoice, orgId);
  }

  // Renewal (Type 3) → extend dates AND update last_invoice_*
  if (bizType === 'Renewal') {
    return await this.handleRenewalInvoicePaid(invoice, subId);
  }

  // Pro-rata (Type 4) → increment quantity, DO NOT touch dates
  if (bizType === 'Pro-rata') {
    return await this.handleProrataInvoicePaid(invoice, subId);
  }

  throw new Error(`Unknown cf_business_type: ${bizType}`);
}
```

### 16.2 Renewal Handler (Type 3)

```typescript
async handleRenewalInvoicePaid(invoice, subId: string) {
  return this.prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subId } });

    // Extend end_date by billing_cycle from current end_date
    const newEnd = addBillingCycle(sub.endDate, sub.billingCycle);

    await tx.subscription.update({
      where: { id: subId },
      data: {
        startDate: sub.endDate,        // new term starts where old one ended
        endDate: newEnd,
        nextRenewalDate: newEnd,
        lifecycleStatus: 'Active',
        processStatus: 'Renewal Paid',
        lastInvoiceId: invoice.invoice_id,
        lastInvoiceNumber: invoice.invoice_number,
        lastInvoiceDate: invoice.date,
      }
    });

    // Update renewal_history row to status='Paid'
    await tx.renewalHistory.updateMany({
      where: {
        subscriptionId: subId,
        invoiceId: invoice.invoice_id,
        businessType: 'Renewal'
      },
      data: { renewalStatus: 'Paid', paymentDate: invoice.date }
    });
  });
}
```

### 16.3 Pro-rata Handler (Type 4) — Dates NEVER Change

```typescript
async handleProrataInvoicePaid(invoice, subId: string) {
  return this.prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subId } });
    const renewalRow = await tx.renewalHistory.findFirstOrThrow({
      where: {
        subscriptionId: subId,
        invoiceId: invoice.invoice_id,
        businessType: 'Pro-rata'
      }
    });

    // Add the pro-rata quantity to the existing subscription
    const additionalQty = renewalRow.quantity ?? new Decimal(0);
    const newQty = sub.quantity.plus(additionalQty);

    await tx.subscription.update({
      where: { id: subId },
      data: {
        quantity: newQty,                    // ← only quantity changes
        // start_date and end_date UNTOUCHED — this is the invariant
        processStatus: 'Pro-rata Paid',
        lastInvoiceId: invoice.invoice_id,
        lastInvoiceNumber: invoice.invoice_number,
        lastInvoiceDate: invoice.date,
        // last_quote_*, next_renewal_date UNCHANGED for pro-rata
      }
    });

    await tx.renewalHistory.update({
      where: { id: renewalRow.id },
      data: { renewalStatus: 'Paid', paymentDate: invoice.date }
    });
  });
}
```

### 16.4 Test Cases (Must Pass Before Release)

| # | Scenario | Expected sub state after webhook |
|---|---|---|
| T1 | Sub `(qty=10, end=2026-12-31)` + Pro-rata invoice for 5 paid | `(qty=15, end=2026-12-31)` — end unchanged |
| T2 | Sub `(qty=10, end=2026-12-31)` + Renewal invoice for next year paid | `(qty=10, start=2026-12-31, end=2027-12-31)` |
| T3 | Pro-rata webhook with `cf_business_type` missing | Reject with error log; do not mutate sub |
| T4 | Same pro-rata webhook delivered twice (idempotency) | Second delivery is no-op (renewal_history row already `Paid`) |
| T5 | Renewal webhook for a Pro-rata sub (wrong type label) | Reject; alert admin via §11.3 path |

---

## 17. Sync Engine Strategy (Daily Full Sync at 3 AM IST)

### 17.1 Schedule

- Cron expression seeded in `app_settings`: `zoho.daily_full_sync_cron = "0 3 * * *"` (3 AM IST)
- Implemented via BullMQ scheduled job (`SyncEngineQueue`)
- One job per Zoho org → sync runs in parallel across the 4 orgs
- Per-org rate limit (80 req/min) still applies; sync uses ~30% quota to leave headroom

### 17.2 What Gets Synced (configurable)

Read from `app_settings.zoho.daily_sync_entities`:
- `customers` — `GET /contacts?last_modified_time={since}` (write to `zoho_cache.entity_type='customer'`)
- `items` — `GET /items?last_modified_time={since}` (write to `zoho_cache.entity_type='item'`)
- `estimates` — `GET /estimates?last_modified_time={since}` (reconcile statuses on `quick_quotes` via `zoho_estimate_id`)
- `invoices` — `GET /invoices?last_modified_time={since}` (reconcile `subscriptions.last_invoice_*`)
- `payments` — `GET /customerpayments?last_modified_time={since}` (catch any webhook misses)

### 17.3 Delta vs Full Sync

```
since = MAX(
  organizations.last_sync_at,
  NOW() - INTERVAL '7 days'   -- safety floor; never sync less than last 7 days
)
```

- **First-ever sync for an org** (`last_sync_at IS NULL`): fetch all records, paginate via `per_page=200` until `has_more_page=false`.
- **Subsequent runs:** filter by `last_modified_time > since`. This is the "delta" path — typical day's payload is small (10s of records).
- **Safety floor of 7 days:** protects against missed updates if a sync was skipped (server downtime).

### 17.4 Pagination

Zoho Books returns `page_context.has_more_page` and `page_context.page`. Loop:

```typescript
let page = 1;
do {
  const resp = await zoho.get('/contacts', {
    params: { last_modified_time: since, per_page: 200, page }
  });
  await this.upsertContacts(resp.contacts);
  hasMore = resp.page_context.has_more_page;
  page++;
} while (hasMore);
```

### 17.5 Deleted-Record Detection

Zoho Books API has **no delete-event webhook** for most entities. Strategy:
- For `customers`: weekly job runs a **full-list reconciliation** (no `last_modified_time` filter), diff against `zoho_cache`. Records in cache not in Zoho → mark `zoho_cache.is_active=false` (do not hard-delete; subscriptions may reference them).
- For `items`: same weekly reconciliation.
- For `estimates` / `invoices` / `payments`: not deleted via Zoho UI under normal flow; if needed, daily delta picks up status changes (`voided`, `cancelled`).

### 17.6 Checkpointing

```sql
-- After each successful sync batch:
UPDATE organizations
SET last_sync_at = NOW()
WHERE id = $1;

-- On partial failure (e.g., halfway through 5 entities):
-- Store per-entity progress in webhook_events with event_type='sync_checkpoint':
INSERT INTO webhook_events (
  organization_id, event_source, event_type, event_hash, payload, processing_status
) VALUES ($1, 'sync_engine', 'sync_checkpoint', $2, $3, 'success');
```

### 17.7 Error Handling

- 5xx / 429: retry with backoff per §11.1
- 401: refresh token, retry once
- Permanent failure (3 retries exhausted): mark `connection_status='error'` on `organizations`, alert admin
- Sync engine never crashes the whole job on per-entity failure — each entity is its own try/catch

### 17.8 Initial-Sync Special Case (Org Onboarding)

When a brand-new org connects via OAuth:
1. Trigger an **immediate initial sync** (don't wait for 3 AM)
2. Bypass the rate-limit token bucket for the first 1000 requests (we have full 100/min quota to use)
3. Show progress in System Health (`organizations.metadata.initial_sync_progress`)
4. Hold all webhook processing for this org until initial sync completes (avoid race conditions)

---

## 18. Per-Org Webhook Secrets

### 18.1 Why Per-Org

Original spec (§10.3) used a global `process.env.ZOHO_WEBHOOK_SECRET`. With 4 orgs, this means:
- Rotation of one secret affects all 4 orgs simultaneously
- A leak compromises all 4 orgs
- Cannot distinguish which org sent a payload before signature verification

**Solution:** store per-org webhook secret in `organizations.metadata.webhook_secret_encrypted` (AES-encrypted at app layer like OAuth tokens).

### 18.2 Schema Touch

No new column needed — reuse `organizations.metadata` JSONB:

```json
{
  "webhook_secret_encrypted": "<base64 AES-256-GCM ciphertext>",
  "webhook_secret_rotated_at": "2026-05-15T10:30:00Z",
  "webhook_secret_previous_encrypted": "<base64 — kept for 24h grace>"
}
```

### 18.3 Verification Flow

Each org configures Zoho webhooks with a URL like:

```
https://app.exceltechnologies.in/api/webhooks/zoho/{organizationId}/{eventType}
```

The `organizationId` in the path lets us resolve the secret before HMAC check.

```typescript
@Post('/webhooks/zoho/:orgId/:eventType')
async receiveWebhook(
  @Param('orgId') orgId: string,
  @Param('eventType') eventType: string,
  @Body() body: any,
  @Headers('x-webhook-secret') signature: string,
) {
  const org = await this.orgs.findOneOrFail(orgId);
  const secret = await this.crypto.decrypt(org.metadata.webhook_secret_encrypted);

  // Constant-time comparison; allow previous secret during 24h rotation grace
  const ok = this.crypto.constantTimeEquals(secret, signature)
          || (org.metadata.webhook_secret_previous_encrypted
              && this.crypto.constantTimeEquals(
                  await this.crypto.decrypt(org.metadata.webhook_secret_previous_encrypted),
                  signature));

  if (!ok) {
    this.logger.warn({ orgId, ip: req.ip }, 'webhook signature mismatch');
    throw new UnauthorizedException();
  }

  // Idempotency check via event_hash (§10.4)
  return this.webhookProcessor.enqueue(orgId, eventType, body);
}
```

### 18.4 Rotation Procedure (Admin UI)

1. Admin clicks "Rotate Webhook Secret" on org detail page
2. New 32-byte random secret generated
3. Store new secret in `webhook_secret_encrypted`; move old to `webhook_secret_previous_encrypted`
4. Display new secret to admin (one-time) so they can paste into Zoho webhook config
5. Set 24-hour grace window; after expiry, `webhook_secret_previous_encrypted` is purged

---

## 19. Per-Event Handler Routing Table

Explicit mapping from Zoho webhook event to Central App handler. Add `estimate_viewed` (missing from §10.1) since PRD §5A.3.8 needs it for notifications.

### 19.1 Event → Handler Map

| Zoho Event Type | Central Handler | What It Updates |
|---|---|---|
| `estimate_sent` | `EstimateWebhookHandler.onSent` | `quick_quotes.status='Sent'`, `sent_at=NOW()` |
| `estimate_viewed` | `EstimateWebhookHandler.onViewed` | `quick_quotes.viewed_at=NOW()`, `view_count++`; notify sales user |
| `estimate_accepted` | `EstimateWebhookHandler.onAccepted` | `quick_quotes.status='Accepted'`, `accepted_at=NOW()`; trigger conversion (Type 1) or new-sub (Type 2) |
| `estimate_declined` | `EstimateWebhookHandler.onDeclined` | `quick_quotes.status='Rejected'`, `rejected_at=NOW()` |
| `estimate_invoiced` | `EstimateWebhookHandler.onInvoiced` | Mark quote as converted to invoice (no DB action needed; cf_central_quote_id flows to invoice) |
| `invoice_created` | `InvoiceWebhookHandler.onCreated` | Update `subscriptions.last_invoice_*` if `cf_central_subscription_id` present (informational only — paid event is the source of truth) |
| `invoice_sent` | `InvoiceWebhookHandler.onSent` | No-op for MVP |
| `invoice_paid` | `InvoiceWebhookHandler.onPaid` | **Branches on `cf_business_type`** — see §16 above |
| `invoice_voided` | `InvoiceWebhookHandler.onVoided` | Roll back any subscription mutations done for this invoice; alert admin |
| `payment_created` | `PaymentWebhookHandler.onCreated` | Backup path if invoice_paid was missed; idempotent via `event_hash` |
| `contact_created` | `CustomerWebhookHandler.onCreated` | Upsert into `zoho_cache.entity_type='customer'` |
| `contact_updated` | `CustomerWebhookHandler.onUpdated` | Refresh `zoho_cache` row |
| `item_created` / `item_updated` | `ItemWebhookHandler.*` | Upsert into `zoho_cache.entity_type='item'` |

### 19.2 Dispatcher Implementation

```typescript
@Injectable()
export class WebhookDispatcher {
  private routes: Record<string, (orgId: string, payload: any) => Promise<void>> = {
    'estimate_sent':      (o, p) => this.estimateHandler.onSent(o, p),
    'estimate_viewed':    (o, p) => this.estimateHandler.onViewed(o, p),
    'estimate_accepted':  (o, p) => this.estimateHandler.onAccepted(o, p),
    'estimate_declined':  (o, p) => this.estimateHandler.onDeclined(o, p),
    'estimate_invoiced':  (o, p) => this.estimateHandler.onInvoiced(o, p),
    'invoice_created':    (o, p) => this.invoiceHandler.onCreated(o, p),
    'invoice_sent':       (o, p) => this.invoiceHandler.onSent(o, p),
    'invoice_paid':       (o, p) => this.invoiceHandler.onPaid(o, p),
    'invoice_voided':     (o, p) => this.invoiceHandler.onVoided(o, p),
    'payment_created':    (o, p) => this.paymentHandler.onCreated(o, p),
    'contact_created':    (o, p) => this.customerHandler.onCreated(o, p),
    'contact_updated':    (o, p) => this.customerHandler.onUpdated(o, p),
    'item_created':       (o, p) => this.itemHandler.onCreated(o, p),
    'item_updated':       (o, p) => this.itemHandler.onUpdated(o, p),
  };

  async dispatch(orgId: string, eventType: string, payload: any) {
    const handler = this.routes[eventType];
    if (!handler) {
      this.logger.warn({ orgId, eventType }, 'unmapped webhook event');
      return;  // unknown events are ignored (forward-compatibility)
    }
    return handler(orgId, payload);
  }
}
```

### 19.3 Retry Configuration

Read from `app_settings`:
- `zoho.webhook_max_retries` = 5
- `zoho.webhook_retry_intervals_seconds` = `[60, 300, 1800, 7200, 86400]` (1m → 5m → 30m → 2h → 24h)

On 5th failure: mark `webhook_events.processing_status='failed'`, alert admin, do not retry. Admin can manually retry from System Health (PRD §5A.3.13).

### 19.4 Idempotency Surface

Every handler MUST be idempotent. The dispatcher guarantees this by:
1. Computing `event_hash = SHA-256(eventType + payload.data.X.X_id + payload.data.X.last_modified_time)`
2. `INSERT INTO webhook_events (event_hash, ...) ON CONFLICT (event_hash) DO NOTHING RETURNING id`
3. If no row returned → event already processed, skip handler invocation

This means Zoho can deliver the same webhook 10 times — only the first one executes.

---

## Appendix A: Useful Zoho Reference URLs

- **API Docs:** https://www.zoho.com/books/api/v3/
- **OAuth Guide:** https://www.zoho.com/books/api/v3/oauth/
- **Custom Fields:** https://www.zoho.com/books/api/v3/custom-fields/
- **Webhooks:** https://www.zoho.com/books/api/v3/webhooks/
- **API Console (India):** https://api-console.zoho.in
- **Status Page:** https://status.zoho.com

---

## Appendix B: Common Pitfalls & Solutions

| Issue | Cause | Solution |
|---|---|---|
| 401 even after fresh OAuth | Wrong data center (.com vs .in) | Use `.in` base URLs for India |
| Custom field not appearing | Field name mismatch | Use exact `placeholder` from API |
| Webhook never fires | Wrong URL or HTTPS missing | Verify URL accessible from internet |
| Token refresh fails | Refresh token revoked | Re-do full OAuth flow |
| Rate limit hit quickly | Multiple parallel calls | Use rate limiter (Bottleneck) |
| GSTIN error on customer create | Wrong gst_treatment value | Use `business_gst` / `business_none` |
| Place of supply mismatch | Missing or wrong state code | Set `place_of_contact` with state code |
| Custom field value not saved | Wrong custom_field_hash format | Use array of `{label, value}` objects |
| Subscription dates changed on Pro-rata invoice | Handler not branching on `cf_business_type` | Use §16 invariant — Pro-rata only increments quantity |
| Duplicate Zoho contact on conversion retry | Missing idempotency check | Pre-check via `cf_central_lead_id` per §15.4 |
| Webhook delivered twice processed twice | event_hash collision missing | Insert `webhook_events` with UNIQUE event_hash per §19.4 |

---

**End of Document — Zoho Integration Spec v1.1**
**Changelog:**
- v1.0 (14 May 2026) — Initial spec (sections 1-14)
- v1.1 (15 May 2026) — Added sections 15-19 per pre-implementation audit:
  - §15 Atomic Lead-Conversion Sequence (compensating transactions)
  - §16 Pro-rata Webhook Handler (dates-unchanged invariant)
  - §17 Sync Engine Strategy (3 AM IST cron, delta + reconciliation)
  - §18 Per-Org Webhook Secrets (replaces global env secret)
  - §19 Per-Event Handler Routing Table (includes `estimate_viewed`)
