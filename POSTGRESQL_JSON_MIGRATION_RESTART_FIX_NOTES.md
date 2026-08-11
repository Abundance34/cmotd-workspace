# PostgreSQL JSON migration restart fix

This correction addresses the `status: partial` / `failed: 231` result from the included SQLite database.

- 187 `audit_events` rows and 44 `payment_payee_detail_versions` rows contained JSON columns.
- The previous migration adapted those values to PostgreSQL JSONB twice.
- JSON values are now parsed once and adapted once by the PostgreSQL backend.
- Deferred `NOT VALID` foreign keys left by a prior partial attempt are removed before a restart and recreated only after a fully successful load.
- Immutable payee version history no longer has a cascading foreign key to a current payee row, so historical evidence can survive record replacement or deletion.
- The migration remains idempotent and uses upserts, so already migrated records are not duplicated.
