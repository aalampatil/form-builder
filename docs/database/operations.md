# Database implementation and operations

Deployment record: [production migration completed on 2026-11-07](migration-runs/2026-11-07.md). It records the empty-database preflight, all ten applied migrations, verification results, and the temporary DNS workaround used for that run.

## Implemented layout

The new schema lives in `builder`; existing identity and compatibility tables remain in `public`. Import the new tables from `@repo/database/schema`. Compatibility exports are prefixed `legacy`, such as `legacyFormsTable`, and must not be used for new product writes. Drizzle's insert/select types are exported with each model.

There are 15 new tables: workspaces, memberships, forms, versions, steps, field types, fields, options, logic rules, submissions, answers, selections, submission files, answer files, and audit events. Published versions own their complete definitions. Answers have composite workspace/version/submission/field relationships. Check constraints enforce scalar payloads; deferred triggers enforce selection/file cardinality at transaction commit.

The architecture document and README's Eraser code describe the logical model. Actual table definitions are in `packages/database/models/{workspaces,definitions,submissions}.ts`; SQL-only guards, the circular published-version FK, roles and RLS policies are maintained explicitly in custom migrations. They are not inferred from TypeScript declarations.

## Migration inventory

| Migration                        | Change                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `0000`, `0001`                   | Original history, unchanged                                                                                              |
| `0002_workspace_tenancy`         | Add builder namespace, workspaces and memberships                                                                        |
| `0003_versioned_forms`           | Forms, versions, steps, extensible type registry, fields, choices and rules                                              |
| `0004_typed_submissions`         | Scoped typed answers, relational choices/files, audit events and query indexes                                           |
| `0005_lifecycle_and_isolation`   | Registry seed, immutability/answer guards, publication checks, database timestamps, audit triggers, roles and forced RLS |
| `0006_legacy_workspace_backfill` | Personal workspaces and unpublished draft snapshots; preserve all legacy responses                                       |
| `0007_identity_hardening`        | Normalized unique email, unique session hashes, user soft deletion, restrict legacy owner deletion                       |
| `0008_cursor_sort_indexes`       | Align index null ordering with default descending pagination                                                             |
| `0009_guard_cascade_and_expiry`  | Permit clearing choice answers and reject expired submission changes                                                     |

Use the existing migration command from the repository root:

```sh
pnpm db:migrate
```

For production, explicitly select the root `.env.production` file:

```sh
pnpm db:migrate:prod --check
pnpm db:migrate:prod
```

The first command validates that the file contains a PostgreSQL `DATABASE_URL` without opening a connection. The second calls Drizzle directly from the database package, using that file's URL even if the shell has another `DATABASE_URL`. It preserves literal dollar signs, fails when the file/URL is missing, and does not run through Turbo caching. The environment file must remain untracked. A functioning DNS resolver and database connection are still required.

Supply the privileged **migration** connection only for the migration process; never use a privileged migration credential for new tenant request handling. Migrations require schema/table/function privileges and permission to create/configure two NOLOGIN group roles. If your managed PostgreSQL account cannot create roles, an administrator must provision the roles before migrating. Review existing identically named roles and inherited grants; do not reuse roles that hold unrelated privileges.

Do not edit applied migrations, delete journal rows, use `drizzle-kit push` in production, or remove compatibility models because the old services were deleted. Future Drizzle generation compares snapshots, not the live catalog: it cannot validate custom SQL protections. Review generated diffs and run the PostgreSQL suite after schema changes. The original migrations/snapshots remain intact.

## Existing data rollout

