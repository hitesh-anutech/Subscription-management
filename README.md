# Subscription Management Tool

Excel Technologies — central app that works alongside Zoho Books to manage quick quotes, leads, subscription lifecycle, and cross-org unified views across 4 Zoho Books organizations.

**Status:** Sprint 1 (Week 1-2) — Foundation + Organizations + Zoho OAuth

---

## What's in this Repo

### Code (implementation)

```
/
├── apps/
│   ├── api/           # NestJS backend (TypeScript) — port 3001
│   └── web/           # Next.js 14 frontend (App Router) — port 3000
├── packages/
│   └── db/            # Prisma schema + migrations + seed
├── package.json       # pnpm workspaces root
└── pnpm-workspace.yaml
```

### Specification documents

| File | Purpose |
|---|---|
| `REVISED_PRD_v4.md` | Product Requirements Document v4.0 |
| `schema.sql` | PostgreSQL DDL (source of truth) |
| `seed_default_settings.sql` | Default settings seed data |
| `01_OPEN_QUESTIONS_RESOLUTION.md` | 15+ business decisions with rationale |
| `02_ZOHO_INTEGRATION_SPEC.md` | Zoho Books integration spec v1.1 |
| `03_API_CONTRACTS_OPENAPI.yaml` | OpenAPI 3.0 contracts v1.1 |
| `04_UI_WIREFRAMES.html` | 13 screen wireframes |
| `05_prisma_schema.prisma` | Prisma ORM schema v1.2 |
| `06_PRE_IMPLEMENTATION_AUDIT.md` | Pre-implementation audit report |

---

## Prerequisites (Local Development)

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 20.10+ | Runtime |
| **pnpm** | 8.15+ | Package manager (workspaces) |
| **PostgreSQL** | 15+ | Database |
| **Redis** | 7+ | Queues + cache |
| **Git** | any | Version control |

### Install Postgres (Windows)

Download installer from [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/). During setup:
- Port: `5432`
- Password for `postgres`: remember it
- Locale: default

Create the app database after install:

```bash
psql -U postgres
```

```sql
CREATE USER subs_user WITH PASSWORD 'subs_pass';
CREATE DATABASE subscriptions OWNER subs_user;
GRANT ALL PRIVILEGES ON DATABASE subscriptions TO subs_user;
\c subscriptions
GRANT ALL ON SCHEMA public TO subs_user;
```

### Install Redis (Windows)

