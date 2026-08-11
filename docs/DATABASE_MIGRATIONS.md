# Database Migration Summary

## `001_initial_schema.sql`

Creates the PostgreSQL baseline corresponding to the complete SQLite application schema. SQLite integer booleans become PostgreSQL `BOOLEAN`; date/timestamp fields use `DATE`/`TIMESTAMPTZ`; structured JSON fields use `JSONB`; integer primary keys use identity columns while accepting migrated explicit IDs.

## `002_e2e_workflow_enhancements.sql`

Adds the requested workflow data without replacing existing records:

- vendor-owned quote totals, currency/date/document data, selection metadata, and `vendor_quote_items`;
- selected vendor/quote/payee links on purchase requests;
- immutable `approval_rescissions` and request rescission metadata;
- payment transfer type, payee, approval, reference, generation metadata, and explicit Proof-of-Payment/Vendor-Receipt relationships;
- exact receipt document category, checksums, OCR statuses/confidence/extracted fields, discrepancy state, correction state, retries, and document versions;
- completion/archive users and timestamps;
- notification dedupe/delivery support and indexes for common queues/filters.

SQLite compatibility uses the matching `ensure_e2e_update_schema()` additions so the updated application can be validated locally before the production cutover.

## `003_relationship_constraints.sql`

Adds deferrable, initially deferred, `NOT VALID` foreign keys after data loading. This prevents migration order from breaking historical imports while still allowing the verification script to detect orphans before constraints are validated. It covers identity, request/vendor, approvals, payees/payments/receipts, documents/OCR, gateway passes, delegation, and administrative relationships.

## Restart and duplicate protection

- `schema_migrations` stores migration filename, checksum, and application time.
- A changed already-applied migration checksum is rejected.
- Data copying uses primary/unique-key `ON CONFLICT` upserts.
- Each source row is protected by a savepoint and reported on failure.
- Payment, rescission, completion, receipt duplicate, and notification dedupe rules are also enforced by service commands and database constraints/indexes where appropriate.

## Persistent document paths

`scripts/migrate_document_storage.py` preserves existing file relationships during Cloud Run cutover by copying referenced documents to the mounted persistent root, verifying SHA-256 checksums, and updating PostgreSQL path columns by source record ID. The operation is restart-safe and produces a detailed document migration report.
