# Security policy

## Supported versions

Sumikami is under active development and does not yet maintain stable release lines. Security fixes target the latest code on the default branch, `main`. Older commits, forks, and deployment-specific customizations do not receive backported fixes.

## Report a vulnerability

Use GitHub's [Report a vulnerability form](https://github.com/aalampatil/sumi-kami/security/advisories/new) to submit a private report to the repository maintainer, [aalampatil](https://github.com/aalampatil).

If GitHub private reporting is unavailable, email [aalam.workacc@gmail.com](mailto:aalam.workacc@gmail.com) with the subject `Sumikami security report`.

Do not disclose vulnerability details in public issues, pull requests, discussions, or logs before coordinating with the maintainer. Never send live credentials, access tokens, database connection strings, or personal form responses. Use a minimal reproduction with synthetic data.

Include:

- A description of the issue and its likely impact.
- The affected commit, component, and relevant configuration, with secrets removed.
- Reproduction steps or a minimal proof of concept.
- Expected and observed behavior, including any authorization or workspace boundary crossed.
- Suggested mitigations, if known, and how to contact you for follow-up.

Relevant concerns include authentication bypass, workspace isolation failures, unauthorized access to submissions, injection, credential exposure, and unsafe handling of uploaded files. Share dependency vulnerabilities when you can identify how this project is affected.

## What happens next

The maintainer will review the report, ask for missing details, and coordinate investigation, remediation, and disclosure with the reporter. This is a volunteer-maintained project; response and fix times depend on availability and severity, with no guaranteed service level.

If you have not received an acknowledgment within seven days, follow up using the same private channel. Keep details private while a fix is being coordinated. Once a fix is ready, agree on the disclosure timing and whether you want public credit. There is no paid bug bounty program.

## Development and deployment

Keep secrets server-side and environment files out of Git. Use development authentication keys and synthetic data locally. Before deploying or changing database access, review the [authentication rollout guide](docs/auth/clerk-setup.md#production-boundary) and [database runtime role requirements](docs/database/operations.md#runtime-roles-and-connection-boundaries). Development examples are not a production security configuration.
