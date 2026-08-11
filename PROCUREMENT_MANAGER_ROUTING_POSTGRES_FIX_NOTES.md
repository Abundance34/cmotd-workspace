# Procurement Manager Routing PostgreSQL Fix

## Issue
Facility/Utility Head drafts incorrectly reported that no active Procurement Manager account existed, even though an active Procurement Manager user was present.

## Root cause
`facility_manager_links.is_active` is a legacy numeric flag in the PostgreSQL schema, while `users.is_active` is Boolean. The compatibility normalizer interpreted the shared `is_active` column name as Boolean inside `COALESCE(fml.is_active, 1)`, producing an invalid PostgreSQL expression. The linked-manager lookup raised an exception, and the previous broad exception handler returned `None` before trying the active-role fallback.

## Correction
- Kept `facility_manager_links.is_active` explicitly numeric with `CAST(... AS BIGINT)`.
- Kept `users.is_active` explicitly Boolean.
- Isolated linked-assignment lookup errors so a stale or malformed link cannot suppress the active Procurement Manager fallback.
- Preserved the existing automatic routing, collaboration thread, status update, and notification workflow.
- Added regression tests for normalized PostgreSQL SQL and fallback execution.

## Verification
- Included SQLite database resolves Facility Manager user `6` to Procurement Manager user `2`.
- Full automated suite: 89 tests passed.
- No database migration is required.
