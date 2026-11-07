# Clerk migration plan

Status: approved and implemented for development. See [setup and verification](clerk-setup.md). Production identity import and session cutover remain separate rollout actions.

The user approved the initial checklist and then explicitly approved this plan after the existing custom authentication was identified. The sections below record the approved design and rollout boundaries.

## Inspection findings

Inspection covered dependencies, routes, request context, sessions, and user models. No environment files or live user records were opened for this inspection.

- The web app uses Next.js 16 App Router; the separate API uses Express and the shared tRPC router. No Clerk dependency or integration was found.
- `packages/services/auth/index.ts` implements password sign-up/sign-in with bcrypt cost 12, random session tokens, SHA-256 token hashes, and session expiry/revocation.
- `packages/trpc/server/context.ts` resolves the `fb_session` cookie into a local user. Protected procedures require this user; platform-admin procedures inspect its local `role`.
- The auth router exposes sign-up, sign-in, sign-out, current-user, and supported-provider operations.
- `public.users.id` is a UUID referenced by workspace ownership, memberships, forms, submissions and audit attribution. Users also have soft-deletion and email-verification state.
- A Google OAuth discovery reference remains, but its client implementation is missing. No complete OAuth callback/linking implementation was found. Working OAuth continuity cannot be assumed from that reference alone.
- The root router also imports removed form/response routes. Those stale imports must be repaired to start and verify the API, without implementing unrelated form features.

## 1. Keep application identity and ownership stable

Keep `public.users.id` as the application identity and preserve every existing foreign key. Add an additive nullable unique `clerk_user_id` text column (or equivalent explicit mapping) through Drizzle; do not replace UUIDs with Clerk IDs or recreate user rows.

For imported users, set Clerk's `externalId` to the existing UUID, then persist the returned Clerk user ID on that same local row. Backend request handling resolves a verified Clerk subject through this mapping and continues returning the existing local UUID and local application role. Clerk supports stable legacy identity via `externalId`; see the [migration guidance](https://clerk.com/docs/guides/development/migrating/overview).

For new Clerk users, create one local UUID row idempotently from authenticated server-side user data. Handle concurrent first requests and email uniqueness conflicts explicitly. Do not attach an arbitrary Clerk account to an existing local user based only on a client-submitted UUID or matching email. Existing accounts should be mapped by the reviewed import process; collisions stop for reconciliation.

Keep workspace permissions and platform roles in the application database. Do not infer admin privileges from editable user metadata or automatically replace local workspaces with Clerk Organizations. Continue denying access to locally soft-deleted identities even when Clerk authentication succeeds.

## 2. Import users and preserve password behavior

Prepare a server-only Backend API import command with dry-run reporting, resumability, rate-limit handling, and reconciliation by stable external ID. Import existing active users only into an explicitly selected matching Clerk environment. If the selected database has no users, report zero imports rather than seeding credentials.

