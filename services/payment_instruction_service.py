"""Approved payment instruction data, print layout, and PDF generation."""
from __future__ import annotations

import io
import os
import base64
import mimetypes
import re
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any

from core.db import log_audit, make_ref, now_iso, run_query
from services.payee_service import get_full_payee_details

AUTHORIZED_ROLES = {"Finance", "Admin"}
TRANSFER_TYPES = ("Internet Bank Transfer", "Physical Bank Transfer")


class PaymentInstructionError(RuntimeError):
    pass


def _clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _format_quantity(value: Any) -> str:
    try:
        quantity = float(value or 0)
    except (TypeError, ValueError):
        return _clean(value) or "1"
    if quantity.is_integer():
        return str(int(quantity))
    return f"{quantity:g}"


def _format_instruction_date(value: Any, *, include_time: bool = False) -> str:
    """Return a compact human-readable date without changing stored values."""
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = _clean(value)
        if not raw:
            return "—"
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw
    return parsed.strftime("%Y-%m-%d %H:%M:%S" if include_time else "%Y-%m-%d")


def _normalise_business_purpose(value: Any) -> str:
    purpose = " ".join(_clean(value).split())
    if not purpose:
        return ""
    lowered = purpose.lower()
    for prefix in ("we would need ", "we need ", "we require ", "request for "):
        if lowered.startswith(prefix):
            purpose = purpose[len(prefix):].strip()
            break
    purpose = purpose.replace("staffs", "staff")
    purpose = purpose.replace("Staffs", "Staff")
    purpose = re.sub(r"\bclock[ -]?in device\b", "clock-in device", purpose, flags=re.IGNORECASE)
    if purpose.lower().endswith("for staff"):
        purpose += " use"
    purpose = purpose.rstrip(" .")
    return purpose[:1].upper() + purpose[1:] if purpose else ""


def _build_purchase_summary(items: list[dict[str, Any]], justification: Any) -> str:
    """Build a concise payment description from approved request line items."""
    item_phrases: list[str] = []
    for item in items:
        name = _clean(item.get("item_name") or item.get("description"))
        if not name:
            continue
        item_phrases.append(f"{_format_quantity(item.get('quantity') or 1)} × {name}")

    if not item_phrases:
        purpose = _normalise_business_purpose(justification)
        return f"Payment for {purpose.rstrip('.')}." if purpose else "Approved procurement payment."

    if len(item_phrases) == 1:
        purpose = _normalise_business_purpose(justification)
        # When the request justification is already a clean noun phrase, use
        # it as the plain-English description instead of repeating a product
        # label and a second purpose sentence.
        lowered_purpose = purpose.lower()
        for prefix in ("a new ", "an new ", "a ", "an "):
            if lowered_purpose.startswith(prefix):
                noun_phrase = purpose[len(prefix):].strip()
                if noun_phrase:
                    quantity = _format_quantity(items[0].get("quantity") or 1)
                    return f"Payment for the purchase of {quantity} {noun_phrase}."
        purchase_text = item_phrases[0]
    elif len(item_phrases) <= 3:
        purchase_text = ", ".join(item_phrases[:-1]) + f" and {item_phrases[-1]}"
    else:
        purchase_text = ", ".join(item_phrases[:3]) + f" and {len(item_phrases) - 3} additional approved line item(s)"

    purpose = _normalise_business_purpose(justification)
    summary = f"Payment for the purchase of {purchase_text}."
    if purpose:
        summary += f" Purpose: {purpose}."
    return summary


def _logo_path() -> str | None:
    configured = os.environ.get("PROCUREFLOW_ORGANISATION_LOGO", "").strip()
    candidates = [configured] if configured else []
    candidates += [
        "static/assets/cmotd_logo.png",
        "static/logo.png",
        "assets/logo.png",
        "data/logo.png",
        "static/cmotd_logo.png",
        "assets/cmotd_logo.png",
    ]
    for value in candidates:
        if value and Path(value).is_file():
            return str(Path(value))
    return None


