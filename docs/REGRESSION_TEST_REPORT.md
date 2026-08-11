# Regression Test Report

Date: 2026-07-27

## Final cumulative result

```bash
pytest -q
```

**68 tests passed in one process.**

The supplied SQLite database was used through isolated copies for write-heavy tests. Its integrity check remains `ok` and the source database was not mutated by the suite.

## Covered areas

- Authentication, forced password changes, session revocation, UTC-aware session expiry, and legacy timestamp compatibility.
- Role permissions and routing for Admin, Procurement Manager, Facility/Utility Head, Finance, Approver, Logistics Officer, and Auditor.
- Vendor-specific quote totals and line-item prices.
- Verified/current payee linkage, replacement history, masking, encryption, and Finance visibility.
- Approval, mandatory-reason rescission, payment gating, immutable history, and participant notifications.
- Payment instruction PDF authorization and content.
- Proof of Payment and Vendor Receipt file requirements, validation, OCR persistence, confidence/review/correction/retry, replacement/version history, and discrepancies.
- Atomic completion, workflow closure, and archive behavior.
- PostgreSQL placeholder, BOOLEAN, JSONB, date/time, `GROUP_CONCAT`, `INSERT OR IGNORE`, identity-column, and runtime DDL compatibility.
- Restart-safe SQLite-to-PostgreSQL migration and deferred relationship constraints.
- PostgreSQL schema/index consistency and immutable audit migration.
- Timezone-safe Excel generation through the shared report service.
- Light-only Streamlit configuration and stable sidebar navigation selectors.
- Repository-wide static SQL/schema/export/theme/security audit.
- Notification fan-out avoiding repeated schema migrations.

## Additional verification

```bash
python -m compileall -q app.py core modules repositories services scripts workers
python scripts/database_healthcheck.py
python scripts/audit_postgres_compatibility.py \
  --json-report docs/postgres_compatibility_audit.json \
  --markdown-report docs/POSTGRESQL_COMPATIBILITY_AUDIT.md
```

The compatibility audit passed with 44 Python files and 1,428 SQL literals checked, exact 68-table/column parity, matching BOOLEAN/JSONB maps, no export bypass, no residual unsupported SQLite token after normalization, and no packaged runtime secret.

## Live target verification

The final Docker environment should additionally run:

```powershell
docker compose exec procureflow python scripts/verify_postgres_runtime.py --report data/backups/postgres_runtime_verification.json
```

Complete `docs/FINAL_RUNTIME_ACCEPTANCE.md` and check the post-smoke-test logs. This build environment did not have Streamlit, psycopg, Docker, or a live browser, so deployment-specific click-through evidence must come from the target Docker/Cloud SQL environment.
