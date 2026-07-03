# Sidebar Native Toggle and Header Rendering Fix

## Scope
This release changes only `app.py`.

## Fixed
- Removed the raw SVG/HTML command-bar block that could appear as literal code in the workspace.
- Replaced the collapse anchor link with a native Streamlit button.
- The button now folds or restores the sidebar within the same page and browser tab.
- The collapsed state is kept in the active browser session; it is not written to the URL.
- Existing red notification/task dots and sidebar navigation remain unchanged.

## Not Changed
- SQLite database, `data` folder, user accounts, passwords, roles, permissions, workflows, notifications, forms, and reports.
