# ProcureFlow Expense Reconciliation & Refunds

## Purpose
This module accounts for real spending against a previously approved purchase request, without rewriting that original approval. It distinguishes an **unused budget** from **money actually advanced to an employee** and records proof of any returned funds.

## Roles
- Facility Manager, ICT, Logistics Manager, Procurement Manager: start a report **only against a request originally made by that user**, edit/save drafts, upload purchase receipts, submit, and provide refund transfer evidence when required.
- Procurement Manager: independently review reports submitted by Facility, ICT, and Logistics users whose request is assigned to them. Can approve expenses, return for correction, or reject with a mandatory reason.
- Approver / MD: independently review Procurement Manager-originated reconciliations, including rejection/correction; no Procurement self-approval.
- Finance: classifies post-approval funding as *Budget Only* or *Employee Advance*, records actual **Finance-confirmed** amount released and disbursement reference, verifies incoming refunds and rejects unverifiable transfer proof.
- Admin / Auditor: read-only historical oversight through the register.

## Status sequence
1. Draft → Submitted → (Returned for Correction → Submitted), Rejected, or Funding Verification Pending.
2. Funding Verification Pending → Savings Recorded (no employee advance) / Completed (advance fully accounted for) / Refund Pending.
3. Refund Pending → Refund Submitted → Completed, Partially Refunded, or Refund Pending, depending on verified transfers.

A rejected refund submission does **not** count as money received. Partially verified refunds retain the outstanding difference. An employee cannot submit more than the remaining balance, including already-submitted transfers.

## Financial rules
- Original approved request and its item prices are immutable historical snapshots in the reconciliation.
- Actual cost = SUM(actual quantity × actual unit price) rounded to naira/kobo precision.
- Budget difference = original approved amount − actual expense total.
- Verified refund due = Finance-confirmed employee advance − actual expenditure − bank-verified refunds.
- Savings require no cash refund **unless an employee advance is confirmed by Finance**. Vendor payments are not employee advances.
- Expense totals above approved requests cannot be submitted through this ordinary workflow; they require separate exception authorization.
- Reported expenses require at least one purchase receipt file before submission.
- Refunds require a bank transfer date, reference, amount, and separate proof; Finance must explicitly verify arrival in the company account.
- Supporting files are PDF/JPEG/PNG/WebP up to 2.5 MB. Stored as BYTEA with SHA-256 fingerprint. Access is authenticated and role/record-scoped.
- One reconciliation per purchase request to prevent duplicated reporting. Corrections reuse the same record and preserve the workflow event history.

## Data and controls
Migration: `migrations/postgresql/011_expense_reconciliation.sql`.

Adds only:
- `expense_reconciliations`
- `expense_reconciliation_items`
- `expense_reconciliation_refunds`
- `expense_reconciliation_evidence`
- `expense_reconciliation_events`

Each server-side write verifies the audit signing key, ownership/role, status transition, and amount constraints. Actions append to the reconciliation event log, ProcureFlow workflow history, activity log, and signed audit stream. Notifications take the user to the dedicated **Expense Reconciliation** navigation item.

## Operating checklist
1. Employee selects their own approved request and creates a draft.
2. Employee enters actual quantities/prices and saves.
3. Employee attaches genuine purchase receipt(s), then submits.
4. Procurement (or Approver for a Procurement-originated report) verifies independently.
5. Finance checks evidence of actual funds disbursed and classifies the funding.
6. If employee money was advanced, employee returns the unused balance to the verified company bank account and uploads transfer evidence.
7. Finance checks bank transactions before confirming each refund.
8. Admin/Auditor can trace original budget, actual expenditure, approved reconciliation, disbursement classification, verified cash returns, outstanding funds and approvals.

## Limitations
This module does not automatically import a bank feed or prove money was received based solely on employee-uploaded evidence. Finance must compare transactions with bank records. It also does not rewrite the existing purchase request's approval status, previously recorded vendor payments, or cash-advance ledger entries. Those records remain separate audit evidence.
