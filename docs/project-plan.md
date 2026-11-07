# Project map and rough implementation plan

Sumikami lets a creator build and publish a form, lets respondents fill it in, and lets an authorized team review the submissions. Workspaces connect people to forms; published versions connect form definitions to their historical answers. Its brand promise is **Make every question an experience.**

This document is a rough map of the whole project. It describes the intended connections and build order, rather than a list of features already working.

## 1. The overall connection

```text
Creator / team member                       Respondent
         |                                      |
         v                                      v
 apps/web                                  apps/web
 Dashboard, builder, results                Published form, completion
         |                                      |
         +------------------+-------------------+
                            |
                   Typed tRPC requests
                            |
                            v
                      apps/api
                 Express HTTP server
                            |
                            v
                    packages/trpc
           Routes, input/output contracts,
           session context, permission entry points
                            |
                            v
                  packages/services
         Auth, workspace access, form lifecycle,
         publication, submission validation, reporting
                            |
                            v
                  packages/database
         Drizzle models, tenant transactions,
         SQL migrations and database protections
                            |
                            v
                      PostgreSQL
       public: identity + preserved legacy tables
       builder: workspace-scoped application data
```

Read the arrows as request/data access direction. Results return through the same layers to the browser. Public endpoints still go through validation and service code; “public” means a respondent does not need a creator account.

The existing Express server also exposes OpenAPI-backed REST routes at `/api`, an OpenAPI document, and Scalar documentation. tRPC and REST are two adapters around the same procedures and services. They should not contain separate implementations of publishing or submission rules.

## 2. What belongs where

| Location               | Owns                                                                                                    | Main connections                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/web`             | Creator screens, respondent screens, client state, Sumikami product identity and selectable form themes | Calls the API through the shared tRPC client; consumes validated response types     |
| `apps/api`             | HTTP server, transport configuration, middleware, health endpoints                                      | Mounts the shared router and creates request context                                |
| `packages/trpc`        | API procedures, public/protected boundaries, input/output schemas, error translation                    | Uses services; exposes router types to the web app                                  |
| `packages/services`    | Business decisions and transactional workflows                                                          | Checks permissions, validates form/answer semantics, then uses the database package |
| `packages/database`    | Persistence models, SQL constraints, migrations, scoped transactions                                    | Talks to PostgreSQL; protects relational integrity and tenant boundaries            |
| `packages/logger`      | Shared server logging                                                                                   | Used by API/services without logging passwords, session tokens, or answer contents  |
| Shared config packages | TypeScript and ESLint conventions                                                                       | Keep apps/packages consistent; contain no product logic                             |
| `docs`                 | Architecture, operating procedures, visual direction, project plan                                      | Explains the decisions used by all layers                                           |

Keep business rules in services and transport-specific behavior in routes. Public API input schemas should expose only editable request fields, not unrestricted database insert objects. The browser must not receive database credentials or choose an unchecked tenant context.

## 3. How the core data connects

```text
User
 |-- has sessions
 |-- owns workspaces
 +-- joins workspaces through memberships

Workspace
 |-- has an owner and team roles
 |-- contains forms
 +-- records audit events

Form                         Stable ID and public slug
 |-- current published version pointer
 +-- versions
      |-- one editable draft at a time
      +-- published versions remain immutable
           |-- steps
           |    +-- fields
           |         +-- selection options
           |-- conditional logic rules
           +-- submissions pinned to this exact version
                |-- typed field answers
                |    |-- selected options
                |    +-- file attachment links
                +-- submission-owned file metadata
```

Each version, field, option, submission, and answer carries the appropriate workspace/version scope. Composite foreign keys stop a submission from answering another version's field or attaching another submission's file.

Example: a creator publishes version 1 with a “Favorite subject” question. A respondent submits against version 1. The creator changes that question in a new draft and publishes version 2. The earlier submission still references version 1 and its original question/options.

The full [database architecture](database/architecture.md) and [Eraser ER diagram](../README.md#database-er-diagram-phase-1) describe the entities and constraints in more detail.

## 4. Main user journeys

### Account and workspace access

```text
Sign in -> resolve cookie session -> identify user
        -> resolve owned/joined workspaces through trusted server code
        -> check owner/membership and requested action
        -> open a workspace-scoped database transaction
```

Authentication answers “who is this user?” Authorization answers “can this user perform this action in this workspace?” Existing protected procedures establish login, but workspace role checks still need to be built. The global platform `ADMIN` role and workspace `ADMIN` membership are separate concepts.

The owner has full workspace access. The initial role model gives workspace admins team/form management, editors form editing and response access, and viewers read access. Services must explicitly enforce the chosen capability matrix before exposing those operations. PostgreSQL RLS isolates workspaces; it does not establish membership on its own.

### Create and publish a form

```text
Dashboard -> create form -> create/edit draft
          -> add steps, fields, options and rules
          -> preview -> validate whole definition
          -> publish immutable version and switch current pointer
          -> share form URL
```

Draft editing needs expected-revision checks to prevent one editor from silently overwriting another. Publishing combines application validation with a database transaction. Later edits create another draft; they do not rewrite an existing published version.

### Fill in and submit a form

```text
Open public slug -> trusted lookup and intake/access checks
                 -> load current published definition
                 -> start submission pinned to that version
                 -> validate/store answers in scoped transactions
                 -> validate completion -> mark completed -> confirmation
