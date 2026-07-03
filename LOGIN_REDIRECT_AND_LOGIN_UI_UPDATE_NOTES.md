# Login Redirect and CMOTD Login UI Update

## Scope

This update changes only the anonymous login entry point and shared-link handling.

- Existing SQLite user accounts and password hashes are unchanged.
- Existing roles, permissions, navigation routes, forms, dashboards, workflows, attachments, and audit records are unchanged.
- No database migration is required.

## Shared-link protection

URLs may contain `pf_section` and `pf_role` navigation hints. When a visitor has no valid signed-in session, the application now removes those hints and renders the login interface. After the user signs in, their own role landing page is loaded; the sender's workspace page is not inherited.

## Login interface

The login page now uses the approved CMOTD two-panel desktop design:

- original CMOTD / maritime visual panel on the left;
- centered CMOTD wordmark and ProcureFlow form on the right;
- responsive single-panel layout on small displays;
- no visible Local demo credentials list;
- blank username and password fields by default.

The existing local demo accounts and their passwords still work exactly as before; they are only no longer displayed or prefilled.

## Safe patch contents

Copy the patch files into the existing project while preserving folders:

```text
core\auth.py
static\branding\cmotd_login_left_panel.webp
```

Do not replace or delete the `data` folder.
