# ProcureFlow PostgreSQL Stabilization Report

Date: 2026-07-27

## Purpose

This pass replaces the earlier page-by-page hotfix cycle with one cumulative PostgreSQL compatibility audit of the latest working project supplied by the user. The review covered application SQL, runtime schema guards, type conversion, exports, authentication/session timestamps, the light-only interface contract, migration parity, notification performance, and regression tests.

## Defect classes resolved

1. **Runtime SQLite DDL on PostgreSQL**
   - Legacy `AUTOINCREMENT` declarations are translated to PostgreSQL identity columns.
   - Runtime BOOLEAN and JSON declarations are aligned with the canonical PostgreSQL schema.
   - SQLite `INSERT OR IGNORE`, qmark placeholders, date wrappers, `GROUP_CONCAT`, `COLLATE NOCASE`, and `last_insert_rowid()` are normalized centrally.

2. **PostgreSQL date and timestamp behavior**
   - PostgreSQL date/timestamp overloads support the historical `substr(date_or_timestamp, ...)` report queries.
   - Authentication timestamps are normalized to UTC before comparison.
   - Excel exports convert timezone-aware values to timezone-neutral UTC values only in the generated workbook; stored PostgreSQL timestamps remain timezone-aware.

3. **PostgreSQL BOOLEAN and JSONB behavior**
   - SQLite `0/1` values are converted safely for PostgreSQL BOOLEAN columns.
   - JSONB values are adapted once, preventing the previous partial migration failure.
   - Runtime type maps were compared with the supplied live PostgreSQL schema dump and matched exactly.

4. **Migration and audit integrity**
   - The SQLite-to-PostgreSQL migration is restart-safe and relationship constraints are applied only after a complete data load.
   - PostgreSQL audit events now have database-level immutable update/delete triggers in migration `005_audit_immutability.sql`.
   - The shipped SQLite database and supplied PostgreSQL schema contain the same 68 application tables and matching column sets.

5. **Notification performance**
   - Notification fan-out no longer reruns the full phase-two, Finance, and dashboard schema initialization for every recipient.
   - The schema fallback remains available for standalone library calls that genuinely bypass normal application startup.

6. **Interface consistency**
   - Streamlit is pinned to one authoritative light theme.
   - Browser/Windows dark-mode probes were removed.
   - Sidebar primary/secondary navigation uses stable Streamlit selectors and full-opacity text.

## Repository-wide automated audit

Run:

```bash
python scripts/audit_postgres_compatibility.py \
  --json-report docs/postgres_compatibility_audit.json \
  --markdown-report docs/POSTGRESQL_COMPATIBILITY_AUDIT.md
```

Result for this release:

- Status: **PASSED**
- Python application files scanned: **44**
- SQL literals normalized and checked: **1,428**
- Guarded SQLite-only literals: **10**
- Residual unsupported SQLite SQL after normalization: **0**
- SQLite application tables: **68**
- PostgreSQL application tables: **68**
- Table mismatches: **0**
- Column mismatches: **0**
- BOOLEAN type-map mismatches: **0**
- JSONB type-map mismatches: **0**
- Excel writers bypassing the shared timezone-safe service: **0**
- Packaged runtime secrets: **0**

The machine-readable result is stored in `docs/postgres_compatibility_audit.json`.

## Automated regression result

```bash
pytest -q
```

Result: **68 tests passed**.

The suite covers permissions, role routing, password/session handling, migration restart behavior, vendor-specific pricing, payee replacement, approval rescission, payment gates, participant notifications, payment PDFs, secure receipt/OCR workflows, atomic completion/archive, reports, Excel timezone handling, PostgreSQL SQL normalization, schema/index consistency, light-only UI selectors, and the repository-wide compatibility audit.

## Live PostgreSQL runtime verification

After starting the final build in Docker, run:

```powershell
docker compose exec procureflow python scripts/verify_postgres_runtime.py `
  --report data/backups/postgres_runtime_verification.json
```

A passing report verifies:

- the active backend is PostgreSQL;
- the pool can execute queries;
- migrations `001` through `005` are applied;
- all 68 application tables exist;
- the date compatibility function works;
- BOOLEAN and JSONB columns match the application maps;
- immutable audit triggers exist;
- required roles are present; and
- representative workflow tables are readable.

## What constitutes final acceptance

The source/build is considered technically stabilized when all of the following are true:

1. `pytest -q` passes.
2. `scripts/audit_postgres_compatibility.py` reports `passed`.
3. `scripts/verify_postgres_runtime.py` reports `passed` in the user's Docker environment.
4. `docker compose logs procureflow` contains no new unhandled `Traceback`, `psycopg.errors`, `TypeError`, `ValueError`, `UndefinedFunction`, `UndefinedColumn`, or `SyntaxError` after the role/page smoke test.
5. The manual route checklist in `docs/FINAL_RUNTIME_ACCEPTANCE.md` is completed once for every role.

## Environment boundary

This build environment did not contain Streamlit, psycopg, a Docker daemon, or a live browser session, so it could not independently click every Streamlit route against the user's running PostgreSQL container. That last deployment-specific verification is provided as a deterministic runtime script and manual role matrix. The user's supplied live PostgreSQL schema, previously successful migration/constraint verification, and the full source/test/static audit were used as the evidence base for this consolidated release.
