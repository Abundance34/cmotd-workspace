# Static Login Layout Fix

This update changes only the anonymous login screen.

- Desktop login uses a fixed viewport-height two-panel composition so the login form does not scroll vertically.
- The left panel uses the CMOTD marine vessel and offshore-platform visual supplied for the login design.
- The right panel centers the login card and keeps the full authentication form, footer, and legal text inside the visible desktop canvas.
- The mobile layout still allows normal page scrolling when screen height or width is limited.
- Existing users, passwords, SQLite records, session handling, shared-link login protection, roles, permissions, navigation, and procurement workflows are unchanged.