```

Browser validation helps the respondent; server validation is authoritative. The server checks required/visible fields, answer types and limits against the pinned version. Database guards enforce scope, shape, lifecycle and selection/file relationships. Idempotency keys let retries find an existing submission instead of creating duplicates.

Public slug resolution must return only the permitted published definition and establish scope through trusted server code. Respondents must not be able to read workspace memberships, drafts, or other people's answers. Submission IDs alone must not authorize later edits; define an anonymous continuation credential before exposing save/resume endpoints.

### Review responses

```text
Workspace member -> permission check -> selected form
                 -> paginated submission list -> answer detail
                 -> load labels/options from each submission's version
                 -> export or field-level reporting later
```

Load answers for the current result page rather than every response. Keep original version context visible when definitions differ. Cross-version analytics need stable logical keys and comparable question meanings; matching labels alone are insufficient.

## 5. Where the brand and form themes fit

The [Sumikami brand guide](brand/sumikami.md) defines the product identity, ink/paper palette, logo direction, typography and voice. The product interface stays minimal, fast and professional. The [Japanese Ink guide](design/japanese-ink.md) defines one selectable respondent-facing preset, rather than the limits of the whole platform.

```text
Sumikami brand
        -> central product tokens and shared controls
        -> dashboard / builder / response management

Selected form theme
        -> versioned appearance configuration
        -> shared respondent renderer and matching builder preview
        -> Japanese Ink / city-inspired / futuristic / custom expression
```

The creator's dashboard light/dark preference is separate from a published form's appearance. Future reusable form appearance settings should include a preset identity/version and a resolved snapshot captured at publication so preset changes do not silently alter historical forms. The existing version settings can support that future contract; a reusable-theme registry/service is not implemented yet. No brand styling or form theme has been applied to the UI in these documentation changes.

## 6. Current state and gaps

| Area                    | Current state                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Database foundation     | Implemented: schema, migrations, tenant/lifecycle protections, legacy preservation, and PostgreSQL integration tests       |
| Existing authentication | User/session service code and request-context plumbing exist; complete application integration still needs verification    |
| Workspace authorization | Ownership/membership schema exists; discovery, capability enforcement, and management APIs are planned                     |
| Form/submission APIs    | Need services and routes aligned with the versioned schema                                                                 |
| Web app                 | Next.js scaffold, tRPC/provider setup and shared UI components exist; full product journeys are planned                    |
| Japanese Ink theme      | Specification and palette exist; visual implementation is planned                                                          |
| Sumikami brand          | Product identity, palette, logo briefs and typography direction are documented; logo assets and UI integration are planned |
| Git hooks               | Husky checks staged-file formatting through lint-staged and Prettier                                                       |

Some existing router and user-service files still reference removed form/response or Google OAuth modules. Repair those references before treating the whole application as buildable. Presence of a route file does not establish a working end-to-end feature. The database test result is separate from the full application build.

Database runtime credentials, forced RLS, transaction context, privileged migration connections, retention, and legacy cutover procedures are documented in the [operations guide](database/operations.md).

## 7. Rough build order

| Stage                                        | Work                                                                                                                                            | Completion checkpoint                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Database foundation                       | Versioned definitions, tenant scope, answer integrity, migrations and tests                                                                     | Completed foundation; deployment-specific rollout still follows the operations guide              |
| 2. Application baseline and workspace access | Repair stale imports, verify sign-in/session behavior, provision restricted connections, implement workspace discovery and capability checks    | A signed-in user can access only authorized workspace operations; application checks pass         |
| 3. Draft and publishing services             | Typed API contracts, form CRUD, field/step editing, revision checks, full-definition validation and publication                                 | A creator publishes a valid form and can edit a new draft without changing that published version |
| 4. Public intake and response retrieval      | Safe slug resolution, respondent access/continuation rules, answer validation, completion, idempotency and paginated results                    | A respondent submits once despite retries, and an authorized creator reads the stored answers     |
| 5. First usable interface                    | Build the dashboard, basic builder, respondent flow and results screen with Sumikami product components and an initial Japanese Ink form preset | The first product journey works through the browser in both supported product light/dark modes    |
| 6. Richer product capabilities               | Deeper conditional editing, file storage/cleanup, analytics, appearance controls and team management                                            | Add each capability with its own validated user journey and permissions                           |

Build stages 2–5 as small connected slices. For example, implement one text question from draft edit through publish, browser submission, and response detail before adding every question type or a large collection of screens.

## 8. First product milestone

**One user signs in, creates a workspace, builds a small form, publishes it, shares it, receives a valid submission, and reads that submission in the dashboard.**

Include a second workspace/user in verification to prove isolation. Check validation errors, duplicate retries, keyboard use, mobile completion, and old responses after publishing a new version. This establishes a usable end-to-end product on the existing database foundation.

File bytes will eventually require private object storage linked to the existing file metadata, with upload authorization and retryable retention cleanup. Notifications/integrations can later run after a committed submission through a durable job mechanism when needed. No storage provider, queue, microservice split, or deployment platform is selected by this rough plan.

## Related documents

- [Database architecture and relationships](database/architecture.md)
- [Database operations, rollout and known limits](database/operations.md)
- [Database change ledger and validation record](database/changes.md)
- [Sumikami brand identity](brand/sumikami.md)
- [Sumikami brand palette](brand/sumikami-palette.svg)
- [Japanese Ink theme specification](design/japanese-ink.md)
- [Japanese Ink palette](design/japanese-ink-palette.svg)
