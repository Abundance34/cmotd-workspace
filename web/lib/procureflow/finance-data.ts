import { db } from "@/lib/db";
import { decryptPayeeValueV2 } from "./payee-crypto";

export type FinanceReadyRow = {
  id: number;
  requestNo: string;
  departmentProject: string | null;
  category: string | null;
  amount: number;
  status: string | null;
  paymentStatus: string | null;
  nextRole: string | null;
  approvedBy: string | null;
  approvalDate: string | null;
  selectedVendorId: number | null;
  vendorName: string | null;
  selectedQuoteId: number | null;
  payeeId: number | null;
  payeeType: string | null;
  payeeNameMasked: string | null;
  accountNameMasked: string | null;
  bankNameMasked: string | null;
  accountNumberLast4: string | null;
  currency: string;
  verificationStatus: string | null;
  paymentReadinessStatus: string | null;
  payeeV2Readable: boolean;
  payeeMigrationState: "v2-ready" | "legacy-reentry-required" | "missing";
};

export type FinancePaymentRow = {
  id: number;
  paymentNo: string;
  requestId: number | null;
  requestNo: string | null;
  poNo: string | null;
  vendorName: string | null;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  transferType: string | null;
  paymentReference: string | null;
  paymentDate: string | null;
  status: string | null;
  verificationStatus: string | null;
  financeNote: string | null;
  paidByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  receiptId: number | null;
};

export type FinanceReceiptRow = {
  id: number;
  receiptNo: string;
  receiptType: string | null;
  paymentMethod: string | null;
  paymentDate: string | null;
  vendorName: string | null;
  payerName: string | null;
  payeeName: string | null;
  amount: number;
  taxAmount: number;
  currency: string;
  purpose: string | null;
  departmentProject: string | null;
  linkedPaymentId: number | null;
  linkedPaymentNo: string | null;
  requestId: number | null;
  requestNo: string | null;
  transferReference: string | null;
  status: string | null;
  duplicateWarning: boolean;
  discrepancyStatus: string | null;
  originalFileName: string | null;
  ocrStatus: string | null;
  createdAt: string | null;
};

export type FinanceBudgetRow = {
  id: number;
  budgetMonth: string;
  category: string | null;
  departmentProject: string | null;
  limitAmount: number;
  overrideRequired: boolean;
};

export type FinanceDashboardData = {
  metrics: {
    awaitingPayment: number;
    pendingReceipt: number;
    totalPaid: number;
    completed: number;
  };
  readyForPayment: FinanceReadyRow[];
  payments: FinancePaymentRow[];
  receipts: FinanceReceiptRow[];
  budgets: FinanceBudgetRow[];
  receiptTotalsByMethod: { paymentMethod: string; total: number }[];
};

type RawReady = {
  id: number;
  request_no: string;
  department_project: string | null;
  category: string | null;
  estimated_amount: string | number | null;
  status: string | null;
  payment_status: string | null;
  next_role: string | null;
  approved_by: string | null;
  approval_date: Date | string | null;
  selected_vendor_id: number | null;
  vendor_name: string | null;
  selected_vendor_quote_id: number | null;
  payee_id: number | null;
  payee_type: string | null;
  payee_name_masked: string | null;
  account_name_masked: string | null;
  bank_name_masked: string | null;
  account_number_last4: string | null;
  currency: string | null;
  verification_status: string | null;
  payment_readiness_status: string | null;
  payee_name_encrypted: string | null;
  account_name_encrypted: string | null;
  bank_name_encrypted: string | null;
  account_number_encrypted: string | null;
};