1. Back up and test restoration. Test the complete upgrade on a copy of the deployment database. Confirm legacy timestamps represent UTC; migration `0006` interprets timezone-naive timestamps explicitly as UTC. A deployment with another source timezone requires a reviewed forward migration strategy before rollout.
2. Pause legacy writes for this expansion/backfill. It is a blocking migration sequence, not a zero-downtime or incremental batch upgrade. Large installations need an expansion/backfill rollout adapted to their row counts and lock budget.
3. Check normalized-email collisions, duplicate session hashes, invalid slugs/titles/field keys/labels/config objects. Preflight checks abort with diagnostics rather than dropping/coercing ambiguous data. Reconcile the source explicitly and retry. Drizzle applies pending migrations transactionally on PostgreSQL.
4. Migrate with the privileged connection. `0006` creates deterministic personal workspace/version/step IDs, preserves form and field IDs, assigns deterministic field ordering by legacy order/UUID, and generates option keys from array ordinal positions.
5. Imported forms are **unpublished drafts**. Existing settings, passwords, visibility, limits, and old published state remain intact in `public.forms`; they are not silently enabled on the new intake path. The draft's settings contain a review marker. Original field configuration remains available, and only non-empty string options are converted. Review all imported settings, choices, validation semantics, access restrictions, and intake behavior before publishing.
6. Run `packages/database/operations/legacy-report.sql` as a privileged reporting login; save counts and review reasons in the deployment record. No legacy submissions or answers are mapped to invented historical versions. All remain in the public compatibility tables. `legacy-export.sql` supplies a streaming JSONL export containing original IDs, timestamps, snapshots, metadata, and answer rows; secure the exported file as response data.
7. Cut over application services only after their tenant authorization, publishing validators, and response validators are implemented. The prior deleted services/routes are not restored by this database phase. Pause or disable old intake during final cutover to prevent diverging histories. Keep legacy export access until the data retention policy permits removal.

No application database was migrated during development. Verification uses databases created solely for the test run.

## Runtime roles and connection boundaries

`builder_runtime` and `builder_maintenance` are NOLOGIN privilege groups. Provision separate login roles with managed credentials, then grant membership as appropriate. For example, as administrator (credentials are intentionally omitted):

```sql
-- Provision these LOGIN roles and their secrets using your deployment secret manager.
GRANT builder_runtime TO form_builder_app;
GRANT builder_maintenance TO form_builder_cleanup;
```

The login must inherit its group privileges or explicitly `SET ROLE` after connecting. Do not grant maintenance to the application login. Do not grant `SUPERUSER`, `BYPASSRLS`, schema ownership, schema CREATE, or table ownership to either runtime login. The runtime role has no access to global identity/legacy tables, no field-registry write access, and no audit UPDATE/DELETE or TRUNCATE rights. New tables/functions do not automatically inherit runtime grants; add least-privilege grants and policies in their migrations.

The existing `db` export still uses the legacy application's `DATABASE_URL` for identity/auth compatibility. Create a **separate node-postgres/Drizzle connection** for new tenant operations, with a restricted tenant login. Using the same privileged connection for both defeats isolation. Global users/sessions need a separately restricted authentication connection and application authorization; tenant RLS does not secure identity operations. The current application has not been switched to new form APIs in this phase.

Use `withAuthorizedWorkspace(tenantDb, workspaceId, operation, actorUserId)` from `@repo/database` after authenticating the actor and checking owner/membership permissions. It rejects privileged/non-runtime connections, sets tenant and actor context using parameterized transaction-local configuration on the same connection, and rolls back on failure. Do not call it inside another workspace transaction or reuse an outer transaction for a different workspace. Never set tenant context at session scope.

RLS enforces workspace isolation, including missing context returning no rows. It does **not** prove that a caller is an authorized member: trusted server code must derive the workspace and permissions. An SQL-capable holder of the shared runtime credentials can set another workspace context. Credentials must remain server-side, and request fields must never select scope without authorization. Owner access is implicit from `workspaces.owner_user_id`; admin/editor/viewer capabilities are future service checks, not automatic RLS role checks.

Workspace creation needs a generated UUID and that UUID as transaction context before inserting the workspace. Workspace discovery requires trusted identity code to resolve memberships/ownership before opening the tenant transaction. Public slug resolution similarly requires a narrow trusted lookup; no broad anonymous database role is provided.

## Database write contracts

