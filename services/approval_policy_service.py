"""Database-backed ProcureFlow approval policy.

The Procurement Manager approval limit is controlled by Admin and stored in
the database. The application intentionally imposes NO maximum amount.
Only a valid positive monetary amount is required.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from core.db import (
    table_columns,
    df_query,
    log_audit,
    now_iso,
    run_query,
    table_exists,
    _append_audit_event_to_conn,
    get_conn,
    json_dump,
)
from core.db_backend import is_postgres


APPROVAL_LIMIT_POLICY_KEY = "procurement_manager_approval_limit"
DEFAULT_PROCUREMENT_MANAGER_APPROVAL_LIMIT = Decimal("2000000.00")

_SCHEMA_READY = False


def _require_admin(actor: dict[str, Any] | None) -> dict[str, Any]:
    if not actor:
        raise PermissionError(
            "An authenticated Admin is required."
        )

    if str(actor.get("role") or "") != "Admin":
        raise PermissionError(
            "Only Admin can change the approval limit."
        )

    if not actor.get("id"):
        raise PermissionError(
            "Admin user ID is missing."
        )

    return actor


def _require_reason(reason: str | None) -> str:
    clean = " ".join(
        str(reason or "").strip().split()
    )

    if len(clean) < 5:
        raise ValueError(
            "A meaningful reason is required "
            "to change the approval limit."
        )

    return clean



def parse_approval_limit(value: Any) -> Decimal:
    """Return a valid positive approval limit.

    ProcureFlow deliberately imposes no application-defined
    maximum approval amount.

    Accepted examples include:
        2000000
        2,000,000
        Naira-symbol-prefixed values
        extremely large positive Decimal values
    """

    if isinstance(value, Decimal):
        amount = value
    else:
        text = str(value or "").strip()

        # Use Unicode escapes rather than source-file literal symbols
        # so Windows/PowerShell encoding cannot alter this policy parser.
        text = (
            text
            .replace("\u20a6", "")
            .replace("\u00e2\u201a\u00a6", "")
            .replace(",", "")
            .replace(" ", "")
        )

        if not text:
            raise ValueError(
                "Enter a valid approval limit."
            )

        try:
            amount = Decimal(text)
        except (InvalidOperation, ValueError):
            raise ValueError(
                "Enter a valid positive monetary amount."
            )

    if not amount.is_finite():
        raise ValueError(
            "Approval limit must be a finite monetary amount."
        )

    if amount <= 0:
        raise ValueError(
            "Approval limit must be greater than zero."
        )

    # Deliberately NO maximum-value check.
    return amount



def format_approval_limit(value: Any) -> str:
    amount = parse_approval_limit(value)
    naira_symbol = chr(0x20A6)

    try:
        return f"{naira_symbol}{amount:,.2f}"
    except Exception:
        return f"{naira_symbol}{amount}"


def ensure_approval_policy_schema() -> None:
    """Use migration 007 on PostgreSQL and a local fallback on SQLite."""

    global _SCHEMA_READY

    if _SCHEMA_READY:
        return

    if is_postgres():
        missing = [
            name
            for name in (
                "approval_policy_settings",
                "approval_policy_history",
            )
            if not table_exists(name)
        ]

        if missing:
            raise RuntimeError(
                "Configurable approval policy schema is not ready. "
                "Apply migration "
                "007_configurable_approval_limit.sql. "
                "Missing table(s): "
                + ", ".join(missing)
            )

        _SCHEMA_READY = True
        return

    # SQLite/local/demo fallback.
    run_query(
        """
        CREATE TABLE IF NOT EXISTS approval_policy_settings (
            policy_key TEXT PRIMARY KEY,
            amount NUMERIC NOT NULL CHECK (amount > 0),
            updated_by INTEGER,
            update_reason TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )

    run_query(
        """
        CREATE TABLE IF NOT EXISTS approval_policy_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            policy_key TEXT NOT NULL,
            old_amount NUMERIC NOT NULL CHECK (old_amount > 0),
            new_amount NUMERIC NOT NULL CHECK (new_amount > 0),
            changed_by INTEGER,
            change_reason TEXT NOT NULL,
            changed_at TEXT NOT NULL
        )
        """
    )

    existing = df_query(
        """
        SELECT policy_key
        FROM approval_policy_settings
        WHERE policy_key=?
        LIMIT 1
        """,
        (APPROVAL_LIMIT_POLICY_KEY,),
    )

    if existing.empty:
        ts = now_iso()

        run_query(
            """
            INSERT INTO approval_policy_settings (
                policy_key,
                amount,
                updated_by,
                update_reason,
                created_at,
                updated_at
            )
            VALUES (?, ?, NULL, ?, ?, ?)
            """,
            (
                APPROVAL_LIMIT_POLICY_KEY,
                str(DEFAULT_PROCUREMENT_MANAGER_APPROVAL_LIMIT),
                "Initial ProcureFlow approval policy default",
                ts,
                ts,
            ),
        )

    _SCHEMA_READY = True