def resolve_payment_instruction(*, actor_user_id: int, actor_role: str, request_id: int | None = None, payment_id: int | None = None) -> dict[str, Any]:
    if actor_role not in AUTHORIZED_ROLES:
        raise PermissionError("Only Finance and Admin users may generate payment instructions.")
    if not request_id and not payment_id:
        raise PaymentInstructionError("A request or payment reference is required.")
    if payment_id:
        payments = run_query("SELECT * FROM payments WHERE id=?", (int(payment_id),), fetch=True)
    else:
        payments = run_query("SELECT * FROM payments WHERE request_id=? ORDER BY id DESC LIMIT 1", (int(request_id),), fetch=True)
    payment = dict(payments[0]) if payments else {}
    resolved_request_id = int(request_id or payment.get("request_id") or 0)
    if not resolved_request_id:
        raise PaymentInstructionError("The payment is not linked to a procurement request.")
    rows = run_query(
        """
        SELECT pr.*, u.full_name requester_name,
               v.name selected_vendor_name, v.email selected_vendor_email, v.phone selected_vendor_phone,
               vq.quotation_total selected_quote_total, vq.currency selected_quote_currency,
               po.po_no, po.total_amount po_total
        FROM purchase_requests pr
        LEFT JOIN users u ON u.id=pr.requested_by
        LEFT JOIN vendors v ON v.id=pr.selected_vendor_id
        LEFT JOIN vendor_quotes vq ON vq.id=pr.selected_vendor_quote_id
        LEFT JOIN purchase_orders po ON po.id=pr.linked_po_id
        WHERE pr.id=?
        """,
        (resolved_request_id,), fetch=True,
    )
    if not rows:
        raise PaymentInstructionError("Procurement request was not found.")
    request = dict(rows[0])
    request_items = [
        dict(row)
        for row in run_query(
            "SELECT item_name, description, quantity FROM purchase_request_items WHERE request_id=? ORDER BY id",
            (resolved_request_id,),
            fetch=True,
        )
    ]
    purchase_summary = _build_purchase_summary(request_items, request.get("justification") or request.get("category"))
    payee_id = payment.get("payee_detail_id") or request.get("selected_payee_detail_id")
    if not payee_id:
        payees = run_query(
            "SELECT id FROM payment_payee_details WHERE purchase_request_id=? AND COALESCE(is_current,1)=1 ORDER BY id DESC LIMIT 1",
            (resolved_request_id,), fetch=True,
        )
        payee_id = payees[0]["id"] if payees else None
    payee = get_full_payee_details(int(payee_id)) if payee_id else None
    approvals = run_query(
        """SELECT ah.*, u.full_name approver_name FROM approval_history ah
           LEFT JOIN users u ON u.id=COALESCE(ah.approved_by_user_id, ah.user_id)
           WHERE ah.entity_type='Purchase Request' AND ah.entity_id=? AND ah.status_after='Approved'
           ORDER BY ah.created_at DESC, ah.id DESC LIMIT 1""",
        (resolved_request_id,), fetch=True,
    )
    approval = dict(approvals[0]) if approvals else {}
    selected_vendor_id = request.get("selected_vendor_id")
    warnings: list[str] = []
    if not payee:
        warnings.append("No approved payee is linked to this request.")
    else:
        if str(payee.get("verification_status") or "") != "Finance Verified":
            warnings.append("Payee verification is pending.")
        if selected_vendor_id and payee.get("vendor_id") and int(selected_vendor_id) != int(payee.get("vendor_id")):
            warnings.append("The selected vendor differs from the linked payee.")
        if payee.get("replaced_at"):
            warnings.append("Payee information was replaced after initial entry; review the audit history.")
    transfer_type = _clean(payment.get("transfer_type"))
    if transfer_type and transfer_type not in TRANSFER_TYPES:
        warnings.append("The transfer type is a legacy value and should be updated before payment.")
    amount = payment.get("amount") or request.get("selected_quote_total") or request.get("po_total") or request.get("estimated_amount") or 0
    currency = _clean(payment.get("currency") or (payee or {}).get("currency") or request.get("selected_quote_currency") or "NGN")
    generated_at = datetime.now(timezone.utc).isoformat()
    reconciliation_reference = _clean(payment.get("payment_reference") or payment.get("payment_no") or request.get("request_no") or make_ref("PAYREF"))
    instruction = {
        "organisation_name": os.environ.get("PROCUREFLOW_ORGANISATION_NAME", "Center for Marine and Offshore Technology Development"),
        "document_title": "Approved Payment Instruction",
        "request_id": resolved_request_id,
        "request_reference": _clean(request.get("request_no")),
        "purchase_order_reference": _clean(request.get("po_no")),
        "department_project": _clean(request.get("department_project")),
        "request_description": _clean(request.get("justification") or request.get("category")),
        "purchase_summary": purchase_summary,
        "approved_vendor_payee": _clean((payee or {}).get("payee_name") or request.get("selected_vendor_name")),
        "account_name": _clean((payee or {}).get("account_name")),
        "bank_name": _clean((payee or {}).get("bank_name")),
        "account_number": _clean((payee or {}).get("account_number")),
        "currency": currency,
        "approved_amount": float(amount or 0),
        "payment_method": _clean(payment.get("payment_method") or "Bank Transfer"),
        "transfer_type": transfer_type,
        "approval_status": _clean(request.get("status")),
        "approver": _clean(approval.get("approver_name") or approval.get("approved_by_role") or request.get("approved_by_role")),
        "approval_date": _clean(approval.get("created_at") or request.get("approved_at")),
        "finance_verification_status": _clean((payee or {}).get("verification_status") or payment.get("verification_status")),
        "date_generated": generated_at,
        "generated_by_user_id": int(actor_user_id),
        "generated_by_role": actor_role,
        "payment_reference": reconciliation_reference,
        "payment_id": payment.get("id"),
        "payee_detail_id": int(payee_id) if payee_id else None,
        "warnings": warnings,
        "confidentiality_notice": "CONFIDENTIAL: This document contains payment information and is intended only for authorised processing and reconciliation.",
        "logo_path": _logo_path(),
    }
    log_audit(
        "PAYMENT_INSTRUCTION_VIEWED", "Purchase Request", resolved_request_id,
        {"payment_id": payment.get("id"), "payee_detail_id": payee_id, "warnings": warnings},
        actor_user_id, actor_role,
    )
    return instruction