- Lock the form before allocating a version number, cloning a definition, or publishing. At most one draft exists per form. Edit with an expected `revision`; database triggers increment it when the draft or children change. Check the revision while holding the version lock before applying a group of edits.
- Publishing is a transaction: lock form/version, validate configuration/required rules/logic semantics, set version status/time, then update the form's published pointer. SQL validates structural completeness, choice presence, AST field references/operators, and target ownership. Published definitions reject updates/deletes by runtime roles. Maintenance may delete definitions only during an explicit purge after all dependent data is removed.
- Condition JSON supports `formatVersion: 1`, recursive `all`/`any` arrays, `not`, and leaf `fieldKey`/`operator`/`value`. Operators are `equals`, `not_equals`, `greater_than`, `less_than`, `contains`, and `is_answered`. Nesting is bounded to 20. Application publication validators must enforce type-compatible operators/values, allowed configuration keys and limits, and intended routing/reachability; the database is not a conditional-logic interpreter.
- Copy published rows to new row IDs when creating another draft, retaining logical field/option keys only when semantics remain comparable. Map child row IDs before copying logic rules. Position uniqueness is immediate: use a two-pass nonnegative temporary range for reorders inside a transaction; direct swaps fail. Temporary ranges must fit the integer range.
- Start submissions in `IN_PROGRESS`, against the current published pointer of an active form/workspace. Database guards snapshot retention from positive version `settings.retentionDays` (maximum 99999) or workspace retention. Unpublishing blocks new starts but allows existing in-progress submissions to finish. Archiving closes new intake; deleting a form/workspace blocks further answer writes. Expired submissions reject edits/completion until privileged cleanup.
- Lock the submission before validating and updating answers/completion. SQL answer guards acquire that lock too, preventing a concurrent answer writer from modifying completed data. All answer writes and child links belong in the same transaction; deferred checks run at commit. A failed commit must be reported as failure, not acknowledged as a successful submission.
- Required fields, conditional visibility, text/email rules, numeric ranges, selection/file limits, and structured custom formats need the future submission validator against the pinned version. SQL checks storage shape, type compatibility, scope, and child cardinality. A completed submission can therefore be structurally valid without satisfying every product rule; no public write route should be exposed until semantic validation exists.
- Numbers use exact decimal strings in JavaScript; file byte counts use `bigint`; dates use ISO date strings. Missing answer rows mean unanswered. `false`, zero, and empty text remain explicit values. JSON null is rejected; structured JSON uses non-null JSON values.
- Idempotency keys are unique per form/workspace (including soft-deleted submissions); on retry fetch the existing submission and compare request semantics. The database does not decide whether conflicting request payloads are equivalent.
- Extend field types by adding a registry code with an existing storage kind in a reviewed migration and implementing validators/renderers later. Changing the storage kind of an existing code would reinterpret history and is prohibited operationally; runtime roles cannot mutate the registry.
- Audit triggers record workspace, membership, form/version and submission lifecycle writes without copying answers. Actor context is attribution supplied by trusted server code. The runtime role can append audit events but cannot alter or erase them.

## Retention and erasure

Soft deletion is visibility/lifecycle control, not erasure. Historical definitions remain immutable and referenced. Hard user deletion is blocked while the user owns any workspace or legacy form; transfer ownership or follow an approved full purge first. Marking a user deleted prevents password sign-in and session resolution in the existing authentication service.

Use the separate maintenance connection and set transaction-local workspace context for cleanup. Select expired submission IDs in small batches via `submissions_expiry_idx`, with `FOR UPDATE SKIP LOCKED`, then process that bounded set. This prevents cleanup workers from selecting the same rows concurrently. Do not scan every tenant from the application role.

Before deleting file metadata, durably save a manifest of private object keys to the cleanup system. Delete submission rows; their answer/selection/file/link rows cascade, and purge audit events remain. Retry external object deletion idempotently using the manifest. Do not remove the manifest until object deletion succeeds. Database transactions cannot atomically delete storage objects; this phase includes metadata and procedures, not a storage client or worker.

Maintenance may adjust `expires_at`/`deleted_at` under an audited retention policy. A workspace retention change affects future submissions only; update existing expiry values explicitly if policy requires it. Audit record retention is separate and may require removing actor attribution or purging old audit rows. Never store response contents, credentials or private access URLs in audit metadata.

