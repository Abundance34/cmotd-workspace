# PostgreSQL Runtime Query Corrections

This release corrects the PostgreSQL runtime errors reported from the Admin, Procurement Manager, Finance, and Auditor workspaces without changing their business workflows, permissions, navigation, data model, or user-facing actions.

## Corrected pages

- Admin → Notifications Monitor
- Procurement Manager → Procurement Reports
- Finance → Financial Dashboard
- Finance → Cash Advances (Retire and Register)
- Finance → Reconciliation
- Finance → Financial Reports
- Auditor → Audit Dashboard
- Auditor → Document Archive & Download Audit
- Auditor → User & Security Audit
- Auditor → Expense Review

## Corrections

1. Notification readiness now groups every selected PostgreSQL column explicitly.
2. Monthly/yearly report queries use explicit quoted aliases and ordinal grouping.
3. Numeric `receipt_id` relationships are no longer compared with empty text.
4. Cash-advance balance filters repeat the aggregate expression in `HAVING` instead of referencing a SELECT alias.
5. Reconciliation groups all selected purchase-order and joined vendor fields.
6. Psycopg literal-percent handling is safe for both parameterized and non-parameterized `LIKE '%...%'` queries.
7. Expense audit joins through the existing `expenses.requested_by` relationship.
8. The private handoff compliance report groups joined user names explicitly.

## Compatibility safeguards

- Added focused regression tests for every corrected query class.
- Extended the repository-wide PostgreSQL audit to reject numeric-ID/empty-string comparisons, unsupported HAVING aliases, unsafe report aliases, invalid expense ownership references, incomplete notification grouping, and incomplete reconciliation grouping.
- No database migration is required for this update.
- No existing PostgreSQL data is modified.
