# Procurement Badge Single-Target Fix

## Problems corrected

1. A badge on the Procurement Manager's `Purchase Requests` item (widget index `1`) also appeared on indexes `10` through `17` because the CSS selector matched widget-key substrings instead of exact class tokens.
2. Facility submission created an explicit `Utility Head / Facility Head Inbox` notification and then the centralized status transition created the normal purchase-request notification. One submission therefore lit two legitimate navigation items.
3. The correctly targeted items displayed two visual badges because the count was rendered in both a CSS pseudo-element and the button label.

## Correction

- Uses exact class-token matching (`class~=`) for each navigation widget key.
- Removes the duplicate emoji/count fallback from the button label.
- Removes the second Facility-inbox notification from the submission handler.
- Retains the centralized purchase-request notification, so one Facility submission creates one Procurement Manager badge on `Purchase Requests`.
- Keeps the submitted request visible in `Utility Head / Facility Head Inbox` through its existing status and `next_role`; only the unread badge destination changes.
- Leaves workflow status, private thread creation, permissions, notifications history, and PostgreSQL data unchanged.

## Verification

- 95 automated tests passed.
- PostgreSQL compatibility audit passed with zero errors and zero warnings.
- 1,430 SQL literals and 68 SQLite/PostgreSQL tables were checked.