For full workspace erasure, first retain any required deletion manifests; purge submissions; clear published pointers; delete rules, fields/options, steps and versions in FK-safe order using maintenance; remove forms and memberships; remove workspace audit events under the audit retention policy; finally delete the workspace. Legacy data needs a separate approved purge/export decision. Never disable triggers/RLS as a routine cleanup technique. Hard identity erasure that sets respondent attribution to null requires maintenance access to every affected workspace, or a dedicated reviewed administrator operation.

## Query and scaling guidance

Use `(created_at, id)` keyset pagination with explicit workspace/form predicates and `deleted_at IS NULL`. For example, the next page adds `(created_at, id) < ($cursorTime, $cursorId)` and orders both descending. Fetch answers only for IDs on that page. Completed reports use the corresponding completed-time index. Match partial-index predicates in queries.

On PostgreSQL 15, numeric comparison functions are not marked leakproof. With forced RLS, the planner may not push numeric ranges into `answers_numeric_idx`, even though a privileged report query uses that index. The integration suite records this difference. Tenant/field scoping and bounded retrieval still apply; large numeric reports require workload-specific evaluation/rollups or a reviewed narrowly scoped reporting design. Do not disable RLS or change PostgreSQL system function metadata to obtain an index plan. [PostgreSQL's security qualifier rules](https://www.postgresql.org/docs/15/ddl-rowsecurity.html) explain the ordering restriction.

Ordinary tables, targeted indexes and connection pooling are the starting point. No partitioning, search cluster, Redis, or separate analytics store is introduced. Monitor rows per tenant, query plans, vacuum/bloat, write amplification, lock waits, connection limits, retention backlog and backup restoration before adding infrastructure. Schema correctness and a 2000-row test fixture do not establish production throughput.

## Verification

Start a disposable PostgreSQL 15 instance, then use a separate admin URL ending in `_test`:

```sh
docker run --detach --name form-builder-phase1-db \
  --env POSTGRES_PASSWORD=phase1_disposable --env POSTGRES_DB=phase1_test \
  --publish 127.0.0.1:55432:5432 postgres:15

export TEST_DATABASE_URL=postgresql://postgres:phase1_disposable@127.0.0.1:55432/phase1_test
pnpm --filter @repo/database test:db
pnpm --filter @repo/database check-types
pnpm --filter @repo/database db:check
```

In PowerShell, set `$env:TEST_DATABASE_URL = '...'` instead of `export`. The suite never reads `DATABASE_URL`: it creates uniquely named databases, applies both clean-install and upgrade paths, uses `SET LOCAL ROLE builder_runtime` for security/integrity checks, then drops only its own test databases. The supplied admin account needs database/role creation privileges. Temporary migration folders are removed at the end. NOLOGIN group roles remain on the disposable server.

The tests cover migration reruns, legacy preservation, duplicate-identity preflight, RLS with missing/wrong scope, global identity/registry/audit privilege denial, composite constraints, invalid JSON/typed payloads, choice/file ownership and cardinality, concurrent publication and answer completion, immutability, expiry, cascade clearing, pooled transaction-context reset, maintenance purges and representative query plans.

The current working tree also contains concurrent `ignoreDeprecations: "6.0"` edits while the installed compiler is TypeScript 5.9. For that installation, verify with `pnpm --filter @repo/database check-types --ignoreDeprecations 5.0` until the compiler/configuration versions are aligned. These edits were preserved. Broader services/tRPC checks additionally report imports of previously removed modules/routes and are outside the database validation result.

`db:generate` should report no changes after implementation. SQL-only guards must additionally be reviewed/tested; no-change generation does not prove they exist in a live database. To exercise the development seed, explicitly use a `_dev`/`_test` database and `ALLOW_DATABASE_SEED=true`; it creates a draft fixture without passwords or platform-admin credentials. It is not a production bootstrap script.

## Boundaries remaining for later phases

Workspace membership authorization, validated publication/submission services, slug resolution, storage cleanup execution, backup automation and deployment-specific login provisioning are not product features implemented in this database phase. No UI, theme system, external integration, workflow executor, or public form API is added. Existing unrelated service/web type failures caused by pre-existing deleted files remain outside this scope.
