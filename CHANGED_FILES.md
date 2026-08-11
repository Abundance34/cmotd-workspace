# ProcureFlow Cloud SQL and E2E Update - Changed Files

## Application and configuration

- `.env.example` - Added secure SQLite/PostgreSQL, Cloud SQL, pooling, storage, session, OCR, SMTP, and secret configuration examples without real credentials.
- `.dockerignore` - Excludes local databases, backups, secrets, caches, test artifacts, and environment files from container builds.
- `Dockerfile` - Added PostgreSQL production defaults, OCR dependencies, persistent directories, and application/database health checks.
- `docker-compose.yml` - Added a local PostgreSQL service and PostgreSQL-backed ProcureFlow development configuration.
- `requirements.txt` - Added psycopg 3 and psycopg-pool dependencies.
- `pytest.ini` - Added deterministic test discovery/settings.
- `README.md` - Documented the Cloud SQL and E2E workflow update and linked the operational guides.
- `data/procureflow_workspace.db` - Preserved the supplied SQLite data and applied only the additive local compatibility schema required to test the new workflows before cutover.

## Core runtime

- `core/auth.py` - Added transactional password changes, obsolete-session revocation, secure session rotation, success messaging, and role-dashboard redirection.
- `core/config.py` - Added backward-compatible secure environment settings.
- `core/db.py` - Added backend routing, timezone-aware timestamps, PostgreSQL-safe helpers, additive E2E schema, indexes, notification dedupe, explicit payment-document relationships, and PostgreSQL-safe audit inserts.
- `core/db_backend.py` - Added the pooled PostgreSQL/Cloud SQL DB-API compatibility layer, qmark translation, SQLite SQL normalization, boolean/JSONB coercion, retries, health checks, and graceful pool shutdown.
- `core/postgres_schema.py` - Added checksummed numbered PostgreSQL migration execution and production initialization.
- `core/ocr.py` - Added stronger receipt preprocessing, orientation/noise/skew handling, multi-page PDF OCR, and field-specific extraction.
- `core/ui.py` - Added the final authoritative light-only design tokens, responsive block/payee/payment components, readable controls/tables/JSON, and print-only payment-instruction styling.

## Role interfaces

- `modules/role_workspaces.py` - Added separate Create/View Request blocks, vendor-owned pricing, approval rescission controls, structured payee cards, Finance payment/PDF/print flow, file-only receipt/OCR/version views, exact transfer types, and single-action completion/archive.
- `modules/auditor_hardening.py` - Made audit JSON filtering portable to PostgreSQL while retaining read-only evidence behavior.

## Workflow services

- `services/payee_service.py` - Preserved the replacement workflow while linking the current verified payee into request/approval/Finance relationships.
- `services/vendor_quote_service.py` - Added vendor-specific quote and line-item persistence/selection.
- `services/approval_rescission_service.py` - Added immutable, reason-required, pre-payment approval rescission with permissions, history, audit, and notifications.
- `services/payment_workflow_service.py` - Added selected vendor/payee/approval payment linkage, exact transfer types, currency, idempotency, audit, and complete-chain notifications.
- `services/payment_instruction_service.py` - Added authorised structured payment instruction resolution, print HTML, organisation logo, and professional PDF generation.
- `services/receipt_document_service.py` - Added secure file-only Proof of Payment/Vendor Receipt uploads, explicit payment links, checksum/version history, persisted OCR, review/correction/retry, replacement, discrepancy checks, and audit events.
- `services/completion_service.py` - Added atomic eligibility validation, completion, workflow closure, archive metadata, activity/audit evidence, and participant notifications.
- `services/workflow_participant_service.py` - Added deduplicated request-participant discovery for workflow notifications.

## PostgreSQL migrations

- `migrations/postgresql/001_initial_schema.sql` - Complete PostgreSQL baseline for the existing SQLite schema.
- `migrations/postgresql/002_e2e_workflow_enhancements.sql` - Additive vendor, payee, payment, receipt/OCR, rescission, completion/archive, notification, constraint, and index changes.
- `migrations/postgresql/003_relationship_constraints.sql` - Deferred/NOT VALID foreign keys for safe post-load verification and validation.

