# PostgreSQL startup boolean compatibility fix

## Problem

After a successful SQLite-to-PostgreSQL migration, the Docker application could
fail during startup with `psycopg.errors.DatatypeMismatch` because established
SQLite SQL embedded `0` and `1` directly in BOOLEAN inserts and updates.

The same compatibility code could also rewrite an update such as
`SET is_read=1` into invalid PostgreSQL syntax (`SET is_read IS TRUE`).

## Correction

- INSERT boolean literals are converted to PostgreSQL `TRUE` / `FALSE` based on
  the destination table and column.
- UPDATE `SET` assignments and WHERE comparisons are converted separately.
- Existing parameterized 0/1 values continue to be coerced safely.
- Docker Compose now disables default/demo seeding after a migrated database is
  present. It can still be enabled explicitly with
  `PROCUREFLOW_SEED_DEFAULTS=1` for a brand-new empty demo database.
- The application file included in this hotfix uses `st.cache_resource`, which
  removes the deprecated `st.cache` startup warning.

## Validation

The complete automated suite passed: 47 tests.
