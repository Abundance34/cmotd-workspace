# Notification Manual and Performance Update

Focused update only:

- Sidebar unread notification cards now use a dark/black high-contrast surface so messages are more visible.
- Notifications remain unread until the user explicitly clicks `Mark all as read`.
- Opening a workspace section no longer clears the notification indicator by itself.
- Sidebar red dots are now driven by unread notification counts by default, reducing repeated workflow-count scans on each navigation click.
- Added `PROCUREFLOW_FAST_NAVIGATION_DOTS=1` default behavior for faster interface switching; set it to `0` only if you want legacy workflow-scan dots.
- Added the full ProcureFlow User & Operations Manual under `docs/ProcureFlow_User_Operations_Manual.docx`.

No users, passwords, SQLite records, procurement workflows, roles, permissions, finance logic, logistics logic, or gateway-pass logic were intentionally changed.
