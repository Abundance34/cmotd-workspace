# Database Cutover Rollback

## Decision point

Rollback is appropriate when the PostgreSQL revision has a material integrity, authentication, payment, or document-access defect that cannot be corrected safely inside the cutover window. Stop new production writes before switching back; otherwise PostgreSQL-only changes would be lost.

## Application rollback to SQLite

1. Place the Cloud Run service in maintenance mode or route traffic away.
2. Record the PostgreSQL cutover end time and preserve PostgreSQL logs/reports.
3. Select the final pre-cutover backup directory created by `backup_sqlite_for_migration.py`.
4. Restore the database:

```bash
python scripts/rollback_database_cutover.py \
  --restore-sqlite data/backups/cloudsql_migration/pre_cloudsql_TIMESTAMP/procureflow_workspace.db \
  --target-sqlite data/procureflow_workspace.db
```

5. Restore the matching document files from the same backup manifest.
6. Set:

```text
PROCUREFLOW_DATABASE_BACKEND=sqlite
PROCUREFLOW_DATABASE_URL=
PROCUREFLOW_SQLITE_PATH=data/procureflow_workspace.db
```

7. Restart the previous known-good application revision.
8. Run `python scripts/database_healthcheck.py` and the login/request/payment smoke tests.
9. Reconcile any transactions that occurred after the final SQLite freeze from PostgreSQL audit logs before resuming normal work.

## Preserve PostgreSQL for investigation

Do not drop the PostgreSQL schema during an operational rollback. Keep it read-only for reconciliation and root-cause analysis.

The destructive cleanup command exists only for an unused test destination and requires an exact confirmation phrase:

```bash
python scripts/rollback_database_cutover.py \
  --drop-postgres \
  --confirm DROP-PROCUREFLOW-PUBLIC-SCHEMA
```

Never run that command against a production database that contains cutover activity.
