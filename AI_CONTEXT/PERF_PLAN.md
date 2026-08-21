# Performance & Zoho-API-Reduction Plan

> **Motive:** app ko fast banana + minimum Zoho Books API calls.
> **Date:** 2026-07-14 · **Scope:** `apps/api` (mostly), thoda `apps/web`.
> Har item ke saath: problem, exact file, change, aur expected impact.

---

## 0. Context — abhi baseline kya hai

- **Rate limit:** `ZohoApiClient` per-org — `reservoir: 80/min`, `maxConcurrent: 5` (`apps/api/src/zoho/zoho-api.client.ts`).
- **Cache:** `zoho_cache` table sirf `customer` + `item` entities ke liye use hota hai. Estimates/invoices ka **koi read cache nahi**.
- **Webhooks:** `POST /zoho/webhook` wired hai aur DB update karta hai (`webhook.service.ts`), par processing **synchronous** hai (MVP, no queue).
- **Web layer:** `apps/web/src/lib/api.ts` har request pe `cache: 'no-store'`.

**Sabse bada dard:** Documents browser aur Import wizard **N+1(+N)** pattern pe chalte hain — ek 50-row page ~100–110 Zoho calls maarta hai. 80/min limit ke saath ye ek page load ko rate-budget ke against ~20s+ bana deta hai.

---

## Priority order (impact-first)

| # | Item | Zoho-call impact | Speed impact | Effort |
|---|------|------------------|--------------|--------|
| 1 | Estimates/invoices detail ka short-TTL read cache | 🔴 Bahut bada (−70–90%) | 🔴 Bada | M |
| 2 | Cross-link columns local DB se (extra per-row call khatam) | 🔴 Bada (−~40 calls/page) | 🟠 Medium | M |
| 3 | Webhook-first status; Refresh polling default se hatao | 🟠 Medium (recurring) | 🟢 Chhota | M |
| 4 | In-memory token cache | ⚪ None (DB call, Zoho nahi) | 🟠 Har call ki latency | S |
| 5 | `getCustomerDetail` stale-while-revalidate | 🟠 Medium (1/page-view) | 🟠 Medium | S |
| 6 | Org-settings ek baar load; delta sync | 🟢 Chhota | 🟢 Chhota | S–M |

Effort: S=small (<½ din), M=medium (1–2 din).

---

## 1. Estimates/Invoices detail — short-TTL read cache 🔴

**Problem**
`apps/api/src/documents/documents.service.ts` → `fetchDocuments()` aur
`apps/api/src/zoho/zoho.service.ts` → `fetchInvoicesForImport()` / `fetchEstimatesForImport()`:
- 1 list call → phir **har row pe 1 detail call** (list endpoint line-items/custom-fields nahi deta) → ~50 calls.
- Import wizard me upar se linked-estimate lookups (~60 aur).

**Fix**
1. `zoho_cache` ko reuse karo (naya table zaroorat nahi) — naye `entityType`: `'estimate'` / `'invoice'`. `zohoId` = doc id, `extra` = poora detail JSON, `lastSyncedAt` = fetch time.
2. Ek helper banao — `ZohoService.getDocDetailCached(orgId, kind, id, ttlMs)`:
   - Cache hit + `Date.now() - lastSyncedAt < ttl` → cached `extra` return karo, **koi Zoho call nahi**.
   - Warna Zoho se lao, upsert karo, return karo.
3. `documents.service.ts` aur import fetchers me har `client.get('/estimates/{id}')` / `/invoices/{id}` ko is helper se replace karo.

**TTL suggestion:** documents browser (read-only, log baar-baar wahi filter dekhte hain) → **10–15 min**. Import wizard → **5 min**.

**Expected impact:** repeat page loads pe detail calls ~0 tak; overall Zoho calls **−70–90%**. Yehi single sabse bada win hai.

**Cache invalidation:** webhook (`invoice_created`, `payment_added`, `estimate_updated`) aane pe us doc ka cache row delete/refresh kar do — taaki status stale na dikhe.

---

## 2. Cross-link columns local DB se 🔴

**Problem**
`documents.service.ts` → `addLinkedFields()` har row ke liye ek **extra** Zoho call karta hai (quote→invoice ya invoice→estimate). 50 rows = up to 50 extra calls.

**Fix**
- Invoice ki payment info already uske detail me hai (`payments` / `last_payment_date`) — wahi use ho raha hai, theek hai.
- Linked **invoice/estimate number + status** ke liye alag call ki zaroorat nahi — ye local `renewal_history` (quoteId, invoiceId, invoiceNumber, zohoInvoiceStatus, paymentDate) aur `subscription.lastInvoice*` me webhook se already update hota hai.
- `addLinkedFields()` ko rewrite karo: pehle **local DB** me quoteId/invoiceId se dekho; mil gaya to local se bharo (**0 Zoho calls**). Sirf jab local me nahi mila (purana data) tabhi #1 ka cached helper use karke fallback.

