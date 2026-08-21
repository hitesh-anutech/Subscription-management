# Architecture

## Folder Structure
This project is a monorepo using Turborepo.

```text
/apps
  /api      - NestJS backend API
  /web      - Next.js 14 frontend application (App Router)
/packages
  /db       - Prisma ORM schema and database client
```

## System Architecture Diagram / Flow
1. **Frontend (Next.js):** Provides the user interface, renders server/client components, and communicates with the backend via `api-client`.
2. **Backend (NestJS):** Handles business logic, Zoho API communication, and PDF generation (`pdf-lib`).
3. **Database (PostgreSQL via Prisma):** Stores local copies of Subscriptions, Customers, Organizations, Domains, and Renewal Histories.
4. **External API (Zoho Books):** The source of truth for Estimates and Invoices.

## Cross-Cutting Concerns
- **PDF Generation:** Handled by `AnnexureService` in the backend, generating in-memory PDFs using `pdf-lib` and uploading them directly to Zoho using `multipart/form-data`.
