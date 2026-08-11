# Final Cloud SQL Cutover Checklist

## Before migration

- [ ] Maintenance window approved and communicated.
- [ ] Application writes frozen.
- [ ] Final SQLite backup completed with `integrity_check=ok`.
- [ ] Backup database SHA-256 recorded.
- [ ] Document manifest copied off-host.
- [ ] Cloud SQL database/user created with least privilege.
- [ ] Runtime service account has Cloud SQL, Secret Manager, and bucket access only as needed.
- [ ] Production secrets exist and are independently rotated.
- [ ] `PROCUREFLOW_SEED_DEFAULTS=0` for production.

## Migration and verification

- [ ] PostgreSQL migrations 001–003 applied successfully.
- [ ] Migration report has no failed records.
- [ ] Every source/destination table count matches.
- [ ] Password hashes match byte-for-byte.
- [ ] No required relationship has orphan rows.
- [ ] Deferred foreign keys validated.
- [ ] Identity sequences are above migrated maximum IDs.
- [ ] All required document paths exist in the mounted bucket.
- [ ] No primary keys, request references, users, or document references were reset.

## Functional acceptance

- [ ] Existing users can log in.
- [ ] Password-change redirect/session rotation works.
- [ ] Old password fails after change.
- [ ] Create Request and View Requests are separate.
- [ ] Request Register still retains historical, completed, and archived records.
- [ ] Each vendor shows and stores its own price and line-item totals.
- [ ] Selected vendor and selected amount flow to approval and Finance.
- [ ] Authorised Procurement and Finance see structured full payee details; no raw JSON is shown.
- [ ] Existing payee-replacement workflow works and preserves version history.
- [ ] Internet Bank Transfer and Physical Bank Transfer are available and audited.
- [ ] Eligible approval rescission requires a reason and notifies participants.
- [ ] Paid approval cannot be rescinded by UI or direct service call.
- [ ] Payment notifications include the Approver and workflow chain without account numbers.
- [ ] Finance print view and PDF contain the correct approved details.
- [ ] Receipt creation requires an uploaded PDF/PNG/JPG/JPEG.
- [ ] Only Proof of Payment and Vendor Receipt categories are available.
- [ ] OCR status/confidence/discrepancies persist and correction is audited.
- [ ] OCR does not rerun on ordinary Streamlit rerenders.
- [ ] Mark Completed performs completion and archive in one transaction.
- [ ] Post-Payment Closure exposes no duplicate archive/close button.
- [ ] The authoritative light-only theme is readable across roles and smaller widths, regardless of Windows/Chrome appearance settings.
- [ ] Section navigation renders as clear blocks.

## Production switch

- [ ] Cloud Run revision health check passes.
- [ ] Production environment reports backend `postgresql`.
- [ ] No production write path targets the SQLite file.
- [ ] Connection pool sizing matches Cloud Run maximum instances/concurrency and Cloud SQL limits.
- [ ] Logging excludes passwords, secrets, and full bank details.
- [ ] Monitoring/alerting covers 5xx errors, DB connection failures, OCR failures, notification outbox failures, and missing document paths.
- [ ] Previous revision and final SQLite backup retained for rollback window.
