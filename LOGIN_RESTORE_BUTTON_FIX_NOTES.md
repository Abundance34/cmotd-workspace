# Login Restore Button Fix

Focused fix only.

## Corrected
- Removed the blocking cookie-restore loop that could show only "Restoring your signed-in session..." after pressing Login.
- The login form now stays usable while the optional browser-cookie bridge becomes ready.
- Normal authenticated Streamlit server-session login remains immediate.
- Saved browser-session restore still works when the cookie token is available on a rerun.

## Not Changed
- Users
- Passwords
- SQLite database content
- Roles and permissions
- Procurement workflows
- Forms
- Dashboards
- UI outside the login/session restore path

Validation:
- Python compilation passed.
- All 23 tests passed.
