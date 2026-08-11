"""Vendor-specific quote persistence and selection commands."""
from __future__ import annotations

from datetime import date
from typing import Any

from core.db import _append_audit_event_to_conn, get_conn, insert_and_get_id, make_ref, now_iso


class VendorQuoteError(ValueError):
    pass


def _amount(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def save_vendor_quote(
    request_id: int,
    vendor: dict[str, Any],
    actor_user_id: int,
    actor_role: str,
    *,
    line_items: list[dict[str, Any]] | None = None,
) -> int:
    name = str(vendor.get("name") or "").strip()
    if not name:
        raise VendorQuoteError("Vendor name is required.")
    quoted = _amount(vendor.get("quoted_price") or vendor.get("quotation_total"))
    currency = str(vendor.get("currency") or "NGN").strip().upper()
    quote_date = str(vendor.get("quote_date") or date.today().isoformat())
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT id FROM vendors WHERE lower(name)=lower(?) ORDER BY id LIMIT 1", (name,)).fetchone()
        if row:
            vendor_id = int(row["id"])
            conn.execute(
                """UPDATE vendors SET category=COALESCE(NULLIF(?,''),category), phone=COALESCE(NULLIF(?,''),phone),
                   email=COALESCE(NULLIF(?,''),email), address=COALESCE(NULLIF(?,''),address), rating=?, updated_at=? WHERE id=?""",
                (str(vendor.get("category") or ""), str(vendor.get("phone") or ""), str(vendor.get("email") or ""),
                 str(vendor.get("address") or ""), int(vendor.get("rating") or 3), now_iso(), vendor_id),
            )
        else:
            vendor_id = insert_and_get_id(
                conn,
                """INSERT INTO vendors (name, category, phone, email, address, rating, status, documents_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'Active', '[]', ?, ?)""",
                (name, str(vendor.get("category") or "Other"), str(vendor.get("phone") or ""),
                 str(vendor.get("email") or ""), str(vendor.get("address") or ""), int(vendor.get("rating") or 3), now_iso(), now_iso()),
            )
        sourcing = conn.execute(
            "SELECT id FROM sourcing_tasks WHERE request_id=? ORDER BY id DESC LIMIT 1",
            (int(request_id),),
        ).fetchone()
        if sourcing:
            sourcing_task_id = int(sourcing["id"])
        else:
            request_row = conn.execute(
                "SELECT justification, assigned_procurement_manager_id FROM purchase_requests WHERE id=?",
                (int(request_id),),
            ).fetchone()
            if not request_row:
                raise VendorQuoteError("Purchase request was not found.")
            sourcing_task_id = insert_and_get_id(
                conn,
                """INSERT INTO sourcing_tasks (sourcing_no, request_id, required_item_service, assigned_to, status, approval_status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'Quote Collection', 'Pending', ?, ?)""",
                (make_ref("SRC"), int(request_id), str(request_row["justification"] or name), request_row["assigned_procurement_manager_id"] or actor_user_id, now_iso(), now_iso()),
            )
            conn.execute("UPDATE purchase_requests SET linked_sourcing_task_id=?, updated_at=? WHERE id=?", (sourcing_task_id, now_iso(), int(request_id)))
        existing = conn.execute(
            "SELECT id FROM vendor_quotes WHERE request_id=? AND vendor_id=? ORDER BY id DESC LIMIT 1",
            (int(request_id), vendor_id),
        ).fetchone()
        values = (
            name, quoted, quoted, currency, quote_date,
            str(vendor.get("quote_document_path") or "") or None,
            str(vendor.get("quote_document_hash") or "") or None,
            str(vendor.get("notes") or ""), str(vendor.get("supply_description") or vendor.get("notes") or ""),
            int(vendor.get("rating") or 3), now_iso(),
        )
        if existing:
            quote_id = int(existing["id"])
            conn.execute(
                """UPDATE vendor_quotes SET vendor_name=?, quoted_amount=?, quotation_total=?, currency=?, quote_date=?,
                   quote_document_path=?, quote_document_hash=?, notes=?, supply_description=?, vendor_rating=?, updated_at=? WHERE id=?""",
                values + (quote_id,),
            )
            conn.execute("DELETE FROM vendor_quote_items WHERE vendor_quote_id=?", (quote_id,))
        else:
            quote_id = insert_and_get_id(
                conn,
                """INSERT INTO vendor_quotes (sourcing_task_id, request_id, vendor_id, vendor_name, quoted_amount, quotation_total, currency,
                   quote_date, quote_document_path, quote_document_hash, notes, supply_description, vendor_rating,
                   is_selected, is_recommended, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)""",
                (sourcing_task_id, int(request_id), vendor_id, name, quoted, quoted, currency, quote_date,
                 str(vendor.get("quote_document_path") or "") or None, str(vendor.get("quote_document_hash") or "") or None,
                 str(vendor.get("notes") or ""), str(vendor.get("supply_description") or vendor.get("notes") or ""),
                 int(vendor.get("rating") or 3), now_iso(), now_iso()),
            )
        calculated_total = 0.0
        for item in line_items or []:
            qty = _amount(item.get("quantity"))
            unit = _amount(item.get("unit_price"))
            total = _amount(item.get("line_total")) or round(qty * unit, 2)
            calculated_total += total
            conn.execute(
                """INSERT INTO vendor_quote_items (vendor_quote_id, request_item_id, item_description, quantity, unit_price, line_total, currency, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (quote_id, item.get("request_item_id"), str(item.get("item_description") or ""), qty, unit, total, currency, now_iso(), now_iso()),
            )
        if line_items and quoted <= 0:
            quoted = round(calculated_total, 2)
            conn.execute("UPDATE vendor_quotes SET quoted_amount=?, quotation_total=?, updated_at=? WHERE id=?", (quoted, quoted, now_iso(), quote_id))
        _append_audit_event_to_conn(
            conn, action="VENDOR_QUOTE_SAVED", entity_type="Vendor Quote", entity_id=quote_id,
            parent_entity_type="Purchase Request", parent_entity_id=int(request_id), user_id=actor_user_id,
            role=actor_role, details={"vendor_id": vendor_id, "currency": currency, "line_count": len(line_items or [])},
            before_values={}, after_values={"quoted_amount": quoted, "vendor_name": name}, source="vendor_quote_service",
        )
        conn.commit()
        return quote_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def select_vendor_quote(request_id: int, quote_id: int, actor_user_id: int, actor_role: str) -> dict[str, Any]:
    if actor_role not in {"Procurement Manager", "Approver", "Admin"}:
        raise PermissionError("This role cannot select an approved vendor.")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        quote = conn.execute("SELECT * FROM vendor_quotes WHERE id=? AND request_id=?", (int(quote_id), int(request_id))).fetchone()
        if not quote:
            raise VendorQuoteError("Vendor quote was not found for this request.")
        q = dict(quote)
        conn.execute("UPDATE vendor_quotes SET is_selected=0, selected_at=NULL, updated_at=? WHERE request_id=?", (now_iso(), int(request_id)))
        conn.execute("UPDATE vendor_quotes SET is_selected=1, selected_at=?, updated_at=? WHERE id=?", (now_iso(), now_iso(), int(quote_id)))
        payee = conn.execute(
            "SELECT id FROM payment_payee_details WHERE purchase_request_id=? AND (vendor_id=? OR vendor_id IS NULL) ORDER BY is_current DESC, id DESC LIMIT 1",
            (int(request_id), int(q["vendor_id"])),
        ).fetchone()
        payee_id = int(payee["id"]) if payee else None
        if payee_id:
            conn.execute("UPDATE payment_payee_details SET vendor_id=?, is_current=1, updated_at=? WHERE id=?", (int(q["vendor_id"]), now_iso(), payee_id))
        conn.execute(
            """UPDATE purchase_requests SET selected_vendor_id=?, selected_vendor_quote_id=?, selected_payee_detail_id=COALESCE(?, selected_payee_detail_id), updated_at=? WHERE id=?""",
            (int(q["vendor_id"]), int(quote_id), payee_id, now_iso(), int(request_id)),
        )
        _append_audit_event_to_conn(
            conn, action="VENDOR_QUOTE_SELECTED", entity_type="Purchase Request", entity_id=int(request_id),
            user_id=actor_user_id, role=actor_role,
            after_values={"selected_vendor_id": int(q["vendor_id"]), "selected_vendor_quote_id": int(quote_id), "approved_total": q.get("quotation_total") or q.get("quoted_amount")},
            source="vendor_quote_service",
        )
        conn.commit()
        return {"vendor_id": int(q["vendor_id"]), "quote_id": int(quote_id), "amount": q.get("quotation_total") or q.get("quoted_amount"), "payee_detail_id": payee_id}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