## Migration, backup, verification, and deployment tools

- `scripts/__init__.py` - Makes cutover utilities importable for tests and reuse.
- `scripts/generate_postgres_schema.py` - Generates/audits PostgreSQL baseline definitions from SQLite metadata.
- `scripts/backup_sqlite_for_migration.py` - Creates a consistent SQLite backup, integrity result, hashes, counts, document manifest, and restore note.
- `scripts/migrate_sqlite_to_postgres.py` - Performs restart-safe row migration with savepoints, conversions, upserts, sequence resets, and detailed reports.
- `scripts/migrate_document_storage.py` - Copies referenced documents to persistent mounted storage, verifies checksums, resolves legacy paths, and rewrites PostgreSQL path columns idempotently.
- `scripts/verify_database_migration.py` - Compares all table counts, password hashes, relationships, document references, and optionally validates foreign keys.
- `scripts/database_healthcheck.py` - Checks the configured SQLite or PostgreSQL backend.
- `scripts/rollback_database_cutover.py` - Provides guarded PostgreSQL-to-SQLite cutback configuration guidance and health verification.
- `deploy/cloudrun.env.example` - Defines non-secret Cloud Run deployment inputs and Secret Manager names.
- `deploy/deploy_cloud_run.sh` - Builds and deploys with Cloud SQL attachment, Secret Manager mappings, pooled PostgreSQL, and a mounted Cloud Storage document volume.

## Documentation

- `docs/LOCAL_RUN.md` - SQLite and local PostgreSQL run instructions.
- `docs/CLOUD_SQL_MIGRATION.md` - End-to-end backup, migration, document transfer, verification, deployment, smoke-test, and cutover procedure.
- `docs/DATABASE_MIGRATIONS.md` - Explanation of each numbered database migration and restart strategy.
- `docs/MIGRATION_REPORT_FORMAT.md` - Migration, verification, and document-transfer report contracts.
- `docs/DATABASE_ROLLBACK.md` - Rollback conditions and procedure.
- `docs/CUTOVER_CHECKLIST.md` - Final production cutover checklist.
- `docs/REGRESSION_TEST_REPORT.md` - Automated/local verification results and target-environment limitations.

## Tests

- `tests/conftest.py` - Adds isolated, fast, session-scoped database fixtures without mutating the supplied database.
- `tests/test_password_change_flow.py` - Tests forced password change, old-password invalidation, session revocation, and new-password login.
- `tests/test_e2e_workflow_enhancements.py` - Tests vendor pricing, payee replacement/Finance flow, rescission/payment gates, PDF, notifications, receipt/OCR/versioning, and atomic completion/archive.
- `tests/test_postgres_compatibility.py` - Tests SQL translation, boolean/JSONB/temporal compatibility, restart-safe upserts, and migration contents.
- `tests/test_acceptance_surface.py` - Verifies the final UI/service surfaces and required delivery files.
- `tests/test_document_storage_migration.py` - Tests legacy Windows-path resolution and persistent target mapping.

- `CHANGED_FILES.md` - This complete change inventory.

## PostgreSQL migration hotfix (2026-07-26)

- `migrations/postgresql/002_e2e_workflow_enhancements.sql` — corrected the receipt OCR index to use the established `receipt_records.status` column instead of the non-existent `verification_status` column.
- `core/db.py` — applied the equivalent SQLite compatibility-index correction.
- `tests/test_postgres_compatibility.py` — added regression coverage and schema/index consistency validation.
- `MIGRATION_HOTFIX_NOTES.md` — documented the failure, correction, and safe rerun procedure.

## PostgreSQL JSON migration restart correction