Easiest: use [Memurai](https://www.memurai.com/) (Redis-compatible, native Windows). Or use WSL2 + `apt install redis-server`. Default port `6379`.

Confirm: `redis-cli ping` → `PONG`.

### Install pnpm

```bash
npm install -g pnpm@8.15.6
```

---

## First-Time Setup

```bash
# 1. Clone (skip if already in folder)
cd "Subscription Management with Zoho Zooks"

# 2. Copy env template and edit it
cp .env.example .env
#    → Set DATABASE_URL, REDIS_URL
#    → Generate ENCRYPTION_KEY:
#      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#    → Paste into .env

# 3. Install dependencies (all workspaces)
pnpm install

# 4. Run database migration (creates 20 tables)
pnpm db:migrate

# 5. Seed defaults (app_settings, master_data_lists, email_templates, first admin user)
pnpm db:seed

# 6. Start both API (:3001) and Web (:3000) in parallel
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Log in with the bootstrap admin email/password from `.env`.

---

## Zoho OAuth Setup (per organization)

Each of Excel's 4 Zoho Books orgs needs a connection. Steps per org:

### 1. Register a Self-Client (one-time, for the developer account)

1. Go to [https://api-console.zoho.in](https://api-console.zoho.in)
2. Click **Add Client** → **Self Client**
3. Note the **Client ID** and **Client Secret**
4. Paste into root `.env`:
   ```
   ZOHO_CLIENT_ID="..."
   ZOHO_CLIENT_SECRET="..."
   ```

### 2. Configure required scopes (per Zoho Spec §3)

```
ZohoBooks.fullaccess.all
ZohoBooks.settings.READ
```

### 3. Connect via the app UI

1. Log in to the app
2. Settings → Organizations → **+ Add New Organization**
3. Fill in name, Zoho Org ID (find in Zoho Books → Settings → Org Details)
4. Click **Connect Zoho**
5. Authorize on Zoho → redirect back → org card turns green ✓ Connected

### 4. Set up custom fields in Zoho (manual, per Zoho Spec §4)

Per the integration spec, create these custom fields in each Zoho org's **Books → Settings → Custom Fields**:

| Module | Field Label | Data Type | Purpose |
|---|---|---|---|
| Contacts | `cf_central_lead_id` | Single line | Central lead UUID |
| Estimates | `cf_central_quote_id` | Single line | Central quote UUID |
| Estimates | `cf_central_subscription_id` | Single line | For Renewal/Pro-rata |
| Estimates | `cf_business_type` | Drop-down | Fresh / Renewal / Pro-rata |
| Invoices | `cf_central_subscription_id` | Single line | Link to Central sub |
| Invoices | `cf_business_type` | Drop-down | Mirrors estimate |

Full setup checklist in [02_ZOHO_INTEGRATION_SPEC.md §13](./02_ZOHO_INTEGRATION_SPEC.md).

---

## Useful Commands

```bash
# Run only the API
pnpm dev:api

# Run only the web
pnpm dev:web

# Open Prisma Studio (DB browser)
pnpm db:studio

# Reset DB (DROPs everything, re-migrates, re-seeds)
pnpm db:reset

# Typecheck across all packages
pnpm typecheck

# Lint
pnpm lint
```

---

## Sprint 1 Scope (this version)

✅ Project scaffolding (monorepo, NestJS API, Next.js web)
✅ Postgres schema + seed
✅ Crypto service (AES-256-GCM for OAuth tokens)
✅ Organizations CRUD (list, add, edit, soft-delete)
✅ Zoho OAuth flow (connect, callback, disconnect, reconnect, token refresh)
✅ Connection health endpoint
✅ Basic Settings → Organizations UI (matches wireframe Screen 9)

🔜 Sprint 2 (Week 3): Email Configuration + template editor
🔜 Sprint 3 (Week 4): PDF Branding
🔜 Sprint 4 (Week 5): Quote builder + Tax/GST settings
🔜 Sprint 5 (Week 6): Lead Management + Master Data UIs
🔜 Sprint 6 (Week 7): Subscription Lifecycle Rules
🔜 Sprint 7 (Week 8): Notifications + System Health dashboard

Full plan in [REVISED_PRD_v4.md §5A.8](./REVISED_PRD_v4.md).

---

## Architecture (one-paragraph)

NestJS API serves a RESTful interface ([OpenAPI spec](./03_API_CONTRACTS_OPENAPI.yaml)) backed by PostgreSQL via Prisma. OAuth tokens are encrypted at rest (AES-256-GCM). Zoho Books integration runs through a per-org `ZohoApiClient` with rate-limit throttling (80 req/min) and exponential-backoff retry. Background jobs (renewal reminders, daily sync, webhook retries, lead conversion) use BullMQ on Redis. Next.js frontend (App Router) consumes the API via fetch with React Server Components for SSR — important for the public quote link `/q/{token}` which must render server-side for email previews.

See [06_PRE_IMPLEMENTATION_AUDIT.md §6](./06_PRE_IMPLEMENTATION_AUDIT.md) for the full tech stack rationale.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm db:migrate` fails with `permission denied for schema public` | Run the `GRANT ALL ON SCHEMA public TO subs_user` step above |
| `pnpm install` fails on Windows | Use Powershell or Git Bash; cmd.exe sometimes mishandles workspace paths |
| Zoho returns `401` after fresh OAuth | Check `ZOHO_DATA_CENTER=in` and `ZOHO_API_BASE_URL` points to `.in` |
| Encryption errors on startup | `ENCRYPTION_KEY` must be 32 bytes (base64). Re-generate per `.env.example` instructions |
| Next.js can't reach API | Confirm both running and `NEXT_PUBLIC_API_BASE_URL` matches `API_BASE_URL` |

---

## Opening in VS Code

Workspace VS Code के लिए configured है — debug configs, tasks, recommended extensions सब set हैं।

### Open the project

**Option 1: Double-click**
File Explorer में `subscription-management.code-workspace` पर double-click करें — multi-root view खुल जाएगा (Root + API + Web + DB columns separate)।

**Option 2: From terminal**
```bash
cd "Subscription Management with Zoho Zooks"
code .                                          # single-root mode
# OR
code subscription-management.code-workspace     # multi-root mode (recommended)
```

If the `code` command not found है, VS Code में: <kbd>Ctrl+Shift+P</kbd> → **Shell Command: Install 'code' command in PATH**।

### First time setup in VS Code

1. **Install recommended extensions** — VS Code automatically prompt करेगा (नीचे-दाहिने corner में)। Or manually: <kbd>Ctrl+Shift+X</kbd> → search "@recommended" → Install All.
   Includes: Prisma, ESLint, Prettier, Tailwind IntelliSense, OpenAPI viewer, GitLens, Error Lens, NestJS snippets।

2. **Generate ENCRYPTION_KEY** — <kbd>Ctrl+Shift+P</kbd> → **Tasks: Run Task** → 🔑 Generate ENCRYPTION_KEY → output को `.env` में paste करें।

3. **Install + migrate + seed** — Tasks panel से चलाएं in order:
   - 📦 pnpm install
   - 🗄️ DB · migrate
   - 🌱 DB · seed defaults + admin user

4. **Start dev servers** — <kbd>F5</kbd> press करें → "🟦 Full stack (API + Web)" select करें → API और Web दोनों parallel चलेंगे with debugger attached।

### Daily workflow shortcuts

| Action | Shortcut / Path |
|---|---|
| Run any task | <kbd>Ctrl+Shift+P</kbd> → `Run Task` |
| Quick-run last task | <kbd>Ctrl+Shift+B</kbd> (build task) |
| Start debugging | <kbd>F5</kbd> |
| Stop debugging | <kbd>Shift+F5</kbd> |
| Open Prisma Studio | Tasks → 🔍 DB · open Prisma Studio (opens at :5555) |
| Format file | <kbd>Shift+Alt+F</kbd> (auto on save also enabled) |
| Search across workspace | <kbd>Ctrl+Shift+F</kbd> (`node_modules`, `.next`, `dist` excluded) |
| Toggle terminal | <kbd>Ctrl+\`</kbd> |
| Command palette | <kbd>Ctrl+Shift+P</kbd> |

### Debug configurations included

- **🚀 Debug API (NestJS)** — launches NestJS with source-map debugging
- **🎨 Debug Web (Next.js — server)** — launches Next.js + auto-opens browser when ready
- **🌱 Debug Seed script** — step through `packages/db/prisma/seed.ts`
- **🧪 Attach to running API** — if you started API with `--inspect`, attach here
- **🟦 Full stack (API + Web)** — compound; runs both in parallel

### Multi-root workspace layout

`subscription-management.code-workspace` opens with four labelled root folders in the sidebar:

```
📋 Root (docs + monorepo config)    ← READMEs, PRD, schema.sql, package.json
🚀 API (NestJS · :3001)              ← apps/api
🎨 Web (Next.js · :3000)             ← apps/web
🗄️ Database (Prisma)                ← packages/db
```

हर root के लिए "npm scripts" panel separately दिखता है, और search/file-explorer noise कम हो जाता है।

### Troubleshooting

| Issue | Fix |
|---|---|
| Prisma extension shows "schema not found" | Open the workspace via the `.code-workspace` file, not just the folder, so the DB root is registered |
| ESLint not running | Check the bottom-status bar for "ESLint" — click to reload server. Or: <kbd>Ctrl+Shift+P</kbd> → ESLint: Restart ESLint Server |
| Tailwind autocomplete missing | Open a `.tsx` file in `apps/web/src/` first — Tailwind extension activates per workspace folder |
| Debugger won't attach to NestJS | Make sure port 9229 is free; `lsof -i :9229` (macOS/Linux) or `netstat -ano \| findstr :9229` (Windows) |

---

## License

Proprietary — Excel Technologies internal use only.
