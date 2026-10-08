# Work management

## Data boundaries

The `/tasks` module extends the existing `CrmTask` records. It does not replace the separate lead follow-up `Task` or agency `AgencyTask` models. Existing IDs, assignees, CRM links, dates and audit rows remain intact. Two additive migrations create the work tables and import existing CRM task audit rows into the new activity timeline. Old audit records did not contain every before-value; those values are not invented.

This is CRM data in the existing Supabase PostgreSQL database. The independent Logo reporting database and manual RAM snapshot are unchanged.

## Access

- Every active staff role can create work projects and unprojected tasks. PREVIEW returns empty data before querying CRM tables and cannot mutate/download files.
- ADMIN and MANAGER can access/manage all work projects.
- Project owners and LEAD members manage project configuration and membership.
- MEMBER users edit work in their projects; VIEWER users only read, download and follow.
- Private projects require explicit membership. Assigning a task requires an active, non-viewer project member or project owner.
- Unprojected tasks preserve creator/assignee access and the old sales-owned agency/customer read access. Parent owners/assignees can also access their direct subtasks.
- API checks the current database role and active status, not just a potentially stale JWT role.
- Removing or downgrading a member is blocked while they have open assignments. Archived projects are read-only until restored.
- Work tables use RLS without client policies. The existing CrmTask table also has direct anon/authenticated grants revoked; the Nest database role accesses them through validated API routes.

## Workflow

Statuses: TODO, IN_PROGRESS, BLOCKED, IN_REVIEW, DONE, CANCELLED.
Priorities: LOW, MEDIUM, HIGH, URGENT.
Types: TASK, BUG, REQUEST, MILESTONE.

Project, assignee and CRM relationships are optional for task creation. Start/due dates are optional; due cannot precede start. Each task has labels and an estimated duration.

One level of subtasks is supported. Dependencies stay within a work project (or unprojected scope) and are checked for cycles, including the parent/subtask completion relationship. DONE requires finished checklist items, subtasks and dependencies. Cancelled dependencies are treated as resolved. Reopening blocking work first requires reopening completed dependent work/parents.

Task/project field mutations require their current `version`; stale saves return 409. Related entries use the enclosing task version. Membership and graph mutations acquire a project-scoped transaction advisory lock. Bulk changes support 1–50 same-project tasks, validate every item and version, and commit all or none. They use set-based database writes.

The legacy DELETE task endpoint now archives, not hard-deletes. Work must be completed/cancelled first; child tasks are archived first. Project identity and task parent/project are fixed after creation in this version. Other fields, comments, checklist and time entries are editable. Comment/time/file removal is limited to the author or ADMIN/MANAGER; changes remain in activity history.

Deleting a lead only detaches its optional work link. User deletion, including force deletion, is blocked when the user created/was assigned work or owns a work project; deactivate the account instead. Inactive assignees remain visible on historical tasks and do not prevent unrelated field edits.

## Notifications and history

Each mutation records task activity and the existing global audit record in the same transaction. Assignment/change/comment/file notifications for the creator, assignee and followers are persisted transactionally after access filtering. Live socket publication is best effort after commit. Socket delivery failure cannot report a committed task save as HTTP 500. Clients can refresh notifications normally if realtime delivery is unavailable.

No automatic reminder scheduler, sprints, recurring tasks, custom workflow editor or external Jira/Asana integration is enabled. Calendar/timeline display loaded task pages; loading more includes further records. Reports aggregate all matching records, not only loaded rows. CSV export retrieves all filtered pages and escapes spreadsheet formulas.

## Files

Files are stored in the separate WorkAttachment BYTEA table in Supabase, not the public uploads folder. Maximum 5 MB/file, 10 files and 20 MB/task. Metadata queries exclude binary content. Downloads recheck task membership and use attachment disposition, no-store and nosniff headers. Allowed extensions/signatures: PDF, PNG, JPEG, DOCX, XLSX, TXT, CSV. This is type/size validation, not an antivirus scanner. If file volume grows, move binary payloads to private object storage while retaining authenticated downloads.

## Intermittent database errors

Reproduced P2028: Prisma's default 2-second transaction acquisition budget expired during remote Supabase connection establishment. Previously six simultaneous organization workspace requests often returned 500. The same probe returned six 200 responses after the fix.

Prisma transaction acquisition now waits at least the configured pg connection timeout plus 5 seconds (default 30 seconds). Global transaction execution defaults to 30 seconds. Pool size remains conservative (default 2). Duplicate Prisma providers in agencies/customers/calendar were replaced with the shared PrismaModule. Development pool timers are cleared on shutdown.

Known temporary database connection errors are translated to 503 with a safe message and request reference. Unique/concurrent-write conflicts become 409; missing records become 404. Unknown errors remain 500 with a trace reference; requests/SQL/customer data are not logged by the filter. Mutations are never blindly retried.

Configuration: PG_POOL_MAX, PG_POOL_MIN, PG_IDLE_TIMEOUT_MS, PG_CONNECTION_TIMEOUT_MS, PRISMA_MAX_WAIT_MS, PRISMA_TRANSACTION_TIMEOUT_MS. Existing environment overrides are retained and bounded. A pool minimum does not preconnect clients; it retains established idle connections.

## Verification

`npm test -- --runInBand` covers validation, workflow/cycle/file rules and database error classification. `node scripts/verify-work-tracking.cjs` executes service integration checks in a transaction and deliberately rolls back every fixture, notification and audit record. It does not send email or change real customers. Run after building; remote database latency makes it slower than unit tests.

`node scripts/verify-work-bulk.cjs` verifies a 50-item bulk update and stale-version all-or-none behavior, also rolling back all test data.