- `scripts/migrate_sqlite_to_postgres.py` — fixes JSONB double adaptation, resets deferred FKs after partial runs, and applies relationship constraints only after complete success.
- `core/db_backend.py` — prevents repeat Json/Jsonb wrapping.
- `migrations/postgresql/003_relationship_constraints.sql` — preserves immutable payee version history without cascading deletion.
- `tests/test_postgres_migration_json_restart.py` — regression coverage for the 231-row failure.
- `POSTGRESQL_JSON_MIGRATION_RESTART_FIX_NOTES.md` — operational notes.

## Final cumulative PostgreSQL stabilization (2026-07-27)

- `.streamlit/config.toml` — forces one authoritative light Streamlit theme and disables usage telemetry.
- `core/db.py` — skips SQLite trigger syntax on PostgreSQL, adds safe notification initialization fallback, and removes repeated schema work from recipient fan-out.
- `core/db_backend.py` — centralizes runtime SQLite DDL conversion for identity, BOOLEAN and JSONB columns and translates `last_insert_rowid()`.
- `core/report_service.py` — central timezone-safe Excel workbook generation.
- `modules/auditor_hardening.py` — routes Auditor Excel exports through the shared workbook generator.
- `modules/role_workspaces.py` — uses backend-neutral table discovery for the Admin database viewer and removes the obsolete unguarded SQLite-only duplicate helpers.
- `migrations/postgresql/004_sqlite_substr_date_compatibility.sql` — PostgreSQL overloads for historical date/timestamp `substr` reports.
- `migrations/postgresql/005_audit_immutability.sql` — database-level append-only triggers for PostgreSQL audit events.
- `scripts/audit_postgres_compatibility.py` — repository-wide SQL normalization, schema/type parity, export, theme, integrity, migration and packaging audit.
- `scripts/verify_postgres_runtime.py` — read-only live PostgreSQL deployment verification.
- `postgres_schema_current.sql` — supplied schema-only PostgreSQL snapshot normalized to UTF-8 for repeatable auditing.
- `tests/test_postgres_stabilization.py` — identity/BOOLEAN/JSONB/Excel/audit migration coverage.
- `tests/test_postgres_full_audit.py` — enforces a passing repository-wide compatibility audit.
- `tests/test_notification_schema_performance.py` — prevents notification fan-out from repeating schema migrations.
- `tests/test_postgres_dashboard_theme_hotfix.py` and `tests/test_acceptance_surface.py` — updated to the final light-only contract.
- `docs/POSTGRESQL_STABILIZATION_REPORT.md` — consolidated stabilization evidence and acceptance definition.
- `docs/POSTGRESQL_COMPATIBILITY_AUDIT.md` and `docs/postgres_compatibility_audit.json` — generated audit results.
- `docs/FINAL_RUNTIME_ACCEPTANCE.md` — role/page Docker and browser acceptance matrix.
- `docs/REGRESSION_TEST_REPORT.md` — final 68-test report and environment boundary.
- `tests/conftest.py` — supplies test-only encryption/audit keys so the suite never generates or packages a local runtime secret.

## PostgreSQL runtime query corrections — 2026-07-28

- `core/db_backend.py`
  - Avoids activating psycopg placeholder parsing for empty parameter sequences.
  - Escapes literal percent signs safely when parameterized queries contain SQL `LIKE` patterns.
  - Applies the same protection to `executemany` operations.
- `modules/role_workspaces.py`
  - Corrects notification readiness grouping, report aliases/grouping, numeric receipt relationships, cash-advance aggregate filtering, reconciliation grouping, and private-handoff grouping.
- `modules/workspace.py`
  - Corrects legacy cash-advance aggregate filtering/grouping.
- `modules/auditor_hardening.py`
  - Uses the existing `expenses.requested_by` relationship for expense ownership evidence.
- `scripts/audit_postgres_compatibility.py`
  - Adds static guards for the PostgreSQL semantic incompatibilities exposed by the reported pages.
- `tests/test_postgres_runtime_query_fixes.py`
  - Adds regression coverage for each corrected runtime query class.
- `docs/POSTGRESQL_RUNTIME_QUERY_FIX_AUDIT.json`
- `docs/POSTGRESQL_RUNTIME_QUERY_FIX_AUDIT.md`
- `POSTGRESQL_RUNTIME_QUERY_FIX_NOTES.md`

