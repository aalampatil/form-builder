# Clerk development integration

Sumikami uses Clerk for sign-in, sign-up and sessions. Local PostgreSQL UUIDs, platform roles, account deletion and workspace relationships remain application-owned. The user approved the [migration plan](clerk-migration-plan.md) before initialization.

## CLI outcome and claiming

`pnpm dlx clerk@latest init` could not detect a framework at the monorepo root, so it created nothing there. Running the same command in `apps/web` detected Next.js App Router, provisioned one claimable accountless development application, wrote `apps/web/.env.local`, and generated the provider, bare `proxy.ts`, and sign-in/up routes.

The CLI tried npm for SDK installation, which rejected `workspace:*`. Finished installation with pnpm, without creating another Clerk application. Installed SDKs are Next.js 7.9.25, Express 2.1.88, and Backend 3.27.0 (Core 3). React was updated to a compatible patch release, the Node requirement is now 20.9+, and deprecation settings were aligned with the installed TypeScript 5.9 compiler.

The CLI installed eight Clerk agent skills globally for Codex and supported clients. Its warning about unsupported global PromptScript installation does not affect those Codex skills.

The application remains unclaimed. The CLI instructed the user to run `clerk auth login` when ready. In this pnpm project, run the following from `apps/web` **only when you want to claim it**:

```sh
pnpm dlx clerk@latest auth login
```

Do not rerun `init` to restore keys. No production Clerk application, production keys, or production user import was configured during this setup.

## How authentication connects

```text
Next.js browser / server component
  -> Clerk session token in Authorization: Bearer
  -> Express Clerk middleware verifies the session and authorized party
  -> tRPC context resolves Clerk subject through public.users.clerk_user_id
  -> application uses the existing local UUID, role and deletion state
```

- The Next.js proxy provides Clerk context; protected resources call `auth.protect()`. The dashboard checks protection before fetching account details. Public home/sign-in/up pages remain public.
- Express verifies authentication independently. Page protection and `<Show>` rendering are not API authorization. Invalid supplied Bearer credentials are rejected; a legacy `fb_session` cookie does not authenticate this API.
- Current-user access is `auth.me` through tRPC or `/api/authentication/me` through OpenAPI. Clerk owns sign-in/up/out; old password/cookie-creation endpoints are not registered.
- Browser links use `useAuth().getToken`; server links obtain tokens on a request-specific client. Query caches are replaced when the signed-in identity changes.
- Local platform roles and soft deletion still apply. Workspace capability enforcement remains a separate service responsibility.
- Deleted legacy form/response services were not restored. Their broken router imports were removed, leaving an empty public form namespace until versioned endpoints are implemented.

The legacy credential/session tables and auth implementation remain preserved. No production sessions were revoked. JWT API access follows Clerk's token lifetime; signing out is not a promise that every already-issued token becomes invalid instantly.

## Local resources and commands

| Resource                                | Location                                                |
| --------------------------------------- | ------------------------------------------------------- |
| Web app                                 | `http://localhost:3001`                                 |
| API / API reference                     | `http://localhost:8000` / `http://localhost:8000/docs`  |
| PostgreSQL container                    | `sumikami-clerk-dev-db`, bound to loopback port `55433` |
| Development / disposable test databases | `sumikami_clerk_dev` / `sumikami_clerk_test`            |

```sh
docker start sumikami-clerk-dev-db
pnpm dev:auth
```

`dev:auth` selects only web and API, rather than also launching database Studio. The API explicitly loads `apps/api/.env.local`; Next.js loads `apps/web/.env.local`. Both are Git-ignored. The CLI-created development keys were supplied to the API without printing them.

| Configuration file    | Required variables                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/.env.local` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, server-only `CLERK_SECRET_KEY`, Clerk sign-in/up and dashboard fallback URLs, `API_URL`, `NEXT_PUBLIC_API_URL` |
| `apps/api/.env.local` | `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `AUTHORIZED_PARTIES`, `PORT`, `BASE_URL`, `NODE_ENV`                                   |

Local authorized parties and CORS origins are `http://localhost:3001` and `http://127.0.0.1:3001`. Deployments need their real origins and matching instance keys. Never expose the secret key through a `NEXT_PUBLIC_` variable.