function dateValue(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function v2PayeeReadable(row: RawReady) {
  if (!row.payee_id) return false;
  const values = [
    row.payee_name_encrypted,
    row.account_name_encrypted,
    row.bank_name_encrypted,
    row.account_number_encrypted,
  ];
  if (values.some((value) => !value)) return false;
  try {
    for (const value of values) decryptPayeeValueV2(String(value));
    return true;
  } catch {
    return false;
  }
}

export async function getFinanceDashboardData(): Promise<FinanceDashboardData> {
  const sql = db();
  const [metrics, readyRows, paymentRows, receiptRows, budgetRows, receiptTotals] = await Promise.all([
    sql<{ awaiting_payment: number; pending_receipt: number; total_paid: number; completed: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM purchase_requests pr
          WHERE (pr.next_role='finance' OR pr.status IN ('Approved','Awaiting Payment','Approved for Payment') OR pr.payment_status='Approved for Payment')
            AND pr.status NOT IN ('Paid','Completed','Closed','Rejected')) AS awaiting_payment,
        (SELECT COUNT(*)::int FROM payments p WHERE p.status='Paid' AND p.receipt_id IS NULL) AS pending_receipt,
        (SELECT COUNT(*)::int FROM payments p WHERE p.status='Paid') AS total_paid,
        (SELECT COUNT(*)::int FROM purchase_requests pr WHERE pr.status IN ('Completed','Closed')) AS completed
    `,
    sql<RawReady[]>`
      SELECT
        pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,
        pr.status,pr.payment_status,pr.next_role,
        COALESCE(latest_approval.approved_by_role,pr.approved_by_role) AS approved_by,
        COALESCE(pr.approved_at,latest_approval.created_at) AS approval_date,
        pr.selected_vendor_id,v.name AS vendor_name,pr.selected_vendor_quote_id,
        ppd.id AS payee_id,ppd.payee_type,ppd.payee_name_masked,ppd.account_name_masked,
        ppd.bank_name_masked,ppd.account_number_last4,ppd.currency,
        ppd.verification_status,ppd.payment_readiness_status,
        ppd.payee_name_encrypted,ppd.account_name_encrypted,ppd.bank_name_encrypted,
        ppd.account_number_encrypted
      FROM purchase_requests pr
      LEFT JOIN vendors v ON v.id=pr.selected_vendor_id
      LEFT JOIN LATERAL (
        SELECT ah.approved_by_role,ah.created_at
        FROM approval_history ah
        WHERE ah.entity_type='Purchase Request' AND ah.entity_id=pr.id AND ah.status_after='Approved'
        ORDER BY ah.created_at DESC,ah.id DESC LIMIT 1
      ) latest_approval ON TRUE
      LEFT JOIN LATERAL (
        SELECT x.* FROM payment_payee_details x
        WHERE x.id=pr.selected_payee_detail_id
           OR (pr.selected_payee_detail_id IS NULL AND x.purchase_request_id=pr.id AND COALESCE(x.is_current,TRUE)=TRUE)
        ORDER BY CASE WHEN x.id=pr.selected_payee_detail_id THEN 0 ELSE 1 END,x.id DESC
        LIMIT 1
      ) ppd ON TRUE
      WHERE (pr.next_role='finance' OR pr.status IN ('Approved','Awaiting Payment','Approved for Payment') OR pr.payment_status='Approved for Payment')
        AND pr.status NOT IN ('Paid','Completed','Closed','Rejected')
      ORDER BY COALESCE(pr.approved_at,pr.updated_at,pr.created_at) DESC,pr.id DESC
      LIMIT 200
    `,
    sql<{
      id: number; payment_no: string; request_id: number | null; request_no: string | null;
      po_no: string | null; vendor_name: string | null; amount: string | number;
      currency: string | null; payment_method: string | null; transfer_type: string | null;
      payment_reference: string | null; payment_date: Date | string | null; status: string | null;
      verification_status: string | null; finance_note: string | null; paid_by_name: string | null;
      created_at: Date | string | null; updated_at: Date | string | null; receipt_id: number | null;
    }[]>`
      SELECT p.id,p.payment_no,p.request_id,pr.request_no,po.po_no,v.name AS vendor_name,
             p.amount,p.currency,p.payment_method,p.transfer_type,p.payment_reference,p.payment_date,
             p.status,p.verification_status,p.finance_note,paid.full_name AS paid_by_name,
             p.created_at,p.updated_at,p.receipt_id
      FROM payments p
      LEFT JOIN purchase_requests pr ON pr.id=p.request_id
      LEFT JOIN purchase_orders po ON po.id=p.po_id
      LEFT JOIN vendors v ON v.id=p.vendor_id
      LEFT JOIN users paid ON paid.id=p.paid_by
      ORDER BY COALESCE(p.updated_at,p.created_at) DESC,p.id DESC
      LIMIT 200
    `,
    sql<{
      id: number; receipt_no: string; receipt_type: string | null; payment_method: string | null;
      payment_date: Date | string | null; vendor_name: string | null; payer_name: string | null;
      payee_name: string | null; amount: string | number | null; tax_amount: string | number | null;
      currency: string | null; purpose: string | null; department_project: string | null;
      linked_payment_id: number | null; linked_payment_no: string | null; request_id: number | null;
      request_no: string | null; transfer_reference: string | null; status: string | null;
      duplicate_warning: boolean | null; discrepancy_status: string | null; original_file_name: string | null;
      ocr_status: string | null; created_at: Date | string | null;
    }[]>`
      SELECT rr.id,rr.receipt_no,rr.receipt_type,rr.payment_method,rr.payment_date,
             v.name AS vendor_name,rr.payer_name,rr.payee_name,rr.amount,rr.tax_amount,
             rr.currency,rr.purpose,rr.department_project,
             COALESCE(rr.linked_payment_id,rr.payment_id) AS linked_payment_id,
             p.payment_no AS linked_payment_no,rr.request_id,pr.request_no,
             rr.transfer_reference,rr.status,rr.duplicate_warning,rr.discrepancy_status,
             rr.original_file_name,rr.ocr_status,rr.created_at
      FROM receipt_records rr
      LEFT JOIN vendors v ON v.id=rr.vendor_id
      LEFT JOIN payments p ON p.id=COALESCE(rr.linked_payment_id,rr.payment_id)
      LEFT JOIN purchase_requests pr ON pr.id=rr.request_id
      ORDER BY rr.created_at DESC,rr.id DESC
      LIMIT 200
    `,
    sql<{
      id: number; budget_month: string; category: string | null; department_project: string | null;
      limit_amount: string | number; override_required: boolean | null;
    }[]>`
      SELECT id,budget_month,category,department_project,limit_amount,override_required
      FROM budgets ORDER BY budget_month DESC,id DESC LIMIT 200
    `,
    sql<{ payment_method: string | null; total: string | number | null }[]>`
      SELECT COALESCE(payment_method,'Unspecified') AS payment_method,COALESCE(SUM(amount),0) AS total
      FROM receipt_records GROUP BY COALESCE(payment_method,'Unspecified') ORDER BY total DESC
    `,
  ]);

  const metric = metrics[0] || { awaiting_payment: 0, pending_receipt: 0, total_paid: 0, completed: 0 };

  return {
    metrics: {
      awaitingPayment: Number(metric.awaiting_payment || 0),
      pendingReceipt: Number(metric.pending_receipt || 0),
      totalPaid: Number(metric.total_paid || 0),
      completed: Number(metric.completed || 0),
    },
    readyForPayment: readyRows.map((row) => {
      const readable = v2PayeeReadable(row);
      return {
        id: Number(row.id),
        requestNo: row.request_no,
        departmentProject: row.department_project,
        category: row.category,
        amount: Number(row.estimated_amount || 0),
        status: row.status,
        paymentStatus: row.payment_status,
        nextRole: row.next_role,
        approvedBy: row.approved_by,
        approvalDate: dateValue(row.approval_date),
        selectedVendorId: row.selected_vendor_id == null ? null : Number(row.selected_vendor_id),
        vendorName: row.vendor_name,
        selectedQuoteId: row.selected_vendor_quote_id == null ? null : Number(row.selected_vendor_quote_id),
        payeeId: row.payee_id == null ? null : Number(row.payee_id),
        payeeType: row.payee_type,
        payeeNameMasked: row.payee_name_masked,
        accountNameMasked: row.account_name_masked,
        bankNameMasked: row.bank_name_masked,
        accountNumberLast4: row.account_number_last4,
        currency: row.currency || "NGN",
        verificationStatus: row.verification_status,
        paymentReadinessStatus: row.payment_readiness_status,
        payeeV2Readable: readable,
        payeeMigrationState: !row.payee_id ? "missing" : readable ? "v2-ready" : "legacy-reentry-required",
      };
    }),
    payments: paymentRows.map((row) => ({
      id: Number(row.id),
      paymentNo: row.payment_no,
      requestId: row.request_id == null ? null : Number(row.request_id),
      requestNo: row.request_no,
      poNo: row.po_no,
      vendorName: row.vendor_name,
      amount: Number(row.amount || 0),
      currency: row.currency || "NGN",
      paymentMethod: row.payment_method,
      transferType: row.transfer_type,
      paymentReference: row.payment_reference,
      paymentDate: dateValue(row.payment_date),
      status: row.status,
      verificationStatus: row.verification_status,
      financeNote: row.finance_note,
      paidByName: row.paid_by_name,
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
      receiptId: row.receipt_id == null ? null : Number(row.receipt_id),
    })),
    receipts: receiptRows.map((row) => ({
      id: Number(row.id),
      receiptNo: row.receipt_no,
      receiptType: row.receipt_type,
      paymentMethod: row.payment_method,
      paymentDate: dateValue(row.payment_date),
      vendorName: row.vendor_name,
      payerName: row.payer_name,
      payeeName: row.payee_name,
      amount: Number(row.amount || 0),
      taxAmount: Number(row.tax_amount || 0),
      currency: row.currency || "NGN",
      purpose: row.purpose,
      departmentProject: row.department_project,
      linkedPaymentId: row.linked_payment_id == null ? null : Number(row.linked_payment_id),
      linkedPaymentNo: row.linked_payment_no,
      requestId: row.request_id == null ? null : Number(row.request_id),
      requestNo: row.request_no,
      transferReference: row.transfer_reference,
      status: row.status,
      duplicateWarning: Boolean(row.duplicate_warning),
      discrepancyStatus: row.discrepancy_status,
      originalFileName: row.original_file_name,
      ocrStatus: row.ocr_status,
      createdAt: dateValue(row.created_at),
    })),
    budgets: budgetRows.map((row) => ({
      id: Number(row.id),
      budgetMonth: row.budget_month,
      category: row.category,
      departmentProject: row.department_project,
      limitAmount: Number(row.limit_amount || 0),
      overrideRequired: Boolean(row.override_required),
    })),
    receiptTotalsByMethod: receiptTotals.map((row) => ({
      paymentMethod: row.payment_method || "Unspecified",
      total: Number(row.total || 0),
    })),
  };
}
