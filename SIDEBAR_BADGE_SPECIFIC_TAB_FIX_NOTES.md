# Sidebar Badge Specific Tab Fix

This update changes only the sidebar notification badge behavior.

## What changed

- Sidebar badges are now driven only by unread notifications routed to the exact sidebar section.
- Generic workflow/history counts are no longer used to place badges on unrelated tabs.
- Opening a tab marks only that tab's routed notifications as read, clearing that tab's badge like opening a WhatsApp chat.
- Other tabs keep their own unread badge counts until those tabs are opened.
- Badge counts still display as numbered red pills and use `99+` for counts over 99.

## What did not change

- Users
- Passwords
- SQLite data model
- Procurement workflows
- Roles and permissions
- Login/session behavior
- Navigation layout
- Dashboard content
