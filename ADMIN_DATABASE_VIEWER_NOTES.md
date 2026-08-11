# Admin Database Viewer Update

Added an Admin-only, read-only SQLite Database Viewer inside ProcureFlow.

Scope of change:
- Added a Database Viewer tab to the Admin sidebar.
- Viewer lists SQLite tables, table structure, row counts, searchable rows, and CSV export.
- Viewer performs read-only SELECT and PRAGMA operations only.
- Sensitive fields are masked in the UI.
- No users, passwords, workflows, roles, permissions, or database records were changed.