**Expected impact:** per-page ~40 calls tak bachat (jitne rows ke paas linked doc hai).

---

## 3. Webhook-first status; Refresh polling hatao 🟠

**Problem**
Webhook DB update kar raha hai, phir bhi manual **Refresh** buttons Zoho ko dobara poll karte hain:
- `subscriptions.service.ts`: `refreshProformaStatus` (single), batch `refresh` (`/estimates/{id}` + `/invoices/{id}` reads).
- UI: subscription detail timeline, renewal-batch review screen, documents browser.

**Fix**
1. Status **hamesha local DB** se dikhao (webhook se maintained).
2. "Refresh" ko default flow se hatao → optional **"Force sync from Zoho"** bana do (kabhi webhook miss ho jaaye to).
3. **Verify webhooks live:** `webhook_events` table check karo ki estimate/invoice/payment events aa rahe hain. Agar reliable → polling safely band.
4. **Reliability:** webhook processing abhi synchronous — high volume pe ek proper queue (BullMQ / DB-backed) laga do taaki request block na ho aur retry ho sake.

**Expected impact:** recurring status-check calls lagbhag khatam.

---

## 4. In-memory token cache 🟠 (latency, Zoho-calls nahi)

**Problem**
`zoho.service.ts` → `getValidAccessToken()` axios request interceptor me chalta hai, matlab **har** Zoho request pe ek `organization.findUnique` + AES `decrypt`. Token ~1 ghanta valid.

**Fix**
`ZohoService` me `Map<orgId, { token: string; expiresAt: number }>` rakho.
- `getValidAccessToken`: pehle memory dekho; `expiresAt - now > 60s` → wahi return (no DB, no decrypt).
- `refreshToken` / `completeOAuth` / `disconnect` pe map entry update/clear karo (`clientCache` ke saath hi).

**Expected impact:** har Zoho call pe ek DB round-trip + decrypt bachega → tangible latency drop, DB load kam. (Multi-instance deploy ho to bhi safe — worst case har instance apna token cache karega.)

---

## 5. `getCustomerDetail` — stale-while-revalidate 🟠

**Problem**
`zoho.service.ts` → `getCustomerDetail()` har customer-page view pe poora Zoho contact **live** fetch karta hai (billing_address/contact_persons/contact_number ke liye).

**Fix**
- Poora contact `zoho_cache.extra` me store karo (sync ke waqt ya first fetch pe).
- Detail page pe **cached turant** return karo; agar `lastSyncedAt` purana (e.g. >24h) to **background** me refresh (response block mat karo).
- Ya ek explicit "Sync from Zoho" button (jo already `syncSingleCustomer` se hai).

**Expected impact:** 1 Zoho call per customer-page-view bachega; page instant.

---

## 6. Micro-optimizations 🟢

**6a. Org-settings ek baar load**
`buildCustomFields`, `getBusinessTypeLabel`, `getBillingOptions`, `getItemFieldMappings` — har ek `orgSettings.findUnique` alag se karta hai. `bulkRenewalQuote` loop me per-group repeat hota hai.
→ Ek `getOrgSettingsMeta(orgId)` (request-scoped memo ya simple param) banao, ek baar load karke pass karo.

**6b. Delta sync**
`syncCustomers` / `syncItems` roz **saare** records re-upsert karte hain. Zoho ka `last_modified_time` filter use karke sirf changed records lao.
→ Daily sync tez, kam Zoho pages, kam DB writes.

**6c. Web read caching**
`apps/web/src/lib/api.ts` har jagah `cache: 'no-store'`. Read-heavy list pages (subscriptions, domains) pe chhota `next: { revalidate: N }` ya tag-based revalidation.

**6d. Bottleneck tuning**
#1 ke baad calls kam honge; phir `maxConcurrent` thoda badhaya (5→8) ja sakta hai burst ke liye — 80/min reservoir ke andar rehkar. Pehle #1–#2 karo, phir measure.

---

## Verification / measurement

- **Before/after Zoho-call count:** ek dev counter interceptor lagao (`ZohoApiClient` me per-request log/metric) — har feature ke liye "N calls per page" note karo.
- **Cache hit-rate log** helper me.
- Documents browser + Import wizard + customer detail + batch refresh — chaaro flows ko live Zoho org pe drive karke before/after compare karo.
- Regression: webhook-first status ke baad ek known estimate ko accept→invoice→pay karke confirm karo ki status bina Refresh ke sahi dikhta hai.

---

## Suggested execution sequence

1. **#4 token cache** (S, safe, turant latency) — warm-up ke taur pe.
2. **#1 detail read cache** (M) — sabse bada Zoho-call win.
3. **#2 cross-link local-first** (M) — #1 ke helper pe build hota hai.
4. **#5 customer detail SWR** (S).
5. **#3 webhook-first + queue** (M) — webhook reliability confirm hone ke baad.
6. **#6 micro** (S–M) — cleanup pass.

> Har step ke baad Zoho-call count measure karke CHANGELOG me note karo.
