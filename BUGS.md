# Bugs

## Open / Remaining

### Critical: Database Has No Backup (added 2026-07-29)
The entire database was wiped by an accidental `prisma db push --force-reset`. All business data (orgs, leads, quotes, subscriptions, customers, settings) was lost. Schema and seed data have been restored, but business records cannot be recovered. **There is no backup.** Immediately set up a PostgreSQL backup strategy (pg_dump cron job or managed DB with point-in-time recovery).

### Reported 2026-07-18

- **Quote-number autofill collision** (severity: medium): Creating a new quote can fail with `Unique constraint failed on: quote_number`. Auto-numbering is a Postgres sequence (`generate_quote_number()`), so it cannot collide on its own — the cause is the browser **autofilling an existing number** into the "blank = auto" Quote Number input. **Fix:** add `autoComplete="off"` to the input (`quote-builder.tsx`), catch the P2002 unique violation in `quick-quotes.service.ts` and return a friendly message.

### Security / architecture findings (multi-agent review, 2026-07-18) — not yet fixed

- **No authorization layer** (critical): Authentication works (global guard + sessions), but no endpoint checks `role`, and the per-user `allowed_org_ids` metadata is never enforced. Any logged-in user can read/write all orgs' data and hit admin endpoints. Needs `RolesGuard` + `@Roles()` + org scoping.
- **Zoho webhook is unauthenticated** (critical): `POST /api/zoho/webhook` is `@Public()`, takes `org_id` from the query string, and does no signature/secret verification. Anyone reachable can forge subscription state changes.
- **`DomainStatus` enum drift** (critical): applied migration CHECK allows `active/inactive/transferred/lost` but the Prisma enum + app code use `active/inactive/suspended`. Setting a domain to `suspended` will violate the DB constraint.
- **Unsanitized email HTML** (high): the send-email compose modal (`contenteditable` → raw `innerHTML`) and template preview (`dangerouslySetInnerHTML`) are unsanitized. Sanitize with DOMPurify.
- **Zoho token refresh race** (high): `getValidAccessToken()` does check-then-refresh with no per-org lock; concurrent requests trigger parallel refreshes.
- **Lead conversion not idempotent** (high): no pre-check for an existing Zoho contact by `cf_central_lead_id` → retry after partial failure creates a duplicate customer.
- **Cron jobs have no locking** (high): scheduler jobs can double-fire in a multi-instance deployment (duplicate reminder emails).
- See HANDOFF.md (2026-07-18) for the full list (money-math rounding, domain find-or-create races, Prisma version drift, `/api/health/system` recon leak, etc.).

### Long-standing

- **`CsvImportLog` schema drift**: the model exists in `schema.prisma` but there is no migration for it (only `0001_init`). DB and migration history are out of sync.
- **`%LastName%` / `%ExpiryDate%` placeholders not replaced in Zoho email**: Zoho's own template placeholders that Zoho fails to substitute (Zoho-side bug, fix in Zoho Books Settings → Email Templates).

---

## Resolved

### 2026-07-31
- **Lead Deletion Constraint Failures**: Wiping a lead would fail on Prisma foreign-key restrictions. Fixed by transactionally deleting related `LeadConversion` and `QuickQuote` entities first.
- **Quote Deletion Draft-only Lock**: Quote deletion on Admin bulk deletes failed for non-Draft quotes. Fixed by removing status restriction on Admin-triggered quote deletion.
- **Subscription Deletion Client-Side CORS Error**: Bulk deleting subscriptions failed in browser due to direct client-side fetch restrictions. Fixed by routing deletion through `deleteMultipleSubscriptionsAction` server action.

### 2026-07-29
- **Wrong tab on Lead → +New Quote for converted leads**: Both ternary branches returned `'lead'` — `preselectedLead ? 'lead' : 'lead'`. Fixed by deriving `isConvertedLead` from `preselectedLead?.convertedToZohoCustomerId`. **Fix:** `quote-builder.tsx` + `new/page.tsx`.
- **SendGrid "Unauthorized" error**: Expired/invalid API key in DB; also improved error extraction to read `ResponseError.response.body.errors[0].message`. **Fix:** replaced SendGrid entirely with Gmail SMTP.
- **`sendFromTemplate` broken after email rewrite**: Accidentally replaced the method with a throw during Brevo migration. **Fix:** restored the original Prisma-based implementation in the Gmail SMTP version.
- **Database wiped by `--force-reset`**: Schema recreated via `schema.sql` + `prisma db push`; seed data re-applied; admin user re-created.

### 2026-07-18
- **Multi-item invoice created only the first subscription** — new list view creates all items.
- **All conversion subscriptions inherited one domain** — now uses per-item `primaryDomain`.
- **Fresh sale invisible in history** — Fresh row written/synthesized on subscription create.
- **Invoice duplicated in customer Order History** (once per subscription) — grouped by invoice id.

### 2026-07-07
- **"View in Zoho" link 404**: URL used `/estimates/`; Zoho Books uses `/quotes/`.
- **`cf_central_subscription_id` Zoho rejection**: field pushed even when unmapped.
- **Pro-rata false "success"**: `name` in line_items with `item_id`, unrounded float rate, swallowed error.
- **Fallback error messages instead of real Zoho errors**: `AllExceptionsFilter` wraps as `{ error: { message } }`; added `parseApiError()`.
- **Bulk renewal webhook broken**: fixed with `estimateId`-based lookup.

### 2026-07-01
- **Windows/Chromium file-picker crash**: `accept=".csv"` removed.
- **CSV import "0 update"**: "Suspend(ed)" mapped to `Inactive`.
- **Unsupported Server Component error**: default/named import corrections.
- **TypeScript error in QuickQuoteSelect**: removed non-existent `businessType` from select.
