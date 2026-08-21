# Environment Setup

## Prerequisites
- Node.js (v18+)
- pnpm (Package manager)
- PostgreSQL (Running locally or via Docker)

## Local Setup Instructions
1. Clone the repository.
2. Run `pnpm install` in the root directory to install dependencies for all workspaces.
3. Configure `.env` files in `apps/api` and `apps/web` with your database URL and Zoho credentials.
4. Run `npx prisma db push` inside `packages/db` to sync the database schema.
5. Run `pnpm run dev` from the root directory to start both the NestJS backend and Next.js frontend concurrently.

## Environment Variables
Ensure the following are set in your backend `.env`:
- `DATABASE_URL`
- Zoho OAuth credentials (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, etc.)
