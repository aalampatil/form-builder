# FormCraft (Typeform-style Form Builder SaaS)

Production-style form builder SaaS built on a Turborepo monorepo with **tRPC**, **Zod**, **Drizzle ORM (Postgres)**, and **Scalar (OpenAPI docs)**.

## What’s implemented (backend-first)

- Auth for creators: email/password + httpOnly cookie sessions (`fb_session`)
- Forms: create/update/list, publish/unpublish, archive, field schema upsert
- Public form API: fetch published form by slug + submit responses (validated via per-form **Zod** schema)
- Rate limiting: basic IP+slug limiter for public submissions
- Responses: store high-volume responses + answer rows; list responses; basic per-field analytics
- API docs: OpenAPI generated from tRPC + Scalar UI at `/docs`
- Seed data: demo creator + admin + 3 themed forms + sample responses

## Apps & packages

- `apps/web`: Next.js dashboard + public form UI (frontend is intentionally minimal for now)
- `apps/api`: Express server exposing:
  - tRPC at `/trpc`
  - OpenAPI REST endpoints at `/api`
  - OpenAPI JSON at `/openapi.json`
  - Scalar docs at `/docs`
- `packages/database`: Drizzle schema + migrations + seed script
- `packages/trpc`: tRPC server router + client types
- `packages/services`: backend services (auth, forms, responses, email)

## Local setup

### 1) Start Postgres

```bash
docker compose up -d
```

### 2) Configure env

Copy `.env.example` → `.env` and edit as needed.

```bash
cp .env.example .env
```

Also copy per-app env files (these are what `pnpm dev` uses):

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
```

### 3) Install deps

```bash
pnpm install
```

### 4) Migrate + seed

```bash
pnpm db:migrate
pnpm db:seed
```

### 5) Run dev

```bash
pnpm dev
```

Defaults:
- API: `http://localhost:8000`
- Web: `http://localhost:3001`
- Drizzle Studio: `http://localhost:4984`

## Demo credentials (seeded)

- Creator: `demo@formcraft.dev` / `DemoPass123!`
- Admin: `admin@formcraft.dev` / `AdminPass123!`

Seeded demo forms (slugs):
- `anime-hype-quiz` (public)
- `interstellar-feedback` (unlisted)
- `pixel-gaming-survey` (public)

## API docs (Scalar)

- Local: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## Deployment / submission links

Fill these in before submitting to judges:

- Demo: `TODO_DEMO_URL`
- Public GitHub repo: `TODO_GITHUB_REPO_URL`
- API docs: `TODO_SCALAR_DOCS_URL`

## Notes

- Email is optional. If you set `SMTP_URL` + `EMAIL_FROM`, the platform will:
  - notify creators on new responses (default on; can be disabled per-form via `settings.notifyOnResponse=false`)
  - optionally send a respondent a copy of their submitted answers
