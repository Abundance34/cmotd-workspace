# Final Docker and Browser Acceptance

Use this checklist once after replacing the application source with the final stabilized build. Do not rerun the SQLite data migration when keeping the existing PostgreSQL volume.

## 1. Start and verify the backend

```powershell
docker compose build procureflow
docker compose up -d --force-recreate procureflow
docker compose ps
docker compose exec procureflow python scripts/verify_postgres_runtime.py --report data/backups/postgres_runtime_verification.json
```

Expected: both containers are healthy and the runtime verification status is `passed`.

## 2. Clear the log baseline

Record the current time, then open `http://localhost:8501` and perform the role checks below. Afterwards run:

```powershell
docker compose logs --since 30m procureflow | Select-String -Pattern "Traceback|psycopg.errors|TypeError|ValueError|UndefinedFunction|UndefinedColumn|SyntaxError"
```

Expected: no new unhandled error output.

## 3. Role/page smoke matrix

### Admin

- Admin Dashboard
- Budget Tracker
- Income, including Excel download
- User Management
- Roles & Permissions
- Approval Configuration
- Import Center
- All Procurement Records
- Notifications Monitor
- Availability & Delegation Requests
- Gateway Pass Management
- Activity & History Logs
- Audit Logs
- Database Viewer

### Procurement Manager

- Dashboard
- Create Request
- View Requests
- Guided Next Actions
- Request Register
- Imported Draft Review
- Vendor sourcing and distinct quote prices
- Selected vendor/payee details
- Post-Payment Closure with only **Mark Completed**

### Facility/Utility Head

- Create and submit request
- View own request status/history
- Gateway pass creation and submission
- Availability/away notice

### Approver/Managing Director

- Pending approval view
- Vendor comparison with correct vendor totals
- Approve a test request
- Rescind an unpaid approval with a mandatory reason
- Confirm paid requests cannot use the standard rescind action

### Finance

- Approved payment queue
- Structured Payee & Bank Details card
- Exact transfer-type choices
- Payment instruction print/PDF
- Payment recording
- Proof of Payment upload
- Vendor Receipt upload
- OCR review/correction/retry
- Payment/receipt registers and exports

### Logistics Officer

- Fulfilment/receiving views
- Delivery and movement records
- Exceptions and proof-of-delivery workflows
- Confirm no approval or payment authority is exposed

### Auditor

- Audit dashboard
- Approval/payment/receipt/payee histories
- Masked exports
- Controlled payee reveal where authorised
- Gateway pass and delegation evidence

## 4. Theme and readability

- The application remains light mode even when Windows or Chrome is dark.
- Sidebar inactive and active text is readable.
- Forms, tables, expanders, disabled controls, status badges, and JSON/structured detail cards are readable.
- No white-on-white or dark-on-dark text is present.

## 5. Completion

Archive the generated files:

- `data/backups/postgres_runtime_verification.json`
- migration verification report already generated during cutover;
- a clean application log excerpt; and
- the signed/dated copy of this checklist.
