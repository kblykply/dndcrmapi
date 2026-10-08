BEGIN;

-- CRM uses the authenticated Nest API; direct Supabase clients must not bypass project membership.
ALTER TABLE "CrmTask" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CrmTask" FROM anon, authenticated;

-- Preserve the existing audit timestamps and metadata; do not fabricate missing before-values.
INSERT INTO "WorkActivity" ("id", "taskId", "actorId", "actorName", "action", "changes", "createdAt")
SELECT 'legacy-' || a."id", a."entityId", a."actorId", COALESCE(u."name", 'System'),
  CASE a."action"
    WHEN 'CRM_TASK_CREATE' THEN 'CREATED'
    WHEN 'CRM_TASK_DONE' THEN 'COMPLETED'
    WHEN 'CRM_TASK_CANCEL' THEN 'CANCELLED'
    ELSE 'UPDATED'
  END,
  COALESCE(a."metaJson", '{}'::jsonb), a."createdAt"
FROM "AuditLog" a
JOIN "CrmTask" t ON t."id" = a."entityId"
LEFT JOIN "User" u ON u."id" = a."actorId"
WHERE a."entityType" = 'CrmTask'
  AND a."action" IN ('CRM_TASK_CREATE', 'CRM_TASK_UPDATE', 'CRM_TASK_DONE', 'CRM_TASK_CANCEL')
ON CONFLICT ("id") DO NOTHING;

COMMIT;