def payment_instruction_html(data: dict[str, Any], generated_by_name: str) -> str:
    """Render a concise, print-ready payment instruction card.

    The underlying instruction dictionary remains complete for auditing and
    reconciliation; this presentation intentionally shows only the fields
    Finance needs to make the approved payment.
    """
    del generated_by_name  # Retained in the public signature for compatibility.

    currency = escape(_clean(data.get("currency") or "NGN"))
    amount = f"{currency} {float(data.get('approved_amount') or 0):,.2f}"
    reference = escape(_clean(data.get("request_reference")) or "—")
    generated_date = escape(_format_instruction_date(data.get("date_generated")))
    approval_date = escape(_format_instruction_date(data.get("approval_date"), include_time=True))
    summary = escape(_clean(data.get("purchase_summary") or data.get("request_description")) or "Approved procurement payment.")

    detail_rows = [
        ("Vendor / Payee", data.get("approved_vendor_payee")),
        ("Account Name", data.get("account_name")),
        ("Bank Name", data.get("bank_name")),
        ("Account Number", data.get("account_number")),
        ("Currency", data.get("currency")),
        ("Payment Method", data.get("payment_method") or "Bank Transfer"),
    ]
    detail_html = "".join(
        "<div class='pi-detail'>"
        f"<span class='pi-detail-label'>{escape(label)}</span>"
        f"<strong class='pi-detail-value'>{escape(_clean(value) or '—')}</strong>"
        "</div>"
        for label, value in detail_rows
    )

    logo_html = ""
    logo_path = Path(str(data.get("logo_path") or ""))
    if logo_path.is_file():
        try:
            mime = mimetypes.guess_type(logo_path.name)[0] or "image/png"
            encoded = base64.b64encode(logo_path.read_bytes()).decode("ascii")
            logo_html = f"<img class='pi-logo' src='data:{mime};base64,{encoded}' alt='Organisation logo'>"
        except OSError:
            logo_html = ""

    return f"""
    <style>
      .payment-instruction {{
        max-width: 980px; margin: 10px auto 22px; padding: 30px;
        color: #172033; background: #ffffff; border: 1px solid #dbe3ee;
        border-radius: 18px; box-shadow: 0 12px 34px rgba(16,36,66,.09);
        box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }}
      .pi-document-header {{
        display: flex; align-items: center; justify-content: space-between; gap: 22px;
        padding-bottom: 22px; margin-bottom: 22px; border-bottom: 1px solid #e4eaf2;
      }}
      .pi-brand {{ display: flex; align-items: center; gap: 14px; min-width: 0; }}
      .pi-logo {{ width: 58px; height: 58px; object-fit: contain; padding: 5px; border: 1px solid #e4eaf2; border-radius: 12px; background: #fff; }}
      .pi-organisation {{ color: #66758c; font-size: .78rem; font-weight: 750; line-height: 1.35; max-width: 310px; }}
      .pi-title-wrap {{ text-align: right; }}
      .pi-title-wrap h2 {{ margin: 0 0 8px !important; color: #10203a !important; font-size: clamp(1.45rem, 2.6vw, 2rem) !important; line-height: 1.12 !important; }}
      .pi-meta {{ display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }}
      .pi-meta span {{ padding: 6px 9px; color: #38506e; background: #f3f7fd; border: 1px solid #dce6f3; border-radius: 999px; font-size: .76rem; font-weight: 700; }}
      .pi-section {{ margin-top: 18px; padding: 20px; border: 1px solid #dbe3ee; border-radius: 14px; background: #fbfcff; }}
      .pi-section-title {{ margin: 0 0 14px; color: #164f9e; font-size: .82rem; font-weight: 850; letter-spacing: .045em; text-transform: uppercase; }}
      .pi-description {{ margin: 0 0 16px; padding: 14px 16px; color: #24354b; background: #ffffff; border-left: 4px solid #1769e8; border-radius: 10px; line-height: 1.58; }}
      .pi-summary-grid {{ display: grid; grid-template-columns: minmax(0,1fr) minmax(220px,.55fr); gap: 12px; }}
      .pi-summary-item {{ padding: 13px 15px; background: #ffffff; border: 1px solid #e1e8f1; border-radius: 10px; }}
      .pi-summary-label, .pi-detail-label {{ display: block; margin-bottom: 5px; color: #6b7890; font-size: .74rem; font-weight: 750; }}
      .pi-summary-value {{ display: block; color: #172033; font-size: .98rem; font-weight: 800; overflow-wrap: anywhere; }}
      .pi-amount {{ color: #0d58bd; font-size: 1.2rem; }}
      .pi-details-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }}
      .pi-detail {{ min-height: 72px; padding: 13px 15px; background: #ffffff; border: 1px solid #dce5f0; border-radius: 10px; box-sizing: border-box; }}
      .pi-detail-value {{ display: block; color: #172033; font-size: .96rem; line-height: 1.35; overflow-wrap: anywhere; }}
      .pi-approval {{ display: flex; justify-content: space-between; gap: 18px; margin-top: 20px; padding: 15px 17px; color: #33445b; background: #eef5ff; border: 1px solid #cfe0fa; border-radius: 12px; font-size: .84rem; }}
      .pi-approval strong {{ color: #12233d; }}
      @media (max-width: 720px) {{
        .payment-instruction {{ padding: 20px; }}
        .pi-document-header {{ align-items: flex-start; flex-direction: column; }}
        .pi-title-wrap {{ text-align: left; }}
        .pi-meta {{ justify-content: flex-start; }}
        .pi-summary-grid, .pi-details-grid {{ grid-template-columns: 1fr; }}
        .pi-approval {{ flex-direction: column; gap: 7px; }}
      }}
      @media print {{
        body * {{ visibility: hidden !important; }}
        #payment-instruction-print, #payment-instruction-print * {{ visibility: visible !important; }}
        #payment-instruction-print {{ position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; margin: 0; padding: 18mm; border: 0; box-shadow: none; }}
      }}
    </style>
    <section id="payment-instruction-print" class="payment-instruction">
      <header class="pi-document-header">
        <div class="pi-brand">{logo_html}<div class="pi-organisation">{escape(_clean(data.get('organisation_name')))}</div></div>
        <div class="pi-title-wrap">
          <h2>{escape(_clean(data.get('document_title')))}</h2>
          <div class="pi-meta"><span>Reference: {reference}</span><span>Date: {generated_date}</span></div>
        </div>
      </header>

      <section class="pi-section">
        <h3 class="pi-section-title">Payment Summary</h3>
        <p class="pi-description">{summary}</p>
        <div class="pi-summary-grid">
          <div class="pi-summary-item"><span class="pi-summary-label">Department / Project</span><strong class="pi-summary-value">{escape(_clean(data.get('department_project')) or '—')}</strong></div>
          <div class="pi-summary-item"><span class="pi-summary-label">Approved Amount</span><strong class="pi-summary-value pi-amount">{amount}</strong></div>
        </div>
      </section>

      <section class="pi-section">
        <h3 class="pi-section-title">Vendor Account Details</h3>
        <div class="pi-details-grid">{detail_html}</div>
      </section>

      <footer class="pi-approval">
        <span><strong>Approved By:</strong> {escape(_clean(data.get('approver')) or '—')}</span>
        <span><strong>Approval Date:</strong> {approval_date}</span>
      </footer>
    </section>
    """


