# Plan: Sync customer GST / details to Zoho after a lead is converted

## Context
Scenario: ek lead pehle limited info (no GSTIN, GST = Unregistered) ke saath bani, convert hone par Zoho me **Customer + draft Invoice** ban gaye. Baad me customer ne GSTIN diya. User ne **Lead edit** karke GSTIN bhara aur GST status Unregistered→Registered kiya — par ye change **Zoho me jaata hi nahi**, kyunki:
- Lead edit aaj **pure local DB patch** hai, koi Zoho push nahi (`leads.service.ts`, `leads/actions.ts:48`).
- **GST Treatment dropdown silently discard** hota hai — na update allow-list me, na DTO me; conversion par bhi sirf `gst_no` jaata hai, `gst_treatment` kabhi nahi (`conversions.service.ts:152`).
- Zoho contact ka sirf **create** path hai; `put()` client method maujood hai par unused — koi `updateContact` nahi.

Philosophy (Zoho = paying-customer master + accounting; app = lightweight): edit app me ho par Zoho **single source of truth** rahe. Decision (user-confirmed):
- **Lead edit page** (app se convert hue customers): app me edit + explicit **"Update in Zoho"** push (one-way write of app-managed fields: GSTIN, GST treatment, billing address, PAN). + "View in Zoho" link.
- **Customer detail page** (imported/general customers): **koi edit form nahi** — display-only rahe, **"Open in Zoho"** deep-link se Zoho me edit, aur **"Sync from Zoho"** se app cache refresh.
- **Draft invoice**: contact-only. App invoice ko touch na kare. Bas invoice ka "View in Zoho" link de; Zoho me invoice re-save karne par updated GST auto-apply ho jaata hai. (Intra-state pe tax same; inter-state pe CGST/SGST↔IGST flip Zoho khud handle karega.)

## Existing facts (reuse)
- `Lead.convertedToZohoCustomerId` (schema ~line 343) conversion par set hota hai (`conversions.service.ts:241`). `Lead.gstin`, `pan`, `state`, `stateCode`, billing address fields maujood.
- Contact create payload shape: `conversions.service.ts:134-156` (flat body — `post('/contacts', payload)`, NOT `{contact:...}`; per [[zoho-write-api-gotchas]]). gst_no, pan_no, billing_address, custom_fields (index-keyed).
- `ZohoApiClient.put()` `zoho-api.client.ts:117` — exists, unused.
- "View in Zoho" URL pattern (invoices): `https://books.zoho.in/app/${zohoOrgId}#/invoices/${id}` (`conversions.service.ts:479`). Contacts → `#/contacts/${zohoId}`.
- `getCustomerDetail(orgId, zohoId)` `zoho.service.ts:727` returns cached customer + linked subs/domains/quotes (read-only). Bulk `syncCustomers()` already exists.
- GST Treatment dropdown values (form): business_gst / business_none / consumer / overseas / sez.

## A. Persist GST treatment on the lead (fix the discarded field)
1. `packages/db/prisma/schema.prisma` `Lead`: add `gstTreatment String? @map("gst_treatment") @db.VarChar(20)`. Apply via `prisma db push` (shadow-DB perm) + regen client (stop API first to avoid EPERM).
2. `apps/api/src/leads/dto/leads.dto.ts`: add `@IsOptional() @IsString() gst_treatment?: string` to Create + Update DTOs.
3. `apps/web/src/app/dashboard/leads/actions.ts`: add `'gst_treatment'` to the `fields` allow-list in **both** create + update actions.
4. `apps/api/src/leads/leads.service.ts`: map `gst_treatment` in create + update.
5. `apps/web/.../leads/[id]/_components/edit-lead-panel.tsx` (+ new `lead-form.tsx`): pre-select the GST Treatment dropdown from `lead.gstTreatment` (default by gstin presence: gstin→business_gst else business_none).

## B. Zoho contact update method (new write path)
6. `apps/api/src/zoho/zoho.service.ts`: add `updateContactDetails(orgId, zohoContactId, { contactName, gstNo, gstTreatment, panNo, billingAddress })` → `clientFor(orgId)` then `put('/contacts/' + zohoContactId, flatPayload)`. Flat body (gst_no, gst_treatment, pan_no, billing_address). Do NOT re-push custom_fields (keep focused; avoid the index gotcha surface). Return the updated contact_id/status.

