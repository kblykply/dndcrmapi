# IT Destek

Employee IT support tickets are independent of Tasks, Digital Team and the private Digital Map. No team-catalog membership grants access. No notifications, emails or external integrations are invoked, and no sample tickets are seeded.

## Access and privacy

All current active `ADMIN`, `MANAGER`, `SALES`, `CALLCENTER`, `AFTERSALES` and `ACCOUNTING` accounts may create tickets and access their own tickets. A dedicated guard rejects preview identities before the global preview interceptor. Every API operation also checks the current database account; a valid but stale token does not grant administrative access.

Management requires both an ADMIN token identity and a current active ADMIN database account. Only these administrators may see the full queue, the active-ADMIN assignee directory, triage tickets or add internal notes. Assignments are to active ADMIN accounts, independent of Digital Team membership. An unchanged inactive assignee may be retained while editing other fields.

Requester scope is applied before list search, counts, pagination, detail and downloads. Inaccessible records return 404. Non-administrators cannot select another queue scope. Public/internal entry visibility is filtered in database queries and again before serialization. Requesters never receive internal note bodies, authors, attachment metadata or files. Search only examines visible ticket fields, never note text. Internal-only activity preserves the requester's displayed update timestamp and sort order; the shared concurrency version still increases.

## API

| Method | Path | Input/result |
| --- | --- | --- |
| GET | `/it-support/workspace` | `{me, canManage, agents}`; non-admin agents is empty |
| GET | `/it-support/tickets` | Paginated summaries and scope-specific statistics |
| POST | `/it-support/tickets` | Create input → ticket detail |
| GET | `/it-support/tickets/:id` | Ticket detail, capabilities, latest 40 visible entries and visible attachment metadata |
| GET | `/it-support/tickets/:id/entries?cursor=...` | Older visible entries and next cursor |
| POST | `/it-support/tickets/:id/entries` | `{version, body, visibility}` → detail |
| POST | `/it-support/tickets/:id/actions` | `{version, action, message}` → detail |
| PUT | `/it-support/tickets/:id/triage` | Triage input → detail; ADMIN only |
| GET | `/it-support/attachments/:id` | Authenticated download |

Create and reply accept either JSON or multipart with one `payload` JSON-string field and up to three `files` fields. Ticket creation, the initial entry and all supplied files commit together. Reply uploads are also atomic; failed requests leave no detached files.

List parameters: `scope=MINE|ALL|ASSIGNED|UNASSIGNED`, `q`, `status`, `priority`, `category`, `type`, `skip`, `take`. The default scope is ALL for administrators and MINE for employees. ASSIGNED means assigned to the current administrator. Default page size is 40, maximum 100. Search covers subject, ticket code/number, affected system and requester name. Statistics apply the selected scope before search and other filters; open, unassigned and overdue counts concern open tickets only. No automated due date or SLA is invented.

History pages contain at most 40 entries in chronological order; prepend older pages. Cursors are opaque and ticket-scoped. The detail response provides server-derived `canReply`, requester `actions` and administrator `allowedStatuses`.

## Workflow and concurrency

Tickets start NEW. The unique database sequence produces codes such as `DND-IT-000123`; gaps after rolled-back transactions are normal. No `max + 1` allocation is used.

Each mutation requires the current positive `version`. A compare-and-swap update acquires the row lock before changes, attachment quotas and append-only entries are committed in one transaction. Stale writes return 409 `IT_SUPPORT_VERSION_CONFLICT`; clients must reload. Invalid input returns 400 `IT_SUPPORT_INVALID`. There are no delete endpoints.

- Requesters may cancel an open or resolved ticket with a reason, confirm RESOLVED → CLOSED, or reopen RESOLVED/CLOSED → NEW with a reason. Even an administrator may use these actions only on their own ticket.
- A public requester reply to WAITING_REQUESTER automatically returns it to IN_PROGRESS.
- Administrators may move an open ticket to IN_PROGRESS, WAITING_REQUESTER, WAITING_VENDOR, RESOLVED or CANCELLED. RESOLVED may become CLOSED or IN_PROGRESS; CLOSED/CANCELLED may become IN_PROGRESS. Retaining the current status is valid.
- Entering a waiting state, resolving, cancelling or reopening requires a reason. Resolution is stored as both the public solution and a public status entry. Reopening clears the solution and resolution/closure timestamps.
- Public replies and internal notes are blocked on CLOSED/CANCELLED until explicit reopening.
- First response records the first substantive public administrator response by somebody other than the requester. Assignment-only changes and internal notes do not count. Reopening preserves this timestamp.
- Triage reasons are public. Private investigation details belong in explicit INTERNAL notes.

Initial priority matrix:

| Impact / urgency | LOW | NORMAL | HIGH |
| --- | --- | --- | --- |
| SINGLE | LOW | NORMAL | NORMAL |
| TEAM | NORMAL | NORMAL | HIGH |
| COMPANY | NORMAL | HIGH | URGENT |

Administrators can subsequently adjust priority during triage.

## Limits and attachments

Subject, affected system and location: 160 characters. Description: 10,000. Reply, note, action reason and triage reason: 5,000. A reply body may be blank only when files accompany it. Due date is a valid ISO timestamp or null.

Attachments: at most three per request, 5 MiB per file, ten files and 20 MiB total per ticket. Contents, MIME and extension are checked for PNG, JPEG, WebP, PDF and UTF-8 TXT. SVG, HTML and unsupported binary formats are rejected. Quota failures give a generic limit message without revealing private file counts. Files reside in dedicated PostgreSQL bytea rows, always linked to the same ticket and entry through foreign keys. Visibility is inherited from that entry. No public URL or disk upload directory is used.

Downloads require a fresh account/access check and return `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and an attachment disposition with a sanitized RFC 5987 filename. Supported-format checks do not constitute antivirus scanning.

## Rollout and verification

The additive migration is `prisma/migrations/20260916140000_add_it_support/migration.sql`. It adds three tables, enums, foreign keys, constraints and indexes. User foreign keys use SET NULL while preserving historical name snapshots. RLS is enabled without public policies on the new tables. PostgreSQL sequences do not support RLS; direct PUBLIC and existing Supabase anon/authenticated sequence privileges are revoked instead. API database privileges must permit the normal server-side inserts.

Review pending migrations before applying them:

```sh
npx prisma migrate status
npx prisma migrate deploy
npm run prisma:generate
npm run build
```

Restart the API after successful migration and build. The migration does not modify existing ticket data or account permissions.

```sh
npm test -- --runInBand --watchman=false it-support
npx prisma validate
npm run build
```

Tests use fixtures only. They cover all employee roles, preview and stale-token rejection, requester scope, internal note/file isolation, transition rules, atomic writes and rollback, cursors, upload format/size/count boundaries and the real Nest JSON/multipart HTTP pipeline.

## Local rollout verification — 2026-09-16

- Applied `20260916140000_add_it_support` after verifying it was the only pending migration, with no unfinished migrations.
- Read-only checks against the real database confirmed ADMIN management access, ACCOUNTING requester-only access, all three tables protected by RLS, and zero seeded tickets.
- Final API verification: 127 tests across three suites, production build and Prisma schema validation passed. This includes actual multipart Unicode-filename regressions.
- Frontend verification: 18 model/navigation tests, targeted lint, production build, and isolated browser scenarios for employee/ADMIN workflows, attachments, history, version conflicts, independent public/internal drafts, all roles, mobile and English dark mode passed.
- Local runtime: frontend `/it-support` on port 3001; API on port 3002. Page and health return200; anonymous workspace and ticket-list requests return401.
