# PostgreSQL Compatibility Audit

**Status:** PASSED
**Generated:** 2026-07-27T16:24:39+00:00

## Coverage

- Python files scanned: 44
- SQL literals normalized and checked: 1428
- Guarded SQLite-only literals: 10
- SQLite application tables: 68
- PostgreSQL application tables: 68
- Errors: 0
- Warnings: 0

## PostgreSQL migrations

- `001_initial_schema.sql`
- `002_e2e_workflow_enhancements.sql`
- `003_relationship_constraints.sql`
- `004_sqlite_substr_date_compatibility.sql`
- `005_audit_immutability.sql`

## Findings

No compatibility errors or warnings were found.

## Interpretation

A passing result proves static SQL normalization, schema/type parity, SQLite integrity, export centralization, required migrations, packaging-secret checks, and the light-only theme contract for this source tree. It complements—rather than replaces—the automated workflow suite and the final Docker/browser acceptance checklist.
