# Developer Handoff

**Date:** 2026-07-31  
**Session:** System Audit Logs Implementation + Deletion Flow & Server Action Refactoring  

---

## Project Summary

Excel Technologies के लिए Zoho Books के साथ एकीकृत Subscription-based Billing & Renewal Automation System।  
* **Tech Stack:** Next.js 14 App Router (frontend, port 3000), NestJS + Prisma ORM (backend, port 3001), PostgreSQL Database, Zoho Books REST API.  
* **Architecture:** pnpm + Turborepo monorepo:
  - `apps/web`: Next.js Client & Server Actions
  - `apps/api`: NestJS API REST endpoints & Zoho integration services
  - `packages/db`: Prisma schema & Database models

---

## What Was Completed This Session

### 1. System Audit Logs Implementation
* **Database Enum Synced:** Extended `AuditEntityType` Prisma enum with `lead`, `quote`, `subscription`, and `domain` values, successfully pushed to Postgres.
* **AuditLogs Module:** Created a globally registered `AuditLogsModule` in NestJS with `AuditLogsService` and `AuditLogsController` providing `GET /api/audit-logs?entityType=...&entityId=...`.
* **Core Service Integration:** Injected `AuditLogsService` across Leads, Quotes, Subscriptions, and Domains CRUD operations to track changes automatically.
* **HistoryDialog Component:** Designed a reusable client-side component featuring a small clock icon triggering a glassmorphic chronological timeline timeline modal. Integrated on Lead, Quote, Subscription details, and Domain list view rows.

### 2. Secure Bulk & Single Deletion Fixes
* **Lead Deletion Constraint Failures Fixed:** Modified backend `LeadsService.remove` to delete related `LeadConversion` and `QuickQuote` entries within a Prisma transaction first, bypassing `onDelete: Restrict` constraint.
* **Draft-only Quote Delete Restriction Lifted:** Removed state validation check in `QuickQuotesService.remove` for Admins, allowing deletions of quotes in Sent, Rejected, or Expired states.
* **Subscription Deletion Client CORS Error Fixed:** Swapped browser-side `api.delete` loops with a secure frontend server action `deleteMultipleSubscriptionsAction` inside a new `actions.ts`.

---

## Files Modified

### Backend (`apps/api`)
* [audit-logs.service.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/audit-logs/audit-logs.service.ts) [NEW] — Main logging logic.
* [audit-logs.controller.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/audit-logs/audit-logs.controller.ts) [NEW] — REST endpoints for logs.
* [audit-logs.module.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/audit-logs/audit-logs.module.ts) [NEW] — Globally exported module.
* [app.module.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/app.module.ts) — Registered `AuditLogsModule`.
* [leads.module.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/leads/leads.module.ts) — Imported `AuditLogsModule`.
* [leads.controller.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/leads/leads.controller.ts) — Passed `CurrentUser` to leads service.
* [leads.service.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/leads/leads.service.ts) — Injected audit logs, transactionally deletes conversions and quotes on remove.
* [quick-quotes.module.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/quick-quotes/quick-quotes.module.ts) — Imported `AuditLogsModule`.
* [quick-quotes.controller.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/quick-quotes/quick-quotes.controller.ts) — Passed `CurrentUser` to quotes service.
* [quick-quotes.service.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/quick-quotes/quick-quotes.service.ts) — Injected audit logs, removed draft-only restriction on remove.
* [subscriptions.module.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/subscriptions/subscriptions.module.ts) — Imported `AuditLogsModule`.
* [subscriptions.controller.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/subscriptions/subscriptions.controller.ts) — Passed `CurrentUser` to service.
* [subscriptions.service.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/subscriptions/subscriptions.service.ts) — Injected audit logs.
* [domains.module.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/domains/domains.module.ts) — Imported `AuditLogsModule`.
* [domains.controller.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/domains/domains.controller.ts) — Passed `CurrentUser` to service.
* [domains.service.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/api/src/domains/domains.service.ts) — Injected audit logs.

