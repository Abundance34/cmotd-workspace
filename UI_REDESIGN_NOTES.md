# ProcureFlow UI Redesign — Manage.ly Direction

This build applies a visual-only redesign based on the selected project-management dashboard inspiration.

## What changed

- Dark operational sidebar with a ProcureFlow brand marker, streamlined navigation styling, active-page treatment, and responsive native collapse behavior.
- Clean light workspace canvas, compact user/context bar, and clear workspace page headings.
- Modern KPI cards, tab switches, tables, forms, notifications, badges, inputs, upload areas, and action buttons.
- Centered, polished sign-in presentation using the existing login fields and authentication behavior.
- Responsive adjustments for smaller screens.

## What did not change

- SQLite database path, schema, records, attachments, encryption key, workflows, roles, permissions, user accounts, automation, notifications, audit history, reporting logic, and all original form content.
- Navigation sections, page content, actions, button behavior, and business rules.

The implementation is limited to presentation and layout code in `app.py`, `core/ui.py`, and the login layout in `core/auth.py`.
