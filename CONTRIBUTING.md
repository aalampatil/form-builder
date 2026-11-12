# Contributing to Sumikami

We welcome bug reports, documentation improvements, accessibility fixes, tests, and code contributions. All participants must follow the [code of conduct](CODE_OF_CONDUCT.md).

## Before you start

Search [existing issues](https://github.com/aalampatil/sumi-kami/issues) and pull requests before opening a new one. Use the [issue chooser](https://github.com/aalampatil/sumi-kami/issues/new/choose) for bugs and feature requests. Describe the user problem and expected behavior; include a small reproduction for bugs.

Discuss substantial features, schema changes, or architectural changes in an issue before investing in an implementation. Small fixes and documentation improvements can go straight to a pull request. Check the [project plan](docs/project-plan.md) for the current scope: the database foundation and development authentication are implemented; the form builder services and UI are still evolving.

Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md). For questions about contributing, search the documentation and existing issues first; a clearly described question issue is welcome if they do not answer it.

## Set up development

1. Fork the repository and clone your fork.
2. Install Node.js 20.9 or newer, pnpm 9.0.0, and Docker with Compose.
3. Follow [Local setup](README.md#local-setup) to start PostgreSQL, copy the example environment files, install dependencies, and apply migrations to your local development database.
4. Follow the [Clerk configuration guide](docs/auth/clerk-setup.md#local-resources-and-commands) to configure your own development instance. The API reads `apps/api/.env.local`; the web app reads `apps/web/.env.local`. Use matching development keys and local authorized origins.
5. Run `pnpm dev:auth` for the web app and API, or `pnpm dev` to include Drizzle Studio.

Do not commit environment files, credentials, session tokens, personal data, or real form responses. Use synthetic data and redact logs and screenshots before sharing them.

## Make a focused change

Create a branch from the default branch, `main`, such as `fix/submission-validation` or `docs/local-setup`. Keep each pull request focused on one problem. Follow the existing TypeScript, Zod validation, and package boundaries:

| Location            | Responsibility                                         |
| ------------------- | ------------------------------------------------------ |
| `apps/web`          | Next.js dashboard, authentication pages, and public UI |
| `apps/api`          | Express server and HTTP integration                    |
| `packages/trpc`     | Typed API routers and context                          |
| `packages/services` | Server-side business logic and identity integration    |
| `packages/database` | Drizzle models, migrations, and database tests         |
| `docs`              | Architecture, operations, product plans, and design    |

Validate inputs at API boundaries, enforce workspace authorization in trusted server code, and preserve tenant isolation. See [database architecture](docs/database/architecture.md) and [operations](docs/database/operations.md) before changing persistence. Add forward migrations; do not rewrite applied migrations or their history. Include the SQL guards, indexes, and role grants that a schema change needs.

Update documentation when behavior or setup changes. Add meaningful regression coverage for changed behavior when appropriate. Include keyboard and accessibility checks for interface changes.

## Validate your work

Run relevant checks from the repository root and include the commands and outcomes in your pull request:

```sh
pnpm lint
pnpm check-types
pnpm build
```

For formatting, pass the files you changed explicitly:

```sh
pnpm exec prettier --check README.md CONTRIBUTING.md
pnpm exec prettier --write path/to/changed-file.ts
```

Replace the example paths with your changed files. The commit hook checks staged files with Prettier and does not rewrite them. Avoid formatting unrelated files. Report failing or unavailable checks with their error and whether they also fail on `main`; do not describe an unrun check as passing.

For database and identity changes, use the [disposable PostgreSQL test setup](docs/database/operations.md#verification) and [authentication test instructions](docs/auth/clerk-setup.md#verification-record):

```sh
pnpm --filter @repo/database db:check
pnpm --filter @repo/database test:db
pnpm --filter @repo/services test:auth
```

Both test suites require an explicitly set `TEST_DATABASE_URL` for a disposable local PostgreSQL server with database/role creation privileges. They create and drop their own test databases. Never point them at production or a database containing useful data. Follow the linked guides for environment setup and PowerShell examples.

For authentication UI changes, configure development keys and the browser dependencies described in the [authentication guide](docs/auth/clerk-setup.md), start the apps, then run:

```sh
pnpm --filter web test:auth:e2e
```

These browser tests create synthetic accounts in the development Clerk instance. They require installed Chrome and retain their test accounts.

## Open a pull request

Open a pull request against `main` and complete the template. Explain the problem, the resulting behavior, relevant issue links, validation results, and any migration or rollout requirements. Include screenshots for visible UI changes. Use `Closes #123` only when the pull request resolves that issue.

Use a descriptive title and clear commit messages. A draft pull request is welcome for work in progress. Respond to review feedback and keep the description current as the change develops. Maintainers may request changes or defer work that does not fit the current roadmap. Reviews are handled as availability permits; there is no guaranteed turnaround time.

## License

By contributing, you agree that your contributions are provided under the repository's [MIT License](LICENSE). Only submit material you have the right to contribute, and preserve required third-party notices.
