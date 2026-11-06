# FormCraft (Typeform-style Form Builder SaaS)

Production-style form builder SaaS built on a Turborepo monorepo with **tRPC**, **Zod**, **Drizzle ORM (Postgres)**, and **Scalar (OpenAPI docs)**.

## Phase 1: database foundation

- Auth for creators: email/password + httpOnly cookie sessions (`fb_session`)
- Workspace ownership, membership roles, composite tenant constraints, and forced row-level security
- Drafts, immutable published form versions, steps, fields, options, and conditional-rule definitions
- Typed submission answers, relational selections/files, lifecycle guards, retention metadata, and audit records
- Additive Drizzle migrations preserving legacy forms and responses
- PostgreSQL integration tests for migrations, integrity, isolation, concurrency, and query plans
- Optional development draft fixture without login credentials

See [database architecture](docs/database/architecture.md), [operations and validation](docs/database/operations.md), and the [commit ledger](docs/database/changes.md). Form-builder APIs, submission validation services, and UI development follow this database phase.

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

## Database ER diagram (Phase 1)

Paste the code below into an **Entity Relationship Diagram** in Eraser.io. It uses [Eraser's ERD syntax](https://docs.eraser.io/erd-syntax). New tables live in the `builder` schema; users and sessions remain in `public`. See the [database architecture](docs/database/architecture.md) for full constraints and migration decisions.

```text
// Phase 1 logical schema; implemented through Drizzle migrations.
// Relationships below show individual FK paths for readability.
// Implementation uses composite workspace/version/submission FKs.
// Nullable columns, composite uniqueness, checks, RLS, and triggers
// are specified in docs/database/architecture.md.

users {
  id uuid pk
  full_name varchar
  email varchar unique
  password_hash text
  role text
  deleted_at timestamptz
}

sessions {
  id uuid pk
  user_id uuid fk
  token_hash text unique
  expires_at timestamptz
  revoked_at timestamptz
}

workspaces {
  id uuid pk
  owner_user_id uuid fk
  name varchar
  slug varchar unique
  retention_days integer
  deleted_at timestamptz
}

workspace_memberships {
  id uuid pk
  workspace_id uuid fk
  user_id uuid fk
  role text
}

forms {
  id uuid pk
  workspace_id uuid fk
  creator_user_id uuid fk
  slug varchar unique
  published_version_id uuid fk
  archived_at timestamptz
  deleted_at timestamptz
}

form_versions {
  id uuid pk
  workspace_id uuid fk
  form_id uuid fk
  version_number integer
  status text
  title varchar
  description text
  settings jsonb
  revision integer
  published_at timestamptz
}

form_steps {
  id uuid pk
  workspace_id uuid fk
  version_id uuid fk
  key varchar
  title varchar
  position integer
}

field_types {
  code text pk
  storage_kind text
}

form_fields {
  id uuid pk
  workspace_id uuid fk
  version_id uuid fk
  step_id uuid fk
  key varchar
  type_code text fk
  label text
  required boolean
  position integer
  configuration jsonb
  validation jsonb
}

field_options {
  id uuid pk
  workspace_id uuid fk
  version_id uuid fk
  field_id uuid fk
  key varchar
  label text
  position integer
}

form_logic_rules {
  id uuid pk
  workspace_id uuid fk
  version_id uuid fk
  source_field_id uuid fk
  priority integer
  condition jsonb
  action_kind text
  target_step_id uuid fk
  target_field_id uuid fk
}

form_submissions {
  id uuid pk
  workspace_id uuid fk
  form_id uuid fk
  version_id uuid fk
  respondent_user_id uuid fk
  status text
  idempotency_key text
  metadata jsonb
  started_at timestamptz
  completed_at timestamptz
  expires_at timestamptz
  deleted_at timestamptz
}

submission_answers {
  id uuid pk
  workspace_id uuid fk
  version_id uuid fk
  submission_id uuid fk
  field_id uuid fk
  storage_kind text
  value_text text
  value_number numeric
  value_boolean boolean
  value_date date
  value_datetime timestamptz
  value_json jsonb
}

answer_selections {
  workspace_id uuid fk
  version_id uuid fk
  answer_id uuid fk
  field_id uuid fk
  option_id uuid fk
}

submission_files {
  id uuid pk
  workspace_id uuid fk
  version_id uuid fk
  submission_id uuid fk
  object_key text
  original_filename text
  media_type text
  byte_count bigint
  checksum text
  upload_state text
}

answer_files {
  workspace_id uuid fk
  version_id uuid fk
  submission_id uuid fk
  answer_id uuid fk
  file_id uuid fk
}

workspace_audit_events {
  id uuid pk
  workspace_id uuid fk
  actor_user_id uuid fk
  action text
  entity_type text
  entity_id uuid
  metadata jsonb
  created_at timestamptz
}

sessions.user_id > users.id
workspaces.owner_user_id > users.id
workspace_memberships.workspace_id > workspaces.id
workspace_memberships.user_id > users.id
forms.workspace_id > workspaces.id
forms.creator_user_id > users.id
forms.published_version_id - form_versions.id
form_versions.workspace_id > workspaces.id
form_versions.form_id > forms.id
form_steps.version_id > form_versions.id
form_fields.version_id > form_versions.id
form_fields.step_id > form_steps.id
form_fields.type_code > field_types.code
field_options.field_id > form_fields.id
form_logic_rules.version_id > form_versions.id
form_logic_rules.source_field_id > form_fields.id
form_logic_rules.target_step_id > form_steps.id
form_logic_rules.target_field_id > form_fields.id
form_submissions.workspace_id > workspaces.id
form_submissions.form_id > forms.id
form_submissions.version_id > form_versions.id
form_submissions.respondent_user_id > users.id
submission_answers.submission_id > form_submissions.id
submission_answers.field_id > form_fields.id
answer_selections.answer_id > submission_answers.id
answer_selections.field_id > form_fields.id
answer_selections.option_id > field_options.id
submission_files.submission_id > form_submissions.id
answer_files.submission_id > form_submissions.id
answer_files.answer_id > submission_answers.id
answer_files.file_id > submission_files.id
workspace_audit_events.workspace_id > workspaces.id
workspace_audit_events.actor_user_id > users.id
```

This diagram shows principal attributes and relationships; common creation/update timestamps and repetitive scope connectors are omitted for readability. Link tables use composite primary keys: `(answer_id, option_id)` for selections and `(answer_id, file_id)` for attachments. Each submission references an immutable published version. Draft versions may temporarily have no steps; publication requires a complete structure.

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

### 4) Migrate

```bash
pnpm db:migrate
```

Use a privileged migration connection for this command. Before deploying, follow the [runtime role and legacy rollout instructions](docs/database/operations.md). Development seeding is optional: `pnpm db:seed` requires `ALLOW_DATABASE_SEED=true`, a database name ending in `_dev` or `_test`, and a non-production environment.

### 5) Run dev

```bash
pnpm dev
```

Defaults:

- API: `http://localhost:8000`
- Web: `http://localhost:3001`
- Drizzle Studio: `http://localhost:4984`

## Development database fixture

The optional seed creates a `development` workspace and an unpublished `development-feedback` draft. It creates no passwords or admin login credentials.

## API docs (Scalar)

- Local: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## Deployment / submission links

Fill these in before submitting to judges:

- Demo: `TODO_DEMO_URL`
- Public GitHub repo: `TODO_GITHUB_REPO_URL`
- API docs: `TODO_SCALAR_DOCS_URL`

## Git hooks

`pnpm install` enables Husky through the root `prepare` script. Before each commit, lint-staged checks staged JavaScript, TypeScript, JSON, Markdown, YAML, CSS, and HTML files with the existing Prettier configuration. Formatting errors block the commit; the hook does not rewrite your files. The generated `pnpm-lock.yaml` is excluded through `.prettierignore`.

Format reported files with `pnpm exec prettier --write <file>`, stage them again, and retry the commit. Re-enable hooks manually with `pnpm run prepare` when needed. Database integration tests and workspace type checks remain separate commands.

## Notes

- Email is optional. If you set `SMTP_URL` + `EMAIL_FROM`, the platform will:
  - notify creators on new responses (default on; can be disabled per-form via `settings.notifyOnResponse=false`)
  - optionally send a respondent a copy of their submitted answers
