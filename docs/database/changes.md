# Phase 1 change ledger

All entries below are local commits. No remote push or application-database migration was performed.

| Commit    | Change                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `f5ab5fc` | Architecture proposal, entities, ERD, constraints, migration and validation strategy                                  |
| `fc7876e` | Eraser.io ER diagram source in README, as requested                                                                   |
| `847c495` | Workspace/membership models, additive namespace migration, explicit legacy compatibility mappings                     |
| `d08daf4` | Versioned forms, steps, field types, options, conditional rules, and safe development seed                            |
| `b80d918` | Typed submissions/answers, selection and file relationships, audit storage and indexes                                |
| `ae89aae` | Lifecycle/immutability guards, forced RLS, runtime/maintenance roles and tenant transaction helper                    |
| `b2ff0d9` | Backfill legacy owners/current definitions into personal workspaces and unpublished drafts; preserve legacy responses |
| `b41bdc8` | Email/session uniqueness, user soft deletion/auth checks, and restricted legacy owner deletion                        |
| `e41757e` | Correct descending pagination index null ordering based on PostgreSQL query plans                                     |
| `21e96c4` | Choice-answer cascade correction, expiry guards, and rejection of privileged tenant connections                       |
| `c63d1b5` | Consistent formatting of task-owned database models and utilities                                                     |
| `5d50288` | PostgreSQL integration suite and package verification scripts                                                         |

The final documentation commit adds operational procedures, read-only legacy report/export scripts, validation results, and updates README status. Its hash can be obtained with `git log --oneline -- docs/database/changes.md`.

Commit `6f198b5` arrived independently during this work and contains the user's earlier service/model cleanup. It is not included as a database architecture change. Concurrent TypeScript configuration edits remain outside this work's commits.

## Verification record

- PostgreSQL 15 in an isolated Docker container, bound to `127.0.0.1:55432`.
- Integration suite: **15 tests passed**, including clean installs, migration reruns, legacy upgrade/preservation, preflight diagnostics, restricted-role RLS, constraints, immutability, concurrent writers, expiry, cascades, purge audit, context reset, and query plans.
- Drizzle migration journal/snapshot check: passed.
- Regenerating from the final declarative schema: **no schema changes**.
- Development seed smoke test: passed twice against a fresh disposable database, preserving one draft fixture without login credentials.
- Read-only reconciliation report and JSONL export: passed against synthetic legacy data, including a newline/backslash/tab escape round-trip. The smoke database was removed and the test container stopped afterward.
- Database package TypeScript: passed with the installed TypeScript 5.9 compiler and CLI `--ignoreDeprecations 5.0` override. Concurrent configuration specifies `6.0`, which TypeScript 5.9 rejects; those user edits were preserved.
- Broader services/tRPC type checks (with the same compiler override) remain blocked by existing references to removed Google OAuth, forms and responses modules/services/routes. No unrelated application feature was restored to make those checks pass.
- Cursor query uses `submissions_page_idx`. Numeric range query uses `answers_numeric_idx` on the privileged connection; restricted-role numeric filtering remains correct but uses a sequential scan on the fixture because of PostgreSQL 15's non-leakproof numeric comparisons under RLS. This is documented as a performance limit, not reported as a successful runtime range-index optimization.
- The 2000-submission fixture verifies query behavior, not production throughput or capacity.

Application publishing/answer semantics, login provisioning, storage deletion execution and deployment-specific rollout remain explicit later-phase/operations responsibilities. Original migration files and unrelated user changes were preserved.
