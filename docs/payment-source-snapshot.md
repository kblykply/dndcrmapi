# One-time finance source in Supabase

Payment Tracking and Collection Report default to a private Supabase read model.
No Logo connection is used by these modules unless `PAYMENT_SOURCE_MODE=logo` is
explicitly set. The backend still enforces ADMIN/ACCOUNTING access.

`PaymentSourceBatch` holds the import time and the active version;
`PaymentSourceDataset` stores bounded source query results as JSONB, including
view metadata, installments, invoice attributes, contacts and the independent
financial audit. Query fingerprints bind an import to the source SQL version.
If an application source query changes, reimport before deploying that change;
an unmatched dataset fails closed rather than silently reading live Logo.
The tables have RLS and no browser access policies. They are backend-only.

To import from a machine with access to both Logo and Supabase:

```
cd api
npx ts-node scripts/import-payment-snapshot.ts
```

The importer reads and audits Logo, checks complete invoice attributes, verifies
JSON round-trip case equivalence, then creates only the two dedicated tables and
activates all datasets in one PostgreSQL transaction. It does not apply unrelated
pending migrations. After first provisioning, register this migration using:

```
npx prisma migrate resolve --applied 20261009010000_payment_source_snapshot
```

This is a one-time copy, not synchronization. Logo changes, payments and deletions
after import are not reflected until another explicit import. UI shows importedAt
separately from the latest Supabase read time. Aging is recalculated for the current
day; monetary balances stay those of the imported source. Workflow changes continue
to use existing CRM tables; they do not update imported Logo balances.

A later import deactivates but retains the previous batch. A rollback can reactivate
that batch in a transaction after deactivating the current one. No source rows are
printed by the import script. Backend database credentials and Logo credentials
must never be placed in NEXT_PUBLIC variables.
