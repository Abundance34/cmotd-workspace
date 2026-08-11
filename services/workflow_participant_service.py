"""Resolve users who participated in a procurement workflow."""
from __future__ import annotations

from core.db import run_query


def request_participant_user_ids(request_id: int, *, include_role_owners: bool = True) -> list[int]:
    ids: set[int] = set()
    rows = run_query(
        "SELECT requested_by, facility_manager_user_id, assigned_procurement_manager_id, approved_by_user_id, completed_by_user_id, archived_by_user_id FROM purchase_requests WHERE id=?",
        (int(request_id),), fetch=True,
    )
    if rows:
        for value in dict(rows[0]).values():
            try:
                if value:
                    ids.add(int(value))
            except (TypeError, ValueError):
                pass
    for table, column in [
        ("approval_history", "approved_by_user_id"),
        ("approval_history", "user_id"),
        ("payments", "created_by"),
        ("payments", "paid_by"),
        ("receipt_records", "uploaded_by"),
    ]:
        try:
            if table == "approval_history":
                query = f"SELECT {column} user_id FROM {table} WHERE entity_type='Purchase Request' AND entity_id=?"
            elif table == "payments":
                query = f"SELECT {column} user_id FROM {table} WHERE request_id=?"
            else:
                query = f"SELECT {column} user_id FROM {table} WHERE request_id=?"
            for row in run_query(query, (int(request_id),), fetch=True):
                if row["user_id"]:
                    ids.add(int(row["user_id"]))
        except Exception:
            continue
    try:
        for row in run_query(
            """
            SELECT DISTINCT ad.delegate_user_id user_id
            FROM approval_delegations ad
            JOIN approval_history ah ON ah.approved_by_user_id=ad.delegate_user_id
            WHERE ah.entity_type='Purchase Request' AND ah.entity_id=?
            """,
            (int(request_id),), fetch=True,
        ):
            if row["user_id"]:
                ids.add(int(row["user_id"]))
    except Exception:
        pass
    if include_role_owners:
        for row in run_query(
            "SELECT id FROM users WHERE is_active=1 AND role IN ('Admin','Finance','Approver','Procurement Manager')",
            fetch=True,
        ):
            ids.add(int(row["id"]))
    return sorted(ids)