### Frontend (`apps/web`)
* [history-dialog.tsx](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/web/src/components/history-dialog.tsx) [NEW] — Glassmorphic timeline popup component.
* [leads/[id]/page.tsx](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/web/src/app/dashboard/leads/%5Bid%5D/page.tsx) — Added `HistoryDialog` in header.
* [quick-quotes/[id]/page.tsx](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/web/src/app/dashboard/quick-quotes/%5Bid%5D/page.tsx) — Added `HistoryDialog` in header.
* [subscriptions/[id]/page.tsx](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/web/src/app/dashboard/subscriptions/%5Bid%5D/page.tsx) — Added `HistoryDialog` in header.
* [domains-table.tsx](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/web/src/app/dashboard/domains/_components/domains-table.tsx) — Added `HistoryDialog` inside domain rows.
* [actions.ts](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/web/src/app/dashboard/subscriptions/actions.ts) [NEW] — `deleteMultipleSubscriptionsAction` server action.
* [subscriptions-table.tsx](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/apps/web/src/app/dashboard/subscriptions/_components/subscriptions-table.tsx) — Uses `deleteMultipleSubscriptionsAction`.

### Database Schema (`packages/db`)
* [schema.prisma](file:///c:/Projects/Subscription%20Management%20with%20Zoho%20Books/packages/db/prisma/schema.prisma) — Extended `AuditEntityType` enum.

---

## Database Changes
* Updated Prisma schema `AuditEntityType` enum to include `lead`, `quote`, `subscription`, and `domain`.
* Synced directly using local monorepo command: `pnpm --filter @subs/db exec prisma db push`.

---

## APIs Added or Changed
* **`GET /api/audit-logs`**: Fetch audit logs for an entity.
  - Query parameters: `entityType` (`lead` | `quote` | `subscription` | `domain`), `entityId` (UUID).
  - Response: Array of audit logs with user email, timestamps, action, and change summaries.
* **`DELETE /api/leads/:id`**: Performs cascade transaction to clean up conversions and quotes pointing to the lead.
* **`DELETE /api/quick-quotes/:id`**: Clean up allowed for quotes in any status (previously draft-only).

---

## Important Architectural Decisions
* **Server Action Routing for Deletes:** Swapped browser-side fetch calls in list views with frontend Server Actions (`deleteMultipleSubscriptionsAction`, etc.). This securely forwards cookies, handles CORS context cleanly, and enforces admin-only checks on the server-side before execution.
* **Transactional Cascades on Delete:** Since PostgreSQL has restricted foreign key actions for quotes and conversions pointing to leads, we delete relations transactionally inside the backend service rather than altering the schema constraints.

---

## Remaining Bugs & Limitations
* **Database Has No Backup:** Immediately implement a postgres backup strategy. All historical data was lost in a previous session's reset.
* **No Global Authorization Layer:** Authentication is enforced, but endpoint-level RBAC and tenant org scoping (enforcing `allowed_org_ids` per user) are not fully wired.
* **Webhook Signature Verification:** Webhook endpoints do not verify signature payloads.
* **`DomainStatus` CHECK Constraint:** DB migration check constraint allows `active/inactive/transferred/lost` but Prisma enum has `active/inactive/suspended`. Reconcile this drift to prevent suspended domains from throwing DB errors.

---

## Pending Tasks
1. Re-connect Zoho organizations (OAuth) and re-sync custom fields + master data.
2. Add signature verification logic on Zoho webhook endpoints.
3. Wire authorization checking (`RolesGuard`) for all non-admin roles across business endpoints.

---

## Exact Next Step
> [!IMPORTANT]
> **Next Step:** Implement the **Authorization Guard / RBAC (`RolesGuard`)** on NestJS endpoints to block Sales/Viewer roles from hitting deletion or CSV export/import endpoints.

---

## Warnings for the Next Developer
* **Do not use `npx prisma` at the root!** It invokes Prisma 7.0+ which will throw environmental errors. Always execute prisma commands using:  
  `pnpm --filter @subs/db exec prisma db push`
* **Do not run `prisma db push --force-reset`!** This will wipe the database.