The isolated local database received migrations `0000`–`0010`. The additive `0010_clerk_identity_mapping` adds a nullable unique text column and preserves UUIDs/foreign keys. **It was not applied to production during this integration.** App startup does not automatically migrate a database.

## Identity behavior

Mapped subjects resolve directly to local users without selecting password hashes. New subjects use a trusted server-side Clerk profile lookup and get the default `CREATOR` role; metadata cannot grant platform administration. Concurrent first requests use unique constraints plus insert-or-read retry to create one local identity.

An existing email collision or unfinished imported external-ID mapping returns `ACCOUNT_LINK_REQUIRED`. Accounts are never claimed, overwritten or undeleted merely by matching email. Soft-deleted local users remain denied.

Local profile fields are initialized when provisioning the local user. Profile-change webhooks/full synchronization are not implemented, so local display/email fields may lag later Clerk profile edits. Identity remains keyed by the verified Clerk subject, not email.

## Legacy import tooling

The server-only `packages/services/auth/import-clerk-users.ts` defaults to a dry run. It prints aggregate counts without emails/digests and makes no Clerk requests in that mode.

```sh
pnpm auth:import:clerk:dev
# Apply only after reviewing that report and the selected development database.
pnpm auth:import:clerk:dev --apply
```

Development imports require test keys and a loopback database ending in `_dev`/`_test`, preventing production identities from entering the accountless development instance. Live imports require explicitly selected live credentials and `--allow-production` through the services command in that rollout environment. The root development shortcut is not a production import command.

The importer preserves local UUIDs as Clerk external IDs, imports compatible bcrypt digests, uses verified/reserved email status, reconciles existing external IDs for resumability, and writes the Clerk ID to the original local row. It handles rate limits with bounded retries and stops on conflicting identities or missing/unsupported hashes. Those require a reviewed recovery/OAuth plan rather than automatic merging. No working legacy Google integration is assumed from its broken discovery import.

The local dry run found **zero legacy candidates**. Actual production-password sign-in and OAuth continuity still require a representative staging/import rehearsal; a zero-candidate dry run does not verify those external migrations.

## Verification record

Express and Next.js production builds passed, along with TypeScript checks for the API, web app, services and tRPC package. The compiled Express artifact also started successfully on temporary port 8001. Builds used the development instance configuration for validation only; no deployment occurred.

| Check                                                                                   | Result                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Browser setup, anonymous access, sign-up, API lookup, sign-out, returning sign-in       | 3 checks passed; local UUID stayed stable                                                    |
| Missing/invalid/legacy-cookie API credentials                                           | Rejected with 401                                                                            |
| Identity concurrency, unsafe linking, ownership, roles, deletion and verification state | 5 integration checks passed on disposable PostgreSQL databases with synthetic Clerk profiles |
| Clean/upgrade migrations, RLS and database integrity                                    | 15 checks passed with migration `0010` included                                              |
| Import dry run                                                                          | 0 candidates; no remote writes                                                               |

After starting the apps and local PostgreSQL:

```sh
pnpm --filter web test:auth:e2e
```

For the two database-backed suites, supply the **local disposable** test URL (PowerShell example):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:<local-password>@127.0.0.1:55433/sumikami_clerk_test'
pnpm --filter @repo/services test:auth
pnpm --filter @repo/database test:db
```

Browser tests use installed Chrome, development keys, and the official Clerk testing-token helper. They create synthetic `+clerk_test` development accounts, retained rather than automatically deleting accounts. Artifacts are Git-ignored and no token/key values are committed. An initial hydration race was fixed by waiting for the active client session before reading its token. On this Windows/Node 25 machine, Clerk's helper emitted shutdown/background-request diagnostics while all three checks still passed; assertions were not weakened to accommodate them.

## Production boundary

Implementation commits: `4b123a6` (identity mapping), `2624550` (compiler configuration), `cfac0ff` (SDK/test dependencies), `8722984` (API/identity/import integration), and `db2f6f2` (web integration/browser tests). The documentation commit records setup, approval scope and verification.

Before deployment, rehearse the approved plan, apply the mapping migration before code that reads it, import/reconcile users into the correct production Clerk instance, configure actual origins and OAuth redirects, and separately schedule legacy-session cutover. Use a restricted identity database login instead of migration credentials. Do not deploy the temporary accountless development identity store as production authentication.
