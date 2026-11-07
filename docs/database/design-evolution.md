# Database design: old plan and current design

The form-builder database evolved in two steps: the original mutable prototype became a workspace-scoped, versioned relational model; Clerk then replaced the application's authentication path while retaining local user UUIDs.

The latest committed schema is migration **`0010_clerk_identity_mapping`**. This document compares designs, not live deployment state. The [recorded production migration](migration-runs/2026-11-07.md) applied `0000`–`0009`; Clerk setup verified `0010` on development/test databases. No database was queried or migrated for this documentation update.

## Design timeline

| Stage                | Original prototype                                               | Approved Phase 1 before Clerk                                                 | Current design with Clerk                                                         |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Schema history       | `0000`–`0001`                                                    | `0000`–`0009`                                                                 | `0000`–`0010`                                                                     |
| Authentication       | Custom password sign-in and cookie sessions                      | Custom password sign-in and cookie sessions                                   | Clerk sessions verified by the web app and API                                    |
| User identity        | Local UUID                                                       | Same local UUID                                                               | Same UUID plus nullable unique `clerk_user_id`                                    |
| Tenancy              | Forms attached directly to an owner                              | Workspaces, ownership and memberships                                         | Same local workspaces and memberships; no automatic Clerk Organizations migration |
| Form editing         | Mutable form/field rows                                          | Editable drafts and immutable published definitions                           | Unchanged versioned model                                                         |
| Responses            | JSON answers tied to mutable forms; nullable field reference     | Submission pinned to a version, typed answers and scoped child records        | Unchanged versioned/typed model                                                   |
| Selections and files | Options in field JSON; no dedicated relational file-answer model | Normalized options, selected-option rows, file metadata and attachment links  | Unchanged                                                                         |
| Isolation            | No workspace-based model                                         | Composite scope FKs and forced RLS                                            | Same protections; Clerk identity still needs application authorization            |
| History/retention    | Creator deletion could cascade forms/responses                   | Soft deletion, restricted ownership deletion, audit and retention foundations | Unchanged; local auth records retained for a separate cutover/cleanup decision    |
| PostgreSQL tables    | 7 `public` tables                                                | 7 preserved `public` + 15 `builder` tables                                    | Same 22 application tables; Clerk is external                                     |

The table counts exclude Drizzle's migration-history table. The core ERDs omit five preserved legacy `public` content tables, while showing users, legacy sessions and the 15 core tables. The current diagram adds an external Clerk node; that does not create a twenty-third application table.

## Historical and current diagrams

All diagram files below use **Eraser ERD syntax**. Paste their contents into an Entity Relationship Diagram in Eraser.io.

| Document / source                                                   | What it preserves                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Original prototype ERD](history/prototype-0001.eraser)             | Generated from the original `0001_snapshot.json`, including all seven legacy tables                   |
| [Original Phase 1 architecture](history/phase-1-original-design.md) | Archived approved architecture text before its Clerk update, including historical repository findings |
| [Pre-Clerk Phase 1 core ERD](history/phase-1-core.eraser)           | Earlier core relationship diagram through `0009`, with local passwords/sessions active                |
| [Current architecture](architecture.md)                             | Current decisions and relationships through `0010`                                                    |
| [Current ERD](schema.eraser)                                        | Clerk identity mapping, stable local users, core form data and marked legacy sessions                 |
| [README diagram](../../README.md#database-er-diagram-phase-1)       | An embedded copy of the current Eraser source                                                         |

Historical diagrams are references, not schemas to reapply. The prototype diagram describes the original `0001` constraints; later migrations changed some preserved legacy constraints, including creator deletion behavior.

## What changed from the prototype to Phase 1

The original form combined ownership, publication and settings in a mutable `public.forms` row. Fields belonged directly to that form. Responses stored snapshots of answer values and JSON answer rows; deleting/changing fields could lose the connection to the question definition the respondent actually saw.

The approved replacement separates stable identity from versioned content:

```text
Workspace -> Form (stable ID / public slug)
             -> Form version (draft or immutable published definition)
                  -> Steps -> Fields -> Options
                  -> Conditional rules
                  -> Submissions -> Typed answers -> Selected options / Files
```

The new tables live in `builder`, leaving the original `public` data available for reconciliation/export. Legacy definitions were imported as unpublished drafts requiring review. Old responses were retained rather than falsely assigned reconstructed historical definitions. [Operations](operations.md) documents the actual migration/cutover strategy.

## What changed when Clerk was introduced

The physical schema change is deliberately small:

```sql
ALTER TABLE public.users ADD COLUMN clerk_user_id text;
ALTER TABLE public.users
  ADD CONSTRAINT users_clerk_user_id_unique UNIQUE (clerk_user_id);
```

Those are the two operations in [`0010_clerk_identity_mapping.sql`](../../packages/database/drizzle/0010_clerk_identity_mapping.sql). PostgreSQL permits multiple null values under this ordinary unique constraint, so existing users can remain unmapped until the reviewed import links them. Mapped Clerk IDs must be unique.

| Earlier responsibility                                            | Current responsibility                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Application hashes new login passwords into `users.password_hash` | Clerk handles new authentication credentials; local legacy hashes remain preserved         |
| API looks up `fb_session` in `public.sessions`                    | API verifies a Clerk session and resolves its subject through `users.clerk_user_id`        |
| Local UUID identifies the user in business records                | Local UUID still identifies the user in all business records                               |
| Local role and workspace membership decide permissions            | The same local authorization model remains; signing in is not a workspace permission grant |

The identity path is now:

```text
Verified Clerk subject (text ID)
        -> public.users.clerk_user_id (unique external mapping)
        -> public.users.id (existing UUID primary key)
        -> workspace ownership, memberships, creator/respondent and audit references
```

There is no SQL foreign key to Clerk. On reviewed imports, Clerk's `externalId` stores the local UUID as text, and the returned Clerk ID is persisted on the original local row. New users receive one local UUID through idempotent provisioning. An email collision is not sufficient to link accounts.

`public.sessions`, `users.password_hash`, and the legacy login timestamp remain in the database. The Clerk-backed development API does not use them for sign-in/session validation. Preserving those columns does not mean both authentication systems are simultaneously accepted by that API.

## What did not change

- Workspace/form ownership and membership foreign keys still reference local user UUIDs.
- Forms still have a stable identity and an optional current-published-version pointer.
- Published versions, steps, fields, choices and rules remain immutable under the existing guards.
- Submissions still pin one exact version; answers cannot reference another workspace/version or attach another submission's file.
- Forced RLS on tenant tables, role separation, retention and audit protections remain in place.
- File records store metadata/private storage keys; there is no new object-storage service.
- Theme configuration can evolve within validated version settings later; no reusable-theme registry or new theme table was added for Clerk or branding.

The new design does not replace local authorization with Clerk Organizations, remove historical records, or rewrite migration history. Production account import, OAuth continuity and legacy-session cutover remain explicitly separate rollout work. See [Clerk setup and verification](../auth/clerk-setup.md).

## Keeping the design documents current

Update `schema.eraser`, the embedded README copy, and `architecture.md` when a migration changes the model. Preserve historical sources with their migration boundary instead of overwriting them. Add a new timeline stage here when responsibilities or ownership change; a new feature does not automatically require a new table.
