"""ProcureFlow Auditor Control Centre.

Read-only supervisory surfaces for the Auditor role.

IMPORTANT:
- This module imports df_query only.
- It contains no INSERT / UPDATE / DELETE operations.
- It does not invoke operational role workspaces.
- Sensitive credentials and bank-account data remain masked.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pandas as pd
import streamlit as st

from core.db import df_query


AUDITOR_CONTROL_CENTRE_MARKER = (
    "PROCUREFLOW_AUDITOR_CONTROL_CENTRE_V1"
)


READ_ONLY_TABLES = {
    "activity_logs",
    "approval_delegations",
    "approval_history",
    "approval_rescissions",
    "attachments",
    "audit_chain_verifications",
    "audit_events",
    "audit_logs",
    "cash_advances",
    "expenses",
    "gateway_pass_approvals",
    "gateway_pass_events",
    "gateway_pass_items",
    "gateway_passes",
    "invoice_items",
    "invoices",
    "logistics_documents",
    "logistics_exceptions",
    "notifications",
    "payment_payee_detail_versions",
    "payment_payee_details",
    "payments",
    "purchase_order_items",
    "purchase_orders",
    "purchase_request_items",
    "purchase_requests",
    "receipt_document_versions",
    "receipt_items",
    "receipt_records",
    "receiving_slip_items",
    "receiving_slips",
    "role_permissions",
    "roles",
    "sourcing_tasks",
    "user_availability",
    "user_sessions",
    "users",
    "vendor_documents",
    "vendor_quote_items",
    "vendor_quotes",
    "vendors",
    "workflow_events",
}


ROLE_MIRRORS = {
    "Admin": (
        "users",
        "roles",
        "role_permissions",
        "approval_delegations",
        "notifications",
        "audit_events",
    ),
    "Facility Manager": (
        "purchase_requests",
        "purchase_request_items",
        "gateway_passes",
        "gateway_pass_events",
        "notifications",
        "workflow_events",
    ),
    "Procurement Manager": (
        "purchase_requests",
        "sourcing_tasks",
        "vendor_quotes",
        "purchase_orders",
        "vendors",
        "workflow_events",
    ),
    "Approver": (
        "approval_history",
        "approval_rescissions",
        "gateway_pass_approvals",
        "workflow_events",
        "audit_events",
    ),
    "Finance": (
        "payments",
        "invoices",
        "receipt_records",
        "expenses",
        "cash_advances",
        "payment_payee_details",
    ),
    "Logistics Officer": (
        "purchase_orders",
        "receiving_slips",
        "logistics_exceptions",
        "logistics_documents",
        "gateway_passes",
    ),
    "Auditor": (
        "audit_events",
        "audit_logs",
        "activity_logs",
        "audit_chain_verifications",
        "workflow_events",
    ),
}


ROLE_PURPOSE = {
    "Admin":
        "Users, roles, configuration, delegations and system oversight.",

    "Facility Manager":
        "Request origination, corrections and gateway-pass activity.",

    "Procurement Manager":
        "Procurement review, sourcing, vendor quotes, POs and closure.",

    "Approver":
        "Independent approval, rejection, rescission and authorization.",

    "Finance":
        "Payments, invoices, receipts, expenses and financial evidence.",

    "Logistics Officer":
        "PO handover, delivery, receiving and logistics exceptions.",

    "Auditor":
        "Read-only audit, compliance, evidence and investigation.",
}


SENSITIVE_FRAGMENTS = (
    "password",
    "secret",
    "token",
    "private_key",
    "api_key",
    "account_number",
    "bank_account",
    "iban",
    "swift",
    "routing",
    "sort_code",
    "encrypted",
    "cipher",
    "encryption_key",
    "session_cookie",
)


# AUDITOR_EMBEDDED_SENSITIVE_MASK_V1
# Additional credential/session fields are masked even when
# the database column names vary.
SENSITIVE_FRAGMENTS = SENSITIVE_FRAGMENTS + (
    "session_id",
    "session_key",
    "cookie",
    "credential",
    "csrf",
)


SENSITIVE_VALUE_PATTERN = re.compile(
    r"""(?ix)
    (
        ["']?
        (?:
            password
            | secret
            | token
            | api[_ -]?key
            | account[_ -]?number
            | bank[_ -]?account
            | iban
            | swift
            | routing
            | sort[_ -]?code
            | session[_ -]?(?:id|key|cookie)
            | private[_ -]?key
            | encryption[_ -]?key
        )
        ["']?
        \s*[:=]\s*
    )
    (
        "[^"]*"
        | '[^']*'
        | [^,;\s}\]]+
    )
    """
)


def _mask_embedded_sensitive(
    value: Any,
) -> Any:

    if isinstance(
        value,
        (
            dict,
            list,
            tuple,
        ),
    ):
        value = json.dumps(
            value,
            default=str,
        )

    if not isinstance(
        value,
        str,
    ):
        return value

    return SENSITIVE_VALUE_PATTERN.sub(
        lambda match:
            match.group(1)
            + "[MASKED]",
        value,
    )


TIME_COLUMNS = (
    "created_at",
    "updated_at",
    "timestamp",
    "event_at",
    "occurred_at",
    "approved_at",
    "paid_at",
    "submitted_at",
)


def _load_table(
    table: str,
    limit: int = 500,
) -> pd.DataFrame:

    if table not in READ_ONLY_TABLES:
        raise ValueError(
            f"Table is not approved for Auditor access: {table}"
        )

    limit = max(
        1,
        min(
            int(limit),
            5000,
        ),
    )

    try:
        df = df_query(
            f"SELECT * FROM {table} LIMIT {limit}"
        )
    except Exception:
        return pd.DataFrame()

    if df is None or df.empty:
        return pd.DataFrame()

    df = df.copy()

    for column in TIME_COLUMNS:

        if column not in df.columns:
            continue

        try:
            df = df.sort_values(
                column,
                ascending=False,
                kind="stable",
            )
        except Exception:
            pass

        break

    return df.reset_index(
        drop=True
    )


def _mask_sensitive(
    df: pd.DataFrame,
) -> pd.DataFrame:

    if df is None:
        return pd.DataFrame()

    result = df.copy()

    if result.empty:
        return result

    for column in result.columns:

        lowered = str(
            column
        ).lower()

        if any(
            fragment in lowered
            for fragment in SENSITIVE_FRAGMENTS
        ):
            result[column] = "[MASKED]"
            continue

        result[column] = result[column].map(
            _mask_embedded_sensitive
        )

    return result


def _show(
    title: str,
    df: pd.DataFrame,
) -> None:

    st.markdown(
        f"#### {title}"
    )

    if df is None or df.empty:

        st.info(
            "No records found."
        )

        return

    st.dataframe(
        _mask_sensitive(df),
        use_container_width=True,
        hide_index=True,
    )


def _first(
    row: pd.Series,
    names: tuple[str, ...],
) -> Any:

    for name in names:

        if name not in row.index:
            continue

        value = row.get(
            name
        )

        if value is None:
            continue

        text = str(
            value
        ).strip()

        if text not in {
            "",
            "nan",
            "None",
        }:
            return value

    return None


def _users() -> dict[str, dict[str, Any]]:

    df = _load_table(
        "users",
        5000,
    )

    result = {}

    if (
        df.empty
        or "id" not in df.columns
    ):
        return result

    for _, row in df.iterrows():

        result[str(row["id"])] = {
            "username":
                row.get("username"),

            "full_name":
                row.get("full_name"),

            "role":
                row.get("role"),
        }

    return result


def activity_feed(
    limit: int = 300,
) -> pd.DataFrame:

    user_map = _users()

    output = []

    sources = (
        (
            "audit_events",
            "Immutable Audit",
        ),
        (
            "audit_logs",
            "Legacy Audit",
        ),
        (
            "workflow_events",
            "Workflow",
        ),
        (
            "activity_logs",
            "Activity",
        ),
    )

    for table, source_name in sources:

        df = _load_table(
            table,
            max(
                500,
                limit,
            ),
        )

        if df.empty:
            continue

        for _, row in df.iterrows():

            actor_id = _first(
                row,
                (
                    "actor_user_id",
                    "user_id",
                    "created_by",
                    "performed_by",
                ),
            )

            actor = user_map.get(
                str(actor_id),
                {},
            )

            actor_role = (
                _first(
                    row,
                    (
                        "actor_role",
                        "user_role",
                        "role",
                    ),
                )
                or actor.get("role")
                or ""
            )

            actor_name = (
                actor.get("full_name")
                or actor.get("username")
                or actor_id
                or "System"
            )

            output.append(
                {
                    "Timestamp":
                        _first(
                            row,
                            TIME_COLUMNS,
                        ),

                    "Source":
                        source_name,

                    "Actor":
                        actor_name,

                    "Actor Role":
                        actor_role,

                    "Action":
                        _first(
                            row,
                            (
                                "action",
                                "event",
                                "activity",
                                "event_type",
                                "status",
                            ),
                        )
                        or "",

                    "Entity Type":
                        _first(
                            row,
                            (
                                "entity_type",
                                "record_type",
                                "document_type",
                            ),
                        )
                        or "",

                    "Entity ID":
                        _first(
                            row,
                            (
                                "entity_id",
                                "request_id",
                                "record_id",
                                "document_id",
                            ),
                        )
                        or "",

                    "Details":
                        _first(
                            row,
                            (
                                "reason",
                                "note",
                                "description",
                                "details",
                                "message",
                            ),
                        )
                        or "",
                }
            )

    if not output:

        return pd.DataFrame(
            columns=[
                "Timestamp",
                "Source",
                "Actor",
                "Actor Role",
                "Action",
                "Entity Type",
                "Entity ID",
                "Details",
            ]
        )

    result = pd.DataFrame(
        output
    )

    try:

        result["_time"] = pd.to_datetime(
            result["Timestamp"],
            errors="coerce",
            utc=True,
        )

        result = (
            result.sort_values(
                "_time",
                ascending=False,
                kind="stable",
            )
            .drop(
                columns=[
                    "_time",
                ]
            )
        )

    except Exception:
        pass

    return result.head(
        limit
    ).reset_index(
        drop=True
    )


def _csv(
    label: str,
    df: pd.DataFrame,
    filename: str,
    key: str,
) -> None:

    if (
        df is None
        or df.empty
    ):
        return

    st.download_button(
        label,
        data=(
            _mask_sensitive(df)
            .to_csv(
                index=False
            )
            .encode(
                "utf-8"
            )
        ),
        file_name=filename,
        mime="text/csv",
        key=key,
    )


def render_auditor_dashboard() -> None:

    st.subheader(
        "Audit & Compliance Command Centre"
    )

    st.caption(
        "Read-only oversight across every ProcureFlow role. "
        "Use Role Activity Mirrors for role-by-role visibility, "
        "Transaction 360? for a complete procurement case, "
        "User 360? for individual actor investigation, and "
        "Exception Centre for events that deserve audit attention."
    )

    events = _load_table(
        "audit_events",
        5000,
    )

    requests = _load_table(
        "purchase_requests",
        5000,
    )

    rescissions = _load_table(
        "approval_rescissions",
        5000,
    )

    users = _load_table(
        "users",
        5000,
    )

    deleted = 0

    if (
        not requests.empty
        and "status" in requests.columns
    ):

        deleted = int(
            requests["status"]
            .astype(str)
            .str.casefold()
            .eq(
                "deleted draft"
            )
            .sum()
        )

    active_users = len(
        users
    )

    if (
        not users.empty
        and "is_active" in users.columns
    ):

        active_users = int(
            users["is_active"]
            .astype(str)
            .str.casefold()
            .isin(
                {
                    "1",
                    "true",
                    "yes",
                    "active",
                }
            )
            .sum()
        )

    c1, c2, c3, c4 = st.columns(
        4
    )

    c1.metric(
        "Immutable Audit Events",
        len(events),
    )

    c2.metric(
        "Active Users",
        active_users,
    )

    c3.metric(
        "Deleted Drafts",
        deleted,
    )

    c4.metric(
        "Approval Rescissions",
        len(rescissions),
    )

    st.markdown(
        "### Cross-role visibility"
    )

    coverage = pd.DataFrame(
        [
            {
                "Role":
                    role,

                "Auditor visibility":
                    ROLE_PURPOSE[role],

                "Mode":
                    "READ ONLY",
            }
            for role in ROLE_MIRRORS
        ]
    )

    st.dataframe(
        coverage,
        use_container_width=True,
        hide_index=True,
    )

    feed = activity_feed(
        150
    )

    _show(
        "Recent activity across all roles",
        feed,
    )

    _csv(
        "Download masked global activity timeline",
        feed,
        "procureflow_global_activity_timeline.csv",
        "auditor_dashboard_timeline_csv",
    )


def render_role_activity_mirrors() -> None:

    st.subheader(
        "Role Activity Mirrors"
    )

    st.caption(
        "Select a role to inspect the records, queues and evidence "
        "associated with that interface. These are independent "
        "read-only audit views; operational buttons are never exposed."
    )

    role = st.selectbox(
        "Role to inspect",
        list(
            ROLE_MIRRORS.keys()
        ),
        key="auditor_role_mirror_role",
    )

    st.info(
        f"{role}: "
        f"{ROLE_PURPOSE[role]}"
    )

    feed = activity_feed(
        1500
    )

    role_feed = feed

    if (
        not feed.empty
        and "Actor Role" in feed.columns
    ):

        role_feed = feed[
            feed["Actor Role"]
            .fillna("")
            .astype(str)
            .str.casefold()
            .eq(
                role.casefold()
            )
        ].head(
            250
        )

    _show(
        f"Recorded activity by {role}",
        role_feed,
    )

    _csv(
        f"Download {role} activity",
        role_feed,
        (
            "procureflow_"
            + role.lower().replace(
                " ",
                "_",
            )
            + "_activity.csv"
        ),
        f"auditor_role_csv_{role}",
    )

    st.markdown(
        "### Role interface evidence"
    )

    for table in ROLE_MIRRORS[
        role
    ]:

        _show(
            table.replace(
                "_",
                " ",
            ).title(),
            _load_table(
                table,
                250,
            ),
        )


def _filter_ids(
    df: pd.DataFrame,
    columns: tuple[str, ...],
    values: set[str],
) -> pd.DataFrame:

    if (
        df is None
        or df.empty
        or not values
    ):

        return pd.DataFrame(
            columns=(
                []
                if df is None
                else df.columns
            )
        )

    mask = pd.Series(
        False,
        index=df.index,
    )

    for column in columns:

        if column in df.columns:

            mask = (
                mask
                | df[column]
                .astype(str)
                .isin(values)
            )

    return df[
        mask
    ].copy()


def render_transaction_360() -> None:

    st.subheader(
        "Transaction 360?"
    )

    st.caption(
        "One read-only case file spanning request, sourcing, "
        "vendor quotes, approvals, PO, logistics, payment, "
        "receipts, workflow and audit evidence."
    )

    requests = _load_table(
        "purchase_requests",
        5000,
    )

    if (
        requests.empty
        or "id" not in requests.columns
    ):

        st.info(
            "No procurement requests are available."
        )

        return

    if "request_no" not in requests.columns:

        requests["request_no"] = (
            requests["id"]
            .apply(
                lambda value:
                    f"Request #{value}"
            )
        )

    labels = []
    id_by_label = {}

    for _, row in requests.iterrows():

        request_id = int(
            row["id"]
        )

        request_no = str(
            row.get(
                "request_no"
            )
            or request_id
        )

        status = str(
            row.get(
                "status"
            )
            or ""
        )

        label = (
            f"{request_no} ? "
            f"{status} ? "
            f"#{request_id}"
        )

        labels.append(
            label
        )

        id_by_label[
            label
        ] = request_id

    selected = st.selectbox(
        "Transaction",
        labels,
        key="auditor_transaction_360",
    )

    request_id = id_by_label[
        selected
    ]

    request_row = requests[
        requests["id"]
        .astype(str)
        .eq(
            str(
                request_id
            )
        )
    ].copy()

    request_no = str(
        request_row.iloc[0].get(
            "request_no"
        )
        or request_id
    )

    _show(
        "Purchase Request",
        request_row,
    )

    request_ids = {
        str(
            request_id
        )
    }

    sourcing_all = _load_table(
        "sourcing_tasks",
        5000,
    )

    sourcing = _filter_ids(
        sourcing_all,
        (
            "request_id",
            "purchase_request_id",
        ),
        request_ids,
    )

    sourcing_ids = (
        set(
            sourcing["id"]
            .astype(str)
        )
        if (
            not sourcing.empty
            and "id" in sourcing.columns
        )
        else set()
    )

    po_all = _load_table(
        "purchase_orders",
        5000,
    )

    pos = _filter_ids(
        po_all,
        (
            "request_id",
            "purchase_request_id",
        ),
        request_ids,
    )

    po_ids = (
        set(
            pos["id"]
            .astype(str)
        )
        if (
            not pos.empty
            and "id" in pos.columns
        )
        else set()
    )

    payment_all = _load_table(
        "payments",
        5000,
    )

    payment_mask = pd.Series(
        False,
        index=payment_all.index,
    )

    if not payment_all.empty:

        if "request_id" in payment_all.columns:

            payment_mask = (
                payment_mask
                | payment_all[
                    "request_id"
                ]
                .astype(str)
                .isin(
                    request_ids
                )
            )

        if (
            "po_id" in payment_all.columns
            and po_ids
        ):

            payment_mask = (
                payment_mask
                | payment_all[
                    "po_id"
                ]
                .astype(str)
                .isin(
                    po_ids
                )
            )

    payments = (
        payment_all[
            payment_mask
        ].copy()
        if not payment_all.empty
        else payment_all
    )

    payment_ids = (
        set(
            payments["id"]
            .astype(str)
        )
        if (
            not payments.empty
            and "id" in payments.columns
        )
        else set()
    )

    receiving_all = _load_table(
        "receiving_slips",
        5000,
    )

    receiving = _filter_ids(
        receiving_all,
        (
            "request_id",
            "po_id",
            "purchase_order_id",
        ),
        request_ids
        | po_ids,
    )

    receiving_ids = (
        set(
            receiving["id"]
            .astype(str)
        )
        if (
            not receiving.empty
            and "id" in receiving.columns
        )
        else set()
    )

    bundle = {
        "request_id":
            request_id,

        "request_no":
            request_no,

        "tables": {},
    }

    tables = (
        "purchase_request_items",
        "sourcing_tasks",
        "vendor_quotes",
        "purchase_orders",
        "purchase_order_items",
        "approval_history",
        "approval_rescissions",
        "payments",
        "invoices",
        "receipt_records",
        "receiving_slips",
        "receiving_slip_items",
        "logistics_exceptions",
        "attachments",
        "workflow_events",
        "audit_logs",
        "audit_events",
    )

    for table in tables:

        df = _load_table(
            table,
            5000,
        )

        if df.empty:
            continue

        mask = pd.Series(
            False,
            index=df.index,
        )

        for column in (
            "request_id",
            "purchase_request_id",
        ):

            if column in df.columns:

                mask = (
                    mask
                    | df[column]
                    .astype(str)
                    .isin(
                        request_ids
                    )
                )

        if (
            "request_no"
            in df.columns
        ):

            mask = (
                mask
                | df["request_no"]
                .astype(str)
                .eq(
                    request_no
                )
            )

        if (
            "entity_id"
            in df.columns
        ):

            entity_mask = (
                df["entity_id"]
                .astype(str)
                .isin(
                    request_ids
                )
            )

            if (
                "entity_type"
                in df.columns
            ):

                entity_mask = (
                    entity_mask
                    & df["entity_type"]
                    .fillna("")
                    .astype(str)
                    .str.contains(
                        "request",
                        case=False,
                        regex=False,
                    )
                )

            mask = (
                mask
                | entity_mask
            )

        for column in (
            "po_id",
            "purchase_order_id",
        ):

            if (
                column in df.columns
                and po_ids
            ):

                mask = (
                    mask
                    | df[column]
                    .astype(str)
                    .isin(
                        po_ids
                    )
                )

        if (
            "sourcing_task_id"
            in df.columns
            and sourcing_ids
        ):

            mask = (
                mask
                | df[
                    "sourcing_task_id"
                ]
                .astype(str)
                .isin(
                    sourcing_ids
                )
            )

        if (
            "payment_id"
            in df.columns
            and payment_ids
        ):

            mask = (
                mask
                | df[
                    "payment_id"
                ]
                .astype(str)
                .isin(
                    payment_ids
                )
            )

        if (
            "receiving_slip_id"
            in df.columns
            and receiving_ids
        ):

            mask = (
                mask
                | df[
                    "receiving_slip_id"
                ]
                .astype(str)
                .isin(
                    receiving_ids
                )
            )

        related = df[
            mask
        ].copy()

        if related.empty:
            continue

        safe = _mask_sensitive(
            related
        )

        bundle["tables"][
            table
        ] = safe.to_dict(
            orient="records"
        )

        _show(
            table.replace(
                "_",
                " ",
            ).title(),
            related,
        )

    st.download_button(
        "Download masked Transaction 360 evidence pack",
        data=json.dumps(
            bundle,
            indent=2,
            default=str,
        ).encode(
            "utf-8"
        ),
        file_name=(
            f"{request_no}_"
            "audit_evidence.json"
        ),
        mime="application/json",
        key=(
            "auditor_transaction_"
            f"evidence_{request_id}"
        ),
    )


def render_user_360() -> None:

    st.subheader(
        "User 360?"
    )

    st.caption(
        "Inspect a user's account context and recorded activity "
        "without gaining account-management powers."
    )

    users = _load_table(
        "users",
        5000,
    )

    if (
        users.empty
        or "id" not in users.columns
    ):

        st.info(
            "No users are available."
        )

        return

    labels = []
    ids = {}

    for _, row in users.iterrows():

        user_id = int(
            row["id"]
        )

        username = str(
            row.get(
                "username"
            )
            or ""
        )

        full_name = str(
            row.get(
                "full_name"
            )
            or username
        )

        role = str(
            row.get(
                "role"
            )
            or ""
        )

        label = (
            f"{full_name} "
            f"({username}) ? "
            f"{role} ? "
            f"#{user_id}"
        )

        labels.append(
            label
        )

        ids[
            label
        ] = user_id

    selected = st.selectbox(
        "User",
        labels,
        key="auditor_user_360",
    )

    user_id = ids[
        selected
    ]

    profile = users[
        users["id"]
        .astype(str)
        .eq(
            str(
                user_id
            )
        )
    ].copy()

    _show(
        "User Profile",
        profile,
    )

    profile_row = profile.iloc[
        0
    ]

    usernames = {
        str(
            profile_row.get(
                "username"
            )
            or ""
        ),
        str(
            profile_row.get(
                "full_name"
            )
            or ""
        ),
        str(
            user_id
        ),
    }

    usernames.discard(
        ""
    )

    feed = activity_feed(
        2500
    )

    user_feed = (
        feed[
            feed["Actor"]
            .astype(str)
            .isin(
                usernames
            )
        ].copy()
        if not feed.empty
        else feed
    )

    _show(
        "Recorded Activity",
        user_feed,
    )

    _csv(
        "Download masked user activity",
        user_feed,
        f"procureflow_user_{user_id}_activity.csv",
        f"auditor_user_csv_{user_id}",
    )

    actor_columns = (
        "user_id",
        "actor_user_id",
        "created_by",
        "requested_by",
        "approved_by",
        "approved_by_user_id",
        "paid_by",
        "uploaded_by",
        "recipient_user_id",
        "facility_manager_user_id",
        "approver_user_id",
        "rejected_by_user_id",
    )

    for table in (
        "user_sessions",
        "purchase_requests",
        "approval_history",
        "approval_rescissions",
        "payments",
        "gateway_passes",
        "notifications",
        "workflow_events",
        "audit_logs",
        "audit_events",
    ):

        df = _load_table(
            table,
            5000,
        )

        rows = _filter_ids(
            df,
            actor_columns,
            {
                str(
                    user_id
                )
            },
        )

        if rows.empty:
            continue

        _show(
            table.replace(
                "_",
                " ",
            ).title(),
            rows,
        )


def _contains(
    series: pd.Series,
    terms: tuple[str, ...],
) -> pd.Series:

    text = (
        series.fillna("")
        .astype(str)
        .str.casefold()
    )

    result = pd.Series(
        False,
        index=series.index,
    )

    for term in terms:

        result = (
            result
            | text.str.contains(
                term.casefold(),
                regex=False,
            )
        )

    return result


def render_exception_centre() -> None:

    st.subheader(
        "Auditor Exception Centre"
    )

    st.caption(
        "Investigation leads requiring attention. "
        "An exception is not automatically evidence of wrongdoing."
    )

    requests = _load_table(
        "purchase_requests",
        5000,
    )

    rescissions = _load_table(
        "approval_rescissions",
        5000,
    )

    expenses = _load_table(
        "expenses",
        5000,
    )

    feed = activity_feed(
        3000
    )

    deleted = pd.DataFrame()

    rejected = pd.DataFrame()

    missing_documents = pd.DataFrame()

    if (
        not requests.empty
        and "status" in requests.columns
    ):

        deleted = requests[
            requests["status"]
            .astype(str)
            .str.casefold()
            .eq(
                "deleted draft"
            )
        ].copy()

        rejected = requests[
            _contains(
                requests["status"],
                (
                    "rejected",
                    "returned",
                ),
            )
        ].copy()

    if (
        not requests.empty
        and "attachments_json"
        in requests.columns
    ):

        values = (
            requests[
                "attachments_json"
            ]
            .fillna("")
            .astype(str)
            .str.strip()
            .str.casefold()
        )

        missing_documents = requests[
            values.isin(
                {
                    "",
                    "[]",
                    "{}",
                    "null",
                    "none",
                }
            )
        ].copy()

    duplicates = pd.DataFrame()

    if (
        not expenses.empty
        and "duplicate_warning"
        in expenses.columns
    ):

        duplicates = expenses[
            expenses[
                "duplicate_warning"
            ]
            .astype(str)
            .str.casefold()
            .isin(
                {
                    "1",
                    "true",
                    "yes",
                }
            )
        ].copy()

    sensitive = pd.DataFrame()

    security = pd.DataFrame()

    if not feed.empty:

        combined = (
            feed["Action"]
            .fillna("")
            .astype(str)
            + " "
            + feed["Details"]
            .fillna("")
            .astype(str)
        )

        sensitive = feed[
            _contains(
                combined,
                (
                    "payee",
                    "bank",
                    "reveal",
                    "sensitive",
                    "account access",
                ),
            )
        ].copy()

        security = feed[
            _contains(
                combined,
                (
                    "login failed",
                    "failed login",
                    "lock",
                    "password",
                    "permission",
                    "session",
                ),
            )
        ].copy()

    c1, c2, c3, c4 = st.columns(
        4
    )

    c1.metric(
        "Deleted Drafts",
        len(
            deleted
        ),
    )

    c2.metric(
        "Approval Rescissions",
        len(
            rescissions
        ),
    )

    c3.metric(
        "Duplicate Warnings",
        len(
            duplicates
        ),
    )

    c4.metric(
        "Sensitive Access Events",
        len(
            sensitive
        ),
    )

    _show(
        "Deleted Draft Evidence",
        deleted,
    )

    _show(
        "Approval Rescissions",
        rescissions,
    )

    _show(
        "Returned / Rejected Requests",
        rejected,
    )

    _show(
        "Requests With No Attachment Metadata",
        missing_documents,
    )

    _show(
        "Duplicate Expense Warnings",
        duplicates,
    )

    _show(
        "Sensitive Payee / Bank Access Signals",
        sensitive,
    )

    _show(
        "Security / Account Signals",
        security,
    )