def generate_payment_instruction_pdf(data: dict[str, Any], generated_by_name: str) -> bytes:
    """Generate the same concise payment instruction as a polished PDF."""
    del generated_by_name  # Retained in the public signature for compatibility.

    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=17 * mm, rightMargin=17 * mm,
        topMargin=14 * mm, bottomMargin=14 * mm,
        title=_clean(data.get("document_title")),
    )
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("PINormal", parent=styles["BodyText"], fontSize=9.2, leading=13, textColor=colors.HexColor("#24354B"))
    label = ParagraphStyle("PILabel", parent=normal, fontSize=7.5, leading=10, textColor=colors.HexColor("#6B7890"), spaceAfter=2)
    value = ParagraphStyle("PIValue", parent=normal, fontSize=10, leading=13, textColor=colors.HexColor("#172033"))
    title = ParagraphStyle("PITitle", parent=styles["Title"], alignment=TA_RIGHT, fontSize=18, leading=21, textColor=colors.HexColor("#10203A"), spaceAfter=5)
    meta = ParagraphStyle("PIMeta", parent=normal, alignment=TA_RIGHT, fontSize=8, textColor=colors.HexColor("#52647C"))
    section_title = ParagraphStyle("PISection", parent=normal, fontSize=8, leading=10, textColor=colors.HexColor("#164F9E"), spaceAfter=7)
    description_style = ParagraphStyle("PIDescription", parent=normal, fontSize=9.5, leading=14, leftIndent=3 * mm)
    approval_style = ParagraphStyle("PIApproval", parent=normal, fontSize=8.4, leading=11, textColor=colors.HexColor("#33445B"))

    story: list[Any] = []
    logo_cell: Any = ""
    logo = data.get("logo_path")
    if logo and Path(str(logo)).is_file():
        try:
            logo_cell = Image(str(logo), width=21 * mm, height=21 * mm)
        except Exception:
            logo_cell = ""
    brand = Table(
        [[logo_cell, Paragraph(escape(_clean(data.get("organisation_name"))), ParagraphStyle("PIOrg", parent=normal, fontSize=8.2, leading=11, textColor=colors.HexColor("#66758C"))) ]],
        colWidths=[25 * mm, 55 * mm],
    )
    brand.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    header_right = [
        Paragraph(escape(_clean(data.get("document_title"))), title),
        Paragraph(
            f"Reference: <b>{escape(_clean(data.get('request_reference')) or '—')}</b><br/>Date: <b>{escape(_format_instruction_date(data.get('date_generated')))}</b>",
            meta,
        ),
    ]
    header = Table([[brand, header_right]], colWidths=[82 * mm, 94 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.6, colors.HexColor("#DCE5F0")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story += [header, Spacer(1, 6 * mm)]

    def section_heading(text: str) -> Table:
        t = Table([[Paragraph(f"<b>{escape(text.upper())}</b>", section_title)]], colWidths=[176 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF5FF")),
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CFE0FA")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        return t

    story.append(section_heading("Payment Summary"))
    summary_box = Table(
        [[Paragraph(escape(_clean(data.get("purchase_summary") or data.get("request_description")) or "Approved procurement payment."), description_style)]],
        colWidths=[176 * mm],
    )
    summary_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#DCE5F0")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor("#1769E8")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story += [Spacer(1, 2 * mm), summary_box, Spacer(1, 2 * mm)]
    summary_data = [[
        [Paragraph("Department / Project", label), Paragraph(escape(_clean(data.get("department_project")) or "—"), value)],
        [Paragraph("Approved Amount", label), Paragraph(f"<b><font color='#0D58BD'>{escape(_clean(data.get('currency') or 'NGN'))} {float(data.get('approved_amount') or 0):,.2f}</font></b>", value)],
    ]]
    summary_table = Table(summary_data, colWidths=[87 * mm, 87 * mm])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FBFCFF")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#DCE5F0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E4EAF2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [summary_table, Spacer(1, 6 * mm), section_heading("Vendor Account Details"), Spacer(1, 2 * mm)]

    fields = [
        ("Vendor / Payee", data.get("approved_vendor_payee")),
        ("Account Name", data.get("account_name")),
        ("Bank Name", data.get("bank_name")),
        ("Account Number", data.get("account_number")),
        ("Currency", data.get("currency")),
        ("Payment Method", data.get("payment_method") or "Bank Transfer"),
    ]
    cells = [[Paragraph(field_label, label), Paragraph(escape(_clean(field_value) or "—"), value)] for field_label, field_value in fields]
    details_data = [[cells[0], cells[1]], [cells[2], cells[3]], [cells[4], cells[5]]]
    details_table = Table(details_data, colWidths=[87 * mm, 87 * mm])
    details_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.55, colors.HexColor("#DCE5F0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#E4EAF2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [details_table, Spacer(1, 6 * mm)]

    approval = Table(
        [[
            Paragraph(f"<b>Approved By:</b> {escape(_clean(data.get('approver')) or '—')}", approval_style),
            Paragraph(f"<b>Approval Date:</b> {escape(_format_instruction_date(data.get('approval_date'), include_time=True))}", approval_style),
        ]],
        colWidths=[88 * mm, 88 * mm],
    )
    approval.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF5FF")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CFE0FA")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.append(approval)

    doc.build(story)
    output = buffer.getvalue()
    log_audit(
        "PAYMENT_INSTRUCTION_PDF_GENERATED", "Purchase Request", data.get("request_id"),
        {"payment_id": data.get("payment_id"), "payment_reference": data.get("payment_reference")},
        data.get("generated_by_user_id"), data.get("generated_by_role") or "Finance/Admin",
    )
    return output