## C. API endpoint: push converted lead's GST/details to Zoho
7. `apps/api/src/leads/leads.service.ts` (inject `ZohoService`; ensure `LeadsModule` imports `ZohoModule`): add `syncToZoho(leadId)`:
   - load lead; guard `convertedToZohoCustomerId` present (else `BadRequestException('Lead not yet converted to a Zoho customer')`).
   - call `zoho.updateContactDetails(targetOrganizationId, convertedToZohoCustomerId, {…current lead fields…})`.
   - return `{ ok: true, zohoCustomerId }`.
8. `apps/api/src/leads/leads.controller.ts`: `@Post(':id/sync-to-zoho')` (authenticated) → `service.syncToZoho(id)`.

## D. Web: Lead edit page — "Update in Zoho" + "View in Zoho"
9. `apps/web/.../leads/actions.ts`: `syncLeadToZohoAction(id)` → POST `/leads/:id/sync-to-zoho`, revalidate lead path, return `{ok|error}`.
10. Lead edit page/panel: when `lead.convertedToZohoCustomerId` set, render a small banner ("Yeh lead ab Zoho customer hai — yahan ke changes tab tak Zoho me nahi jaate jab tak push na karein") + two buttons: **🔄 Update in Zoho** (calls action; spinner + success/err) and **🔗 View in Zoho** (`https://books.zoho.in/app/{zohoOrgId}#/contacts/{convertedToZohoCustomerId}`). Need `zohoOrgId` in the lead page payload (extend the lead GET to include `targetOrganization.zohoOrgId`, or fetch). Button pushes the **last saved** lead state (so user: Save Changes → Update in Zoho).

## E. Web: Customer detail page — "Open in Zoho" + "Sync from Zoho"
11. `apps/api/src/zoho/zoho.service.ts`: add `syncSingleCustomer(orgId, zohoId)` → GET `/contacts/{zohoId}` from Zoho, upsert that one row into `zoho_cache` (mirror the field mapping used by bulk `syncCustomers()`). Return refreshed customer.
12. `getCustomerDetail` return: also include `zohoOrgId` (for the deep-link).
13. `apps/api/src/organizations/...` (customers controller): `@Post(':orgId/customers/:zohoId/sync')` → `zoho.syncSingleCustomer`.
14. `apps/web/.../customers/[zohoId]/page.tsx`: keep display-only; add header actions — **🔗 Open in Zoho** (`#/contacts/{zohoId}`) and **🔄 Sync from Zoho** (server action → POST sync → `router.refresh()`). New small client component `_components/customer-sync-actions.tsx`.

## F. Conversion correctness (small, while we're here)
15. `conversions.service.ts` contact payload: also send `gst_treatment: lead.gstTreatment ?? (lead.gstin ? 'business_gst' : 'business_none')` so **new** conversions set treatment correctly (today only gst_no goes).

## Out of scope / notes
- Customer detail page par editable form nahi (user decision) — sirf imported customers ke liye Zoho-edit + sync-back.
- Draft/any invoice ka GST app se patch nahi hoga. Agar invoice already **sent/paid** ho to Zoho me hi credit-note/fresh-invoice se handle karein.
- SEZ/overseas gst_treatment edge values pass-through; primary focus business_gst/business_none.
- Multi-DC: deep-links abhi `.in` hardcode (saare orgs IN).

## Verification (end-to-end, real surface)
1. `tsc --noEmit` dono apps → 0; `prisma db push` + regen; servers up (API 3001, web 3000).
2. **Lead push**: ek converted lead lo (ya banao → convert). Lead edit me GSTIN bharo + GST Treatment = Registered → Save → **Update in Zoho**. MCP `get_contact(zohoCustomerId)` se confirm `gst_no` + `gst_treatment=business_gst` updated. (Driver script + minted session, jaisa pichli baar — Excel Cloud AI org 60066188933.)
3. Negative: bina-converted lead par sync-to-zoho → clean 400.
4. **Customer page**: kisi imported customer ka detail kholo → **Open in Zoho** link sahi `#/contacts/{id}` pe jaaye. Zoho me (ya MCP `update_contact`) GSTIN change karke app me **Sync from Zoho** → page par naya GSTIN dikhe.
5. **Invoice untouched**: confirm app ne invoice ko modify nahi kiya (MCP get_invoice unchanged).
6. Cleanup: test lead/customer changes revert (MCP), minted session + temp files delete.
