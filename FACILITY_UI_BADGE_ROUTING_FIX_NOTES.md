# Facility Payee, Layout, Badge and Routing Fix

This correction is presentation- and routing-scoped. It does not change approval authority, request statuses, payee encryption, vendor-selection rules, finance verification, or PostgreSQL records.

## Corrected

- Facility Managers can review the complete encrypted payee details that they entered on their own request; unrelated roles remain masked.
- Payee details now render as high-contrast read-only detail cards rather than faint disabled inputs.
- Vendor quotations render in separate bordered and padded cards.
- Expander bodies have consistent internal padding.
- Text, number, date, time, select and textarea controls have visible borders, hover states and blue focus rings.
- Disabled controls remain readable.
- Creating a Utility / Facility draft creates a section-routed in-app notification for **My Draft Requests**, restoring the navigation badge until that section is opened.
- Submitting a draft validates any stored Procurement Manager assignment, falls back to another active Procurement Manager account, creates/repairs the private thread, and sends the work notification to **Utility Head / Facility Head Inbox**.
- Procurement Manager availability means an active account; the user does not need to be simultaneously logged in.

## Verification

- PostgreSQL compatibility audit: passed, 0 errors, 0 warnings, 1,430 SQL literals.
- Targeted UI/routing and existing compatibility tests: 32 passed.
- Python compilation: passed.