Use compatible existing bcrypt digests through `passwordDigest` and `passwordHasher: "bcrypt"`, after verifying representative formats/sign-in in development. Do not decrypt, log, expose, or ask users to submit their passwords for migration. Unsupported or missing hashes require an explicit recovery/passwordless path. Clerk documents these fields in [`createUser()`](https://clerk.com/docs/reference/backend/user/create-user).

Preserve email-verification meaning: Backend API user creation can verify identifiers by default, so explicitly use the appropriate verified/reserved identifier status for the source record. Do not upgrade unverified legacy email addresses implicitly. Preserve local roles/deletion state and reconcile duplicate or conflicting accounts before enabling access.

No production users will be exported into the temporary accountless development application. Development and production imports target their own Clerk instances; production migration requires separate preparation. Clerk development users do not transfer automatically to production.

## 3. OAuth continuity

Inventory actual enabled social providers and provider subject IDs before a populated production cutover. Restore/configure a provider only when its ownership and continuity requirements are known; the broken Google import is not evidence that Google sign-in currently works.

For a real existing Google integration, retain control of its OAuth project and configure the correct Clerk callback/redirect setup and account-linking policy. Validate that a returning social identity reaches its original local UUID. Do not copy arbitrary old access tokens into Clerk or merge identities solely by unverified email. Users may need to authorize Google again; do not promise existing OAuth sessions will survive.

During development setup, remove or replace only the obsolete provider-discovery code needed for the approved Clerk integration. Do not invent working legacy OAuth credentials.

## 4. Web routes and independent API authentication

Use the requested pnpm Clerk CLI workflow, starting with `pnpm dlx clerk@latest init` from the repository root after approval. Let it detect the workspace/framework; inspect its actual output before proceeding. Do not scaffold a replacement app, install a global CLI, force a framework/package manager, or create multiple Clerk applications to work around monorepo detection. If detection/configuration is incomplete, follow its remaining steps and the matching quickstarts.

Allow the CLI to install Clerk's agent skills if absent, as authorized by the checklist. Default to accountless development setup where supported. Do not run `auth login`, claim an application, or pull production keys without the user's corresponding request. Relay the CLI's actual environment filename and claim instructions after successful initialization; never display secret values.

For `apps/web`, add the appropriate Clerk provider, sign-in/sign-up UI, sign-out controls and Next.js 16 `proxy.ts` protection. Keep the landing page, sign-in/up, and public respondent routes public; protect creator/workspace screens when present. Validate redirects instead of trusting arbitrary return URLs. Inspect the installed SDK generation and align Node/package requirements with it.

For the separate Express API, install/configure the appropriate Clerk verification middleware or server SDK and verify tokens before building tRPC context. Next.js page protection alone does not secure `apps/api`. Send Clerk session tokens to the API in the Authorization header for browser requests; use the corresponding server-side token handling for SSR. Configure allowed origins/authorized parties for the actual dev and deployment topology, including OpenAPI requests.

Keep public form/health procedures public as intended. Preserve protected/admin procedure behavior through the verified Clerk-to-local-user mapping, and continue applying workspace authorization separately. Do not trust a plain decoded token, raw request user ID, or frontend-only visibility controls.

## 5. Sessions and cutover

Implement and test Clerk in development first. Retain legacy tables and credential columns during this additive stage. Do not run the user import or new schema migration against production as a side effect of starting the web app.

At an approved production rollout, back up the identity/mapping data, pause legacy sign-ups/password changes for a consistent final import, reconcile counts/IDs, deploy the verified Clerk mapping and API protection, then switch sign-in/out entry points. Invalidate legacy `fb_session` sessions and clear the old cookie. Existing users must sign in again; legacy session tokens are not Clerk tokens.

Retire public legacy password/session-creation endpoints at cutover so they cannot bypass Clerk. Keep historical rows until retention/cleanup is separately reviewed. Do not silently accept a legacy cookie when a supplied Clerk token is invalid; choose an explicit authentication mode rather than an ambiguous fallback.

Rollback is a deliberate release decision. Before production cutover, preserve the legacy implementation and schema compatibility so the prior development release remains restorable. After cutover, inspect Clerk-only accounts, password changes, revoked legacy sessions, and role/account mappings before any return to legacy auth. A rollback may require account recovery or fresh sign-in; restoring code alone does not synchronize credentials.

## 6. Verification and acceptance

- New-user sign-up, returning-user sign-in, imported bcrypt credentials, sign-out and expired/revoked session behavior.
- Stable UUIDs and unchanged workspace ownership/membership for migrated users; no duplicate local rows under concurrent requests.
- Signed-out, wrong-instance, tampered/expired-token and unauthorized-workspace requests denied by the API as well as the UI.
- Local deletion and platform/workspace role enforcement; public respondent/health routes remain accessible.
- Verified/reserved identifier behavior, identity collisions and unsupported credential recovery.
- Authenticated browser-to-Express/tRPC requests, SSR handling and redirect/origin checks.
- New migration applies to clean and upgraded disposable databases; production records remain untouched during setup.
- Start the web app and API with the completed integration, verify the end-to-end flow, document remaining deployment/claim steps, and commit coherent changes without secrets or generated local keys.

## Approved scope

Approval covers the additive mapping, development replacement of custom password/cookie endpoints, required sign-in again at eventual cutover, and repair of stale imports needed to start the app. Setup and tests use development resources. Production identity import and session cutover still require explicit authorization and were not performed by this development setup.
