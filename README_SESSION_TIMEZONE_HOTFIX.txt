ProcureFlow PostgreSQL Session Timezone Hotfix

Fixes:
- TypeError: can't compare offset-naive and offset-aware datetimes after login.
- Normalizes PostgreSQL timestamptz and legacy SQLite/session-state timestamps to UTC.
- Uses timezone-aware UTC timestamps for session expiry and heartbeat checks.

Apply by extracting this archive into the ProcureFlow project root with overwrite enabled,
then rebuild and recreate only the procureflow container.

No database migration is required. Do not delete the PostgreSQL volume.
