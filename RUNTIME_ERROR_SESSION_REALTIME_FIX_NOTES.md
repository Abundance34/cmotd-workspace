# Runtime Error, Refresh Session, and Live Update Fix

Focused update only:

- Added safe missing workspace helpers used by Admin, Procurement, Facility, Logistics, Finance, Approver, and Auditor navigation pages.
- Fixed NameError crashes on activity history and availability/delegation pages.
- Preserved current page after browser refresh by waiting for the encrypted browser-session cookie bridge before showing the login page.
- Increased default session duration substantially.
- Added optional near-real-time Streamlit autorefresh polling so notifications/shared messages can appear without manual browser refresh.
- Left users, passwords, SQLite records, procurement workflows, roles, permissions, forms, and business logic unchanged.

Deployment note:
- Keep the existing `data` folder to retain live SQLite records and uploaded files.
- Run `pip install -r requirements.txt` so `streamlit-autorefresh` is available for near-real-time updates.
