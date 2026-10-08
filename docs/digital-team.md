# Dijital Ekip

Independent project and recurring-process portfolio. The existing task and work-project modules are unchanged. Records start empty; the optional bootstrap creates only the verified initial team member.

## Access and data

- Every endpoint requires JWT authentication and an active `ADMIN` account checked against the current database. Managers, other roles, preview identities and stale ADMIN tokens are rejected.
- A team member is a person in the portfolio, optionally linked to a CRM account. Creating a member or assigning responsibility never creates an account or grants permissions.
- Members can be deactivated. Existing references remain readable and may be retained on save; new assignments require an active member. There are no hard-delete endpoints.
- Projects store links, workstreams and external factors as one versioned aggregate. Project changes and append-only `CREATED`, `UPDATED` and `NOTE` activities commit atomically. Every update requires the latest positive `version`; stale writes return HTTP 409 with `DIGITAL_TEAM_VERSION_CONFLICT`.
- Writes serialize member deactivation with assignment validation using a transaction-scoped PostgreSQL advisory lock. Audit names come from the authenticated account, never request fields.
- `PROJECT` progress is an optional integer from 0 to 100. `null` means unspecified. A completed project has 100 if progress is specified. `PROCESS` always has `null` progress and may describe its recurrence in `cadence`.
- Workspace summaries omit child arrays and include counts and the latest explicit note. Full detail includes the latest 40 activities, with an opaque project-scoped cursor for older entries.
- The module sends no email, notification or integration request.

## Endpoints

| Method | Path | Input/result |
| --- | --- | --- |
| GET | `/digital-team/workspace` | Current administrator, team members, active non-preview account candidates and all project summaries |
| POST | `/digital-team/members` | Member input → member |
| PUT | `/digital-team/members/:id` | Member input + `version` → member |
| POST | `/digital-team/projects` | Project input → project detail |
| GET | `/digital-team/projects/:id` | Project detail |
| PUT | `/digital-team/projects/:id` | Project input + `version` → project detail |
| POST | `/digital-team/projects/:id/updates` | `{version, body}` → project detail |
| GET | `/digital-team/projects/:id/updates?cursor=...` | `{items, nextCursor}` |

Invalid input returns HTTP 400 with `DIGITAL_TEAM_INVALID`. Linking an already-linked CRM account returns HTTP 409 with `DIGITAL_TEAM_ACCOUNT_LINKED`. Missing records return HTTP 404.

## Validation limits

Names, titles, link labels, factor sources and cadence: 160 characters. Member contact: 240. Project summary/objective and update notes: 5,000. Next step, workstream description, factor notes/next action: 2,000. URL: 2,048; only absolute HTTP(S), with no embedded credentials or control characters. Factor URL can be blank.

A project permits 50 workstreams, 30 factors and 20 links. Child IDs must be unique across these arrays. Dates are real `YYYY-MM-DD` days; the project target cannot precede its start. Health defaults to `NOT_SET` when omitted. Unknown request fields are discarded by explicit validators.

Only `/digital-team` accepts JSON bodies up to 1 MiB. The existing default body limit remains unchanged for other modules.

## Rollout

From `api`, inspect pending migrations before deployment. The additive migration is `prisma/migrations/20260916120000_add_digital_team/migration.sql`; it creates three dedicated tables and enums, constraints and indexes. RLS is enabled on the new tables with no public policies; access goes through the authenticated API database connection.

```sh
npx prisma migrate status
# Apply after reviewing all pending migrations:
npx prisma migrate deploy
npm run prisma:generate
npm run build
```

Restart the API with the deployed build after the migration succeeds.

### Optional initial team member

The script uses the API environment and existing database TLS configuration. It requires exactly one active ADMIN account whose normalized full name is `Kubilay Kuplay`. It does not change that account. Existing linked members are a no-op; ambiguous accounts or a same-name unlinked member require review.

```sh
# Read-only preview; this is also the default mode.
node scripts/bootstrap-digital-team.cjs --dry-run
# Creates at most one member after the preview has been reviewed.
node scripts/bootstrap-digital-team.cjs --apply
```

The initial title is `Bilgi Teknolojileri`, contact is empty and membership is active. No projects, progress values, external factors or artificial history are seeded. No migration is run by the bootstrap script.

## Verification

```sh
npm test -- --runInBand --watchman=false digital-team
npm run build
npx prisma validate
```

DTO, guard, service and HTTP tests cover malformed inputs, role and preview restrictions, current-account authorization, stale versions, atomic history, inactive assignees, cursor pagination, body limits and the full nested payload through the real Nest controller pipeline. They use fixtures and do not access a live database.

## Local installation verification (2026-09-16)

- Applied `20260916120000_add_digital_team`; it was the only pending migration and no unfinished migrations were present.
- The unique active ADMIN account stored as `Kubilay` was inspected and linked to the initial catalog member **Kubilay Kuplay**, title **Bilgi Teknolojileri**. The full-name bootstrap dry-run correctly refused a non-exact account name; setup then used the inspected exact short account name in a guarded transaction. No account name, role or permissions were modified.
- No project/process records were seeded. All browser test records remained in intercepted API fixtures.
- API: 103 tests across 4 suites, production build and Prisma validation passed. Frontend: 19 model/navigation tests, lint, production build, and isolated browser CRUD/access/mobile/dark/keyboard checks passed.
- Local frontend: `http://localhost:3001/digital-team`; API: port `3002`. Health returns 200; unauthenticated workspace/detail calls return 401.