## PostgreSQL reserved date-alias correction (2026-07-28)

- `modules/auditor_hardening.py`
  - Replaced the unquoted `day` SQL alias with PostgreSQL-safe `event_day` and ordinal grouping.
  - Preserved the existing chart input by renaming the dataframe column back to `day` after query execution.
- `modules/workspace.py`
  - Corrected the general analytics monthly trend query to use `trend_month`, ordinal grouping, and the existing visible `month` label.
- `scripts/audit_postgres_compatibility.py`
  - Added a build-time guard for unqualified `day`, `month`, and `year` aliases following `substr(...)`.
- `tests/test_postgres_runtime_query_fixes.py`
  - Added regression tests for both corrected date-alias queries.
- `POSTGRESQL_AUDITOR_DAY_ALIAS_FIX_NOTES.md`
  - Added implementation and verification notes.

## Facility UI, badges and Procurement Manager routing

- `modules/role_workspaces.py` — secure owner payee visibility, vendor quote padding, draft badges, and active Procurement Manager routing.
- `core/ui.py` — visible control borders/focus states, expander padding, readable detail cards and disabled controls.
- `tests/test_facility_visibility_badges_routing.py` — regression coverage for the reported issues.
- `FACILITY_UI_BADGE_ROUTING_FIX_NOTES.md` — implementation and verification notes.

## Procurement Manager routing PostgreSQL correction

- `modules/role_workspaces.py`
  - Prevented the legacy numeric `facility_manager_links.is_active` flag from being rewritten as a PostgreSQL Boolean.
  - Ensured failed/stale link lookup falls back to any active Procurement Manager rather than returning no manager.
- `tests/test_facility_visibility_badges_routing.py`
  - Added normalized-SQL and fallback regression coverage.
- `PROCUREMENT_MANAGER_ROUTING_POSTGRES_FIX_NOTES.md`
  - Documents the issue, correction, and verification.

## Sidebar badge exact targeting correction

- `app.py`
  - Uses exact widget-key class-token selectors for navigation badge pseudo-elements.
  - Removes the duplicate text/emoji badge fallback from navigation labels.
- `tests/test_sidebar_badge_exact_targeting.py`
  - Covers index-prefix collisions and duplicate badge rendering.
- `SIDEBAR_BADGE_EXACT_TARGETING_FIX_NOTES.md`
  - Documents the correction and verification.

## Procurement badge single-target correction

- `app.py`
  - Uses exact navigation widget-key selectors so index 1 does not match indexes 10–17.
  - Renders only one visual badge per navigation item.
- `modules/role_workspaces.py`
  - Relies on the centralized request-transition notification for Facility submissions.
  - Prevents one submission from lighting both Purchase Requests and Facility Inbox.
- `tests/test_sidebar_badge_exact_targeting.py`
  - Covers exact selector targeting and duplicate badge prevention.
- `tests/test_procurement_badge_routing_single_section.py`
  - Covers single-section notification routing for Facility submissions.
- `tests/test_facility_visibility_badges_routing.py`
  - Updated to verify centralized notification handling.
- `PROCUREMENT_BADGE_SINGLE_TARGET_FIX_NOTES.md`
  - Documents the correction and verification.

## Approved Payment Instruction simplification (2026-07-29)

- `services/payment_instruction_service.py`
  - Builds a concise purchase summary from request line items and business justification.
  - Replaces the long unformatted instruction list with a polished Payment Summary and Vendor Account Details layout.
  - Simplifies the print and PDF versions to the approved account/payment fields while retaining all underlying audit data.
  - Formats generated and approval timestamps for human-readable display without changing stored timestamps.
- `tests/test_payment_instruction_simplified.py`
  - Covers summary generation, concise field visibility, omitted operational metadata, and valid PDF generation.
- `PAYMENT_INSTRUCTION_SIMPLIFICATION_NOTES.md`
  - Documents scope, visible fields, unchanged workflow behavior, and verification.
