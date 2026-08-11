# Approved Payment Instruction simplification

## Scope

This update changes only the presentation of the Finance/Admin Approved Payment Instruction. It does not change approval authority, payment readiness, payee verification, payment recording, audit logging, role permissions, database relationships, or stored records.

## Updated instruction layout

The on-screen, print, and PDF versions now contain only:

- Approved Payment Instruction title
- Request reference and generated date
- A concise purchase summary derived from the request line items and business justification
- Department / project
- Approved amount
- Vendor / payee
- Account name
- Bank name
- Account number
- Currency
- Payment method
- Approver and approval date

Operational metadata such as purchase-order availability, workflow status, Finance verification, transfer type, reconciliation reference, generated-by details, and internal warnings remains available to the application and audit trail but is not printed inside the payment slip. Existing warnings continue to display separately to authorised Finance/Admin users before the instruction.

## Presentation improvements

- Centered, bounded payment-instruction card instead of a long unformatted field list
- Branded header with logo, reference, and date
- Separate Payment Summary and Vendor Account Details sections
- Responsive two-column account-detail grid
- Prominent approved amount
- Compact approval footer
- Matching polished PDF layout
- Print CSS hides unrelated application controls

## Verification

- Full automated suite: 98 tests passed
- PostgreSQL compatibility audit: passed with 0 errors and 0 warnings
- 1,431 SQL literals audited
- No database migration required