def get_procurement_manager_approval_limit() -> Decimal:
    ensure_approval_policy_schema()

    rows = df_query(
        """
        SELECT amount
        FROM approval_policy_settings
        WHERE policy_key=?
        LIMIT 1
        """,
        (APPROVAL_LIMIT_POLICY_KEY,),
    )

    if rows.empty:
        # The PostgreSQL migration and SQLite fallback both seed this row.
        # Failing closed here prevents an accidental silent policy change.
        raise RuntimeError(
            "Procurement Manager approval limit "
            "configuration is missing."
        )

    return parse_approval_limit(
        rows.iloc[0]["amount"]
    )



def get_procurement_manager_approval_limit_sql() -> Decimal | str:
    """Return a database-safe threshold without float conversion.

    PostgreSQL/psycopg accepts Decimal natively and preserves arbitrary
    precision.

    Python's built-in SQLite driver does not bind Decimal directly, so
    SQLite receives the exact non-scientific decimal string instead.

    This deliberately avoids float() so a valid very large Admin limit
    can never silently become positive infinity.
    """

    amount = get_procurement_manager_approval_limit()

    if is_postgres():
        return amount

    return format(amount, "f")





def set_procurement_manager_approval_limit(
    amount: Any,
    *,
    actor: dict[str, Any],
    reason: str,
) -> Decimal:
    """Atomically change the global approval authorization limit.

    Required evidence is committed in the same database transaction:
    - current policy setting;
    - approval policy history;
    - legacy audit log;
    - immutable hash-chained audit event.

    PostgreSQL locks the policy row with SELECT ... FOR UPDATE so
    concurrent Admin changes cannot produce stale history.

    There is deliberately no application-defined maximum ceiling.
    """

    actor = _require_admin(actor)
    clean_reason = _require_reason(reason)
    new_amount = parse_approval_limit(amount)

    ensure_approval_policy_schema()

    actor_id = int(actor["id"])
    actor_role = str(actor.get("role") or "Admin")
    ts = now_iso()

    # Read schema metadata before opening the write transaction.
    # PostgreSQL migration 001 contains the full audit shape, while
    # this keeps legacy installations readable without weakening
    # production transaction semantics.
    audit_columns = table_columns("audit_logs")

    conn = get_conn()

    try:
        # The PostgreSQL compatibility adapter translates
        # BEGIN IMMEDIATE to PostgreSQL BEGIN.
        conn.execute("BEGIN IMMEDIATE")

        if is_postgres():
            current = conn.execute(
                """
                SELECT amount
                FROM approval_policy_settings
                WHERE policy_key=?
                FOR UPDATE
                """,
                (APPROVAL_LIMIT_POLICY_KEY,),
            ).fetchone()
        else:
            current = conn.execute(
                """
                SELECT amount
                FROM approval_policy_settings
                WHERE policy_key=?
                """,
                (APPROVAL_LIMIT_POLICY_KEY,),
            ).fetchone()

        if current is None:
            raise RuntimeError(
                "Approval policy setting is missing. "
                "Apply the required database migration first."
            )

        old_amount = parse_approval_limit(
            current["amount"]
        )

        if new_amount == old_amount:
            raise ValueError(
                "The new approval limit is the same as "
                "the current approval limit."
            )

        # Preserve PostgreSQL NUMERIC as Decimal all the way to
        # psycopg. Do not introduce a float conversion.
        if is_postgres():
            old_db_amount = old_amount
            new_db_amount = new_amount
        else:
            old_db_amount = format(
                old_amount,
                "f",
            )
            new_db_amount = format(
                new_amount,
                "f",
            )

        conn.execute(
            """
            UPDATE approval_policy_settings
            SET
                amount=?,
                updated_by=?,
                update_reason=?,
                updated_at=?
            WHERE policy_key=?
            """,
            (
                new_db_amount,
                actor_id,
                clean_reason,
                ts,
                APPROVAL_LIMIT_POLICY_KEY,
            ),
        )

        conn.execute(
            """
            INSERT INTO approval_policy_history (
                policy_key,
                old_amount,
                new_amount,
                changed_by,
                change_reason,
                changed_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                APPROVAL_LIMIT_POLICY_KEY,
                old_db_amount,
                new_db_amount,
                actor_id,
                clean_reason,
                ts,
            ),
        )

        before_values = {
            "approval_limit": str(old_amount),
        }

        after_values = {
            "approval_limit": str(new_amount),
            "reason": clean_reason,
        }

        details = (
            "Procurement Manager approval limit changed "
            f"from {format_approval_limit(old_amount)} "
            f"to {format_approval_limit(new_amount)}. "
            f"Reason: {clean_reason}"
        )

        # Legacy audit_logs entry is part of this SAME transaction.
        if {
            "role",
            "before_values",
            "after_values",
            "event_date",
            "event_time",
        }.issubset(audit_columns):
            conn.execute(
                """
                INSERT INTO audit_logs (
                    action,
                    entity_type,
                    entity_id,
                    user_id,
                    role,
                    details,
                    before_values,
                    after_values,
                    created_at,
                    event_date,
                    event_time
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "APPROVAL_LIMIT_CHANGED",
                    "ApprovalPolicy",
                    APPROVAL_LIMIT_POLICY_KEY,
                    actor_id,
                    actor_role,
                    details,
                    json_dump(before_values),
                    json_dump(after_values),
                    ts,
                    ts[:10],
                    ts[11:19],
                ),
            )

        elif {
            "role",
            "before_values",
            "after_values",
        }.issubset(audit_columns):
            conn.execute(
                """
                INSERT INTO audit_logs (
                    action,
                    entity_type,
                    entity_id,
                    user_id,
                    role,
                    details,
                    before_values,
                    after_values,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "APPROVAL_LIMIT_CHANGED",
                    "ApprovalPolicy",
                    APPROVAL_LIMIT_POLICY_KEY,
                    actor_id,
                    actor_role,
                    details,
                    json_dump(before_values),
                    json_dump(after_values),
                    ts,
                ),
            )

        else:
            conn.execute(
                """
                INSERT INTO audit_logs (
                    action,
                    entity_type,
                    entity_id,
                    user_id,
                    details,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "APPROVAL_LIMIT_CHANGED",
                    "ApprovalPolicy",
                    APPROVAL_LIMIT_POLICY_KEY,
                    actor_id,
                    details,
                    ts,
                ),
            )

        # Immutable hash-chained evidence is part of the SAME
        # PostgreSQL transaction. A failure here rolls back the
        # setting and history as well.
        _append_audit_event_to_conn(
            conn,
            action="APPROVAL_LIMIT_CHANGED",
            entity_type="ApprovalPolicy",
            entity_id=APPROVAL_LIMIT_POLICY_KEY,
            details=details,
            user_id=actor_id,
            role=actor_role,
            before_values=before_values,
            after_values=after_values,
            outcome="Success",
            severity="High",
            source="approval_policy_service",
            reason_or_comment=clean_reason,
        )

        conn.commit()

        return new_amount

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()




def approval_policy_history(limit: int = 25):
    ensure_approval_policy_schema()

    safe_limit = max(1, min(int(limit or 25), 500))

    return df_query(
        f"""
        SELECT
            h.changed_at,
            h.old_amount,
            h.new_amount,
            COALESCE(u.full_name, u.username, 'System') AS changed_by,
            h.change_reason
        FROM approval_policy_history h
        LEFT JOIN users u
            ON u.id=h.changed_by
        WHERE h.policy_key=?
        ORDER BY h.changed_at DESC, h.id DESC
        LIMIT {safe_limit}
        """,
        (APPROVAL_LIMIT_POLICY_KEY,),
    )
