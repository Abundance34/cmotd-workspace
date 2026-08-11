# SQLite to Google Cloud SQL for PostgreSQL

## Architecture

- Local development may use SQLite.
- Production uses `PROCUREFLOW_DATABASE_BACKEND=postgresql`.
- Cloud Run connects through the Cloud SQL Unix socket at `/cloudsql/INSTANCE_CONNECTION_NAME`.
- Database credentials, session-cookie material, payee encryption material, and audit-signing material are injected from Secret Manager.
- Uploaded procurement documents remain file-backed. For Cloud Run, mount a private Cloud Storage bucket at `/mnt/procureflow` so existing file-path relationships remain valid and survive instance replacement.

## 1. Prepare Google Cloud

Enable Cloud Run, Cloud Build, Artifact Registry, Cloud SQL Admin, Secret Manager, and Cloud Storage APIs. Create:

1. A PostgreSQL Cloud SQL instance in the intended region.
2. Database `procureflow`.
3. A least-privilege application user such as `procureflow_app`.
4. A private Cloud Storage bucket for uploaded documents and backup manifests.
5. A dedicated Cloud Run runtime service account.
6. Secret Manager entries for the database password, session-cookie secret, payee encryption key, and audit-signing key.

Grant the runtime service account only the permissions needed to connect to Cloud SQL, read the named secrets, and read/write the named document bucket.

## 2. Freeze and back up SQLite

Place the application in a maintenance window so writes stop. Then run:

```bash
python scripts/backup_sqlite_for_migration.py \
  --sqlite data/procureflow_workspace.db \
  --output-dir data/backups/cloudsql_migration \
  --data-dir data
```

The backup command creates:

- a consistent SQLite backup using the SQLite backup API;
- `PRAGMA integrity_check` result;
- table counts;
- database SHA-256;
- a document manifest containing path, size, and SHA-256;
- restore instructions.

Copy the complete backup directory to protected off-host storage before continuing.

## 3. Connect the migration workstation to Cloud SQL

Use one of these controlled paths:

- Cloud SQL Auth Proxy on the migration workstation, then set `PROCUREFLOW_DATABASE_URL`; or
- a private-IP route from an approved administration host; or
- a one-off Cloud Run Job with Cloud SQL attached.

Example local proxy URL configuration:

```bash
export PROCUREFLOW_DATABASE_BACKEND=postgresql
export PROCUREFLOW_DATABASE_URL='postgresql://procureflow_app:REDACTED@127.0.0.1:5432/procureflow'
export PROCUREFLOW_SEED_DEFAULTS=0
```

Do not put the real URL in source control or shell history. Prefer an environment file with restrictive permissions or a Secret Manager-backed job.

## 4. Run the restart-safe migration

```bash
python scripts/migrate_sqlite_to_postgres.py \
  --sqlite data/procureflow_workspace.db \
  --report data/backups/cloudsql_migration/migration_report.json
```

The migrator:

1. Applies the PostgreSQL baseline and feature migrations.
2. Reads SQLite in read-only mode.
3. Maps SQLite booleans, dates, timestamps, numeric values, and JSON to PostgreSQL types.
4. Uses table primary/unique keys for `ON CONFLICT` upserts.
5. Uses a savepoint per source row so one rejected row is reported without losing the whole table.
6. Resets identity sequences after explicit ID migration.
7. Applies relationship constraints after data loading.
8. Writes successful and failed counts per table and a bounded per-record failure report.

See `docs/MIGRATION_REPORT_FORMAT.md` for the report contract and cutover retention requirements.

Rerunning the command does not duplicate rows that have stable primary or unique keys.

## 5. Verify before cutover

```bash
python scripts/verify_database_migration.py \
  --sqlite data/procureflow_workspace.db \
  --report data/backups/cloudsql_migration/verification_report.json
```

Review every mismatch. Verification covers:

- source/destination count for every SQLite table;
- byte-for-byte password-hash preservation;
- important parent/child relationships;
- missing document paths on the current host;
- users, requests, vendor suggestions, approvals, payees, payments, receipts/OCR, notifications, histories, and archives through table coverage.

After every reported error is resolved, validate deferred foreign keys:

```bash
python scripts/verify_database_migration.py \
  --sqlite data/procureflow_workspace.db \
  --validate-constraints \
  --report data/backups/cloudsql_migration/verification_report_validated.json
```

## 6. Copy documents and rewrite persistent paths

Mount the private target bucket at `/mnt/procureflow` on the migration host or one-off Cloud Run Job, then run:

```bash
python scripts/migrate_document_storage.py \
  --sqlite data/procureflow_workspace.db \
  --source-root data \
  --target-root /mnt/procureflow \
  --report data/backups/cloudsql_migration/document_migration_report.json
```

The command inventories every supported document-path column, resolves relative and legacy Windows paths, copies each file with checksum verification, reuses identical files on restart, and rewrites the corresponding PostgreSQL row to the mounted persistent path. Missing or ambiguous source paths are reported and cause a `partial` result.

Preserve the backup manifest and document-migration report. Do not proceed while either report contains missing or failed files. JSON attachment collections remain unchanged and should be checked during the application smoke test where those legacy fields are used.

## 7. Deploy Cloud Run

Copy `deploy/cloudrun.env.example` to `deploy/cloudrun.env`, replace every value, then run:

```bash
./deploy/deploy_cloud_run.sh deploy/cloudrun.env
```

The deployment uses the Cloud SQL attachment, Secret Manager mappings, and a Cloud Storage volume mount. The app starts with production seeding disabled and PostgreSQL as the only production database backend.

## 8. Production smoke test

Run these checks against the deployed service:

1. `python scripts/database_healthcheck.py` returns PostgreSQL `ok=true`.
2. A migrated user logs in with the existing password hash.
3. Forced and voluntary password changes rotate the session and redirect correctly.
4. Procurement opens Create Request and View Requests separately.
5. Three vendors retain distinct quoted prices after reload.
6. Approver rescinds an unpaid approval with a reason; Finance cannot pay it.
7. A paid approval cannot be rescinded through the standard command.
8. Finance receives the selected verified payee without re-entry.
9. Finance prints and exports an Approved Payment Instruction PDF.
10. Payment notification reaches the complete recorded workflow chain without account details.
11. Proof of Payment and Vendor Receipt uploads process OCR once and persist results.
12. Mark Completed atomically sets completion and archive metadata while preserving history/register access.

## 9. Cutover

Only after verification and smoke tests pass:

- keep SQLite writes frozen;
- take one final backup and migration pass;
- rerun verification;
- route production traffic to the PostgreSQL Cloud Run revision;
- keep the previous revision and final SQLite backup available for the agreed rollback window;
- monitor database errors, connection pool saturation, notification failures, OCR failures, and document-path errors.

## Official references

- Cloud SQL from Cloud Run: https://cloud.google.com/sql/docs/postgres/connect-run
- Cloud Run Secret Manager integration: https://cloud.google.com/run/docs/configuring/services/secrets
- Cloud Storage volume mounts for Cloud Run services: https://cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts
