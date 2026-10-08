# Organization management

## Scope

The existing `OrgChartNode` hierarchy is extended in place. Existing IDs, titles,
parent links, ordering and legacy type/color metadata are retained. No employee
assignments, job descriptions or earlier history are invented during migration.
Each existing node receives a baseline audit snapshot.

The Project Monopoly frontend route and navigation entry have been removed.
Shared project, customer, unit and agent-wheel data are unaffected.

## Access

- ADMIN and MANAGER create, edit, approve, assign, archive and restore records.
- SALES, CALLCENTER, AFTERSALES and ACCOUNTING can read organization records.
- An active occupant can acknowledge their own approved job description.
- PREVIEW receives empty responses without querying organization data and cannot write.
- Position titles and assignments never change `User.role` or `User.managerId`.
- Read responses include only user ID, name and active status, not contact information.
- RLS protects organization tables from direct Supabase client access. The existing
  Prisma table-owner connection continues to access them through authenticated API routes.

## Records

Kinds: COMPANY, DEPARTMENT, POSITION, TEAM. A position can have one current occupant;
a person can occupy multiple positions. Departments and teams contain positions.
Reassignment or removal stores the previous/current occupant and actor in an audit snapshot.
Inactive occupants remain visible and flagged; they are not silently removed.

Definitions include document code, purpose, duties, authority/decision limits,
required competencies, performance indicators, reporting line and review date.
Definitions link to existing quality process cards with R/A/C/I responsibilities.
The matrix exposes missing accountable records; it is not an automatic compliance assessment.
The linked quality card retains its existing documents/checklists.

## Revision lifecycle

1. Create or edit a draft.
2. Complete the document code, purpose, duties, authority, review date and (for
   positions) competencies before approval.
3. An ADMIN/MANAGER approves the revision. Review dates cannot already be overdue.
4. The occupant acknowledges the approved revision.
5. Any definition edit increments its revision and clears approval/acknowledgment.
   Reassignment clears acknowledgment but does not change the job description revision.
6. Archive rather than delete. Occupied positions and parents with active children
   cannot be archived. Restore archived parents before their children.

`version` is a separate optimistic concurrency token incremented by every mutation.
Clients must supply it to update/action routes. Stale writes return HTTP 409.
An advisory transaction lock serializes hierarchy mutations to prevent concurrent
cycle/reparent/archive races. Audit writes and the corresponding changes are atomic.
Audit snapshots retain the actor's name and the complete before/after definitions.
History is paginated, so older revisions remain accessible.

This supports ISO 9001:2015 responsibilities, competence, awareness and document
control practices (4.4, 5.3, 7.2, 7.3, 7.5). It does not certify compliance, establish
employee competence by itself, or replace a company-approved quality procedure.
Reference: https://www.iso.org/standard/62085.html

## API

- GET `/org-chart/workspace`: nodes, active user choices, quality process choices.
- GET `/org-chart` and `/org-chart/flat`: non-archived hierarchy / records.
- GET `/org-chart/:id`: details, latest 100 events and total event count.
- GET `/org-chart/:id/history?cursor=<eventId>`: older events, 100 per page.
- POST `/org-chart`: create definition.
- PATCH `/org-chart/:id`: replace definition, with `version`.
- POST `/org-chart/:id/assignment`: `version`, `userId` (explicit null unassigns), optional note.
- POST `/org-chart/:id/approve|archive|restore|acknowledge`: `version`, optional note.
- DELETE `/org-chart/:id`: compatibility alias for archive; also requires `version`.

## Deployment and verification

The two additive organization migrations only affect organization records and
their links. They do not create or modify Logo tables, snapshots or source data.
The first migration is wrapped in a transaction; the second enables RLS.

```sh
npx prisma migrate deploy
npx prisma generate
npm run build
npm test -- --runInBand org-chart
node scripts/verify-organization.cjs
```

The integration script uses the configured database and a real administrator ID,
but creates only temporary organization records inside a transaction that is always
rolled back. It checks assignment/approval/acknowledgment/revision/archive history
and verifies that the record/audit counts remain unchanged. It does not update users.
Run it on a test environment where possible; it briefly acquires the organization
write lock. Rebuild first so it uses the current compiled service.

Frontend: `/org-chart` and `/org-chart/:id`; model/translation tests:
`node --test tests/organization-model.test.mjs` in the web repository.

Restarting the API still clears the separate, pre-existing RAM-only Logo snapshot.
No automatic Logo synchronization was introduced.
