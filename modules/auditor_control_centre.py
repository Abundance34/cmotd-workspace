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

# ============================================================
# PROCUREFLOW_AUDITOR_INTERFACE_V2
#
# Auditor UI corrections:
# - August 2026 onward event scope
# - exact request linkage in Approval Trails
# - Excel / CSV / PDF schema exports
# - generic read-only evidence pages for sidebar sections
# ============================================================

AUDITOR_EVENT_WINDOW_START = "2026-08-01T00:00:00Z"


READ_ONLY_TABLES = READ_ONLY_TABLES | {
    "budgets",
    "imported_legacy_documents",
}


AUDITOR_EVENT_TABLES = {
    "audit_events",
    "audit_logs",
    "activity_logs",
    "workflow_events",
    "approval_history",
    "approval_rescissions",
}


AUDITOR_SCHEMA_PAGES = {
    "All Activity & Evidence Ledger": (
        "audit_events",
        "audit_logs",
        "activity_logs",
        "workflow_events",
        "audit_chain_verifications",
    ),

    "Sourcing & Vendor Quote Audit": (
        "sourcing_tasks",
        "vendor_quotes",
        "vendor_quote_items",
        "vendor_documents",
        "vendors",
    ),

    "Purchase Order & Logistics Evidence": (
        "purchase_orders",
        "purchase_order_items",
        "logistics_documents",
        "logistics_exceptions",
    ),

    "Receiving Slips, Proof of Delivery & Returns": (
        "receiving_slips",
        "receiving_slip_items",
        "logistics_exceptions",
        "logistics_documents",
    ),

    "Finance, Invoice & Payment Audit": (
        "payments",
        "invoices",
        "invoice_items",
        "receipt_records",
        "receipt_items",
        "expenses",
        "cash_advances",
    ),

    "Payment Payee / Bank Detail Access Audit": (
        "payment_payee_details",
        "payment_payee_detail_versions",
        "audit_events",
        "audit_logs",
    ),

    "Document Archive & Download Audit": (
        "attachments",
        "imported_legacy_documents",
        "vendor_documents",
        "logistics_documents",
        "receipt_records",
        "receipt_document_versions",
        "audit_events",
    ),

    "Notification Delivery Audit": (
        "notifications",
        "audit_events",
        "audit_logs",
    ),

    "User & Security Audit": (
        "users",
        "user_sessions",
        "user_availability",
        "audit_events",
        "audit_logs",
    ),
}


def _auditor_filter_event_window(
    df: pd.DataFrame,
) -> pd.DataFrame:

    if (
        df is None
        or df.empty
    ):
        return pd.DataFrame(
            columns=(
                []
                if df is None
                else df.columns
            )
        )

    start = pd.Timestamp(
        AUDITOR_EVENT_WINDOW_START
    )

    for column in (
        "created_at",
        "timestamp",
        "event_at",
        "occurred_at",
        "approved_at",
        "updated_at",
        "submitted_at",
    ):

        if column not in df.columns:
            continue

        parsed = pd.to_datetime(
            df[column],
            errors="coerce",
            utc=True,
        )

        if not parsed.notna().any():
            continue

        return (
            df.loc[
                parsed.ge(start)
            ]
            .copy()
            .reset_index(
                drop=True
            )
        )

    return df.copy().reset_index(
        drop=True
    )


def _auditor_export_key(
    title: str,
    df: pd.DataFrame,
) -> str:

    import hashlib

    columns = "|".join(
        str(column)
        for column in df.columns
    )

    raw = (
        str(title)
        + "|"
        + columns
    )

    return hashlib.sha1(
        raw.encode(
            "utf-8"
        )
    ).hexdigest()[:12]


def _auditor_safe_filename(
    title: str,
) -> str:

    import re

    name = re.sub(
        r"[^A-Za-z0-9_-]+",
        "_",
        str(title).strip(),
    ).strip("_")

    return (
        name.lower()
        or "audit_export"
    )


def _auditor_excel_bytes(
    df: pd.DataFrame,
) -> bytes:

    from io import BytesIO

    out = BytesIO()

    with pd.ExcelWriter(
        out,
        engine="openpyxl",
    ) as writer:

        df.to_excel(
            writer,
            index=False,
            sheet_name="Audit Data",
        )

    return out.getvalue()


def _auditor_pdf_bytes(
    df: pd.DataFrame,
    title: str,
) -> bytes:

    from html import escape
    from io import BytesIO

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import (
        ParagraphStyle,
        getSampleStyleSheet,
    )
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    out = BytesIO()

    page_width, _ = landscape(
        A4
    )

    doc = SimpleDocTemplate(
        out,
        pagesize=landscape(A4),
        rightMargin=8 * mm,
        leftMargin=8 * mm,
        topMargin=9 * mm,
        bottomMargin=9 * mm,
    )

    styles = getSampleStyleSheet()

    heading = ParagraphStyle(
        "auditor_export_heading",
        parent=styles["Heading1"],
        fontSize=13,
        leading=15,
        spaceAfter=8,
    )

    small = ParagraphStyle(
        "auditor_export_small",
        parent=styles["Normal"],
        fontSize=5.8,
        leading=7,
    )

    story = [
        Paragraph(
            escape(
                str(title)
            ),
            heading,
        ),
        Paragraph(
            (
                "ProcureFlow Auditor read-only evidence export. "
                "Sensitive values are masked."
            ),
            small,
        ),
        Spacer(
            1,
            5,
        ),
    ]

    if df.empty:

        story.append(
            Paragraph(
                "No records.",
                small,
            )
        )

        doc.build(
            story
        )

        return out.getvalue()

    safe = df.fillna("").astype(str)

    columns = list(
        safe.columns
    )

    # Wide schemas are split into manageable column groups.
    chunk_size = 7

    chunks = [
        columns[index:index + chunk_size]
        for index in range(
            0,
            len(columns),
            chunk_size,
        )
    ]

    usable_width = (
        page_width
        - 16 * mm
    )

    for chunk_index, chunk in enumerate(
        chunks
    ):

        if chunk_index:

            story.append(
                PageBreak()
            )

            story.append(
                Paragraph(
                    escape(
                        f"{title} ? columns "
                        f"{chunk_index * chunk_size + 1}"
                        f"?"
                        f"{chunk_index * chunk_size + len(chunk)}"
                    ),
                    heading,
                )
            )

        matrix = [
            [
                Paragraph(
                    f"<b>{escape(str(column))}</b>",
                    small,
                )
                for column in chunk
            ]
        ]

        for _, row in safe.iterrows():

            matrix.append(
                [
                    Paragraph(
                        escape(
                            str(
                                row[column]
                            )
                        ),
                        small,
                    )
                    for column in chunk
                ]
            )

        col_width = (
            usable_width
            / max(
                1,
                len(chunk),
            )
        )

        table = Table(
            matrix,
            repeatRows=1,
            colWidths=[
                col_width
                for _ in chunk
            ],
        )

        table.setStyle(
            TableStyle(
                [
                    (
                        "BACKGROUND",
                        (
                            0,
                            0,
                        ),
                        (
                            -1,
                            0,
                        ),
                        colors.HexColor(
                            "#E8EEF8"
                        ),
                    ),
                    (
                        "GRID",
                        (
                            0,
                            0,
                        ),
                        (
                            -1,
                            -1,
                        ),
                        0.25,
                        colors.HexColor(
                            "#CBD5E1"
                        ),
                    ),
                    (
                        "VALIGN",
                        (
                            0,
                            0,
                        ),
                        (
                            -1,
                            -1,
                        ),
                        "TOP",
                    ),
                    (
                        "LEFTPADDING",
                        (
                            0,
                            0,
                        ),
                        (
                            -1,
                            -1,
                        ),
                        2,
                    ),
                    (
                        "RIGHTPADDING",
                        (
                            0,
                            0,
                        ),
                        (
                            -1,
                            -1,
                        ),
                        2,
                    ),
                    (
                        "TOPPADDING",
                        (
                            0,
                            0,
                        ),
                        (
                            -1,
                            -1,
                        ),
                        2,
                    ),
                    (
                        "BOTTOMPADDING",
                        (
                            0,
                            0,
                        ),
                        (
                            -1,
                            -1,
                        ),
                        2,
                    ),
                ]
            )
        )

        story.append(
            table
        )

    doc.build(
        story
    )

    return out.getvalue()


def _auditor_schema_download(
    title: str,
    df: pd.DataFrame,
) -> None:

    if (
        df is None
        or df.empty
    ):
        return

    safe = _mask_sensitive(
        df
    )

    key = _auditor_export_key(
        title,
        safe,
    )

    filename = _auditor_safe_filename(
        title
    )

    choice = st.selectbox(
        f"Export {title}",
        [
            "Excel (.xlsx)",
            "CSV (.csv)",
            "PDF (.pdf)",
        ],
        key=f"auditor_export_format_{key}",
        label_visibility="collapsed",
    )

    if choice.startswith(
        "Excel"
    ):

        payload = _auditor_excel_bytes(
            safe
        )

        extension = "xlsx"

        mime = (
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        )

    elif choice.startswith(
        "CSV"
    ):

        payload = safe.to_csv(
            index=False
        ).encode(
            "utf-8-sig"
        )

        extension = "csv"

        mime = "text/csv"

    else:

        payload = _auditor_pdf_bytes(
            safe,
            title,
        )

        extension = "pdf"

        mime = "application/pdf"

    st.download_button(
        (
            f"Download {title} "
            f"{extension.upper()}"
        ),
        data=payload,
        file_name=(
            f"{filename}.{extension}"
        ),
        mime=mime,
        key=(
            f"auditor_export_"
            f"{key}_{extension}"
        ),
        use_container_width=True,
    )


def _show(
    title: str,
    df: pd.DataFrame,
) -> None:

    st.markdown(
        f"#### {title}"
    )

    if (
        df is None
        or df.empty
    ):

        st.info(
            "No records found."
        )

        return

    safe = _mask_sensitive(
        df
    )

    st.dataframe(
        safe,
        use_container_width=True,
        hide_index=True,
    )

    _auditor_schema_download(
        title,
        safe,
    )


# Preserve the original all-history activity builder and scope
# its visible result to August 2026 onward.
_activity_feed_all_history = activity_feed


def activity_feed(
    limit: int = 300,
) -> pd.DataFrame:

    source = _activity_feed_all_history(
        5000
    )

    if source.empty:
        return source

    if "Timestamp" not in source.columns:
        return source.head(
            limit
        ).reset_index(
            drop=True
        )

    timestamps = pd.to_datetime(
        source["Timestamp"],
        errors="coerce",
        utc=True,
    )

    start = pd.Timestamp(
        AUDITOR_EVENT_WINDOW_START
    )

    source = source.loc[
        timestamps.ge(start)
    ].copy()

    return source.head(
        limit
    ).reset_index(
        drop=True
    )


def _auditor_request_id_series(
    df: pd.DataFrame,
) -> pd.Series:

    result = pd.Series(
        None,
        index=df.index,
        dtype="object",
    )

    for column in (
        "request_id",
        "purchase_request_id",
    ):

        if column not in df.columns:
            continue

        values = (
            df[column]
            .fillna("")
            .astype(str)
            .str.strip()
        )

        result = result.where(
            result.notna()
            & result.astype(str).ne(""),
            values,
        )

    if (
        "entity_id" in df.columns
        and "entity_type" in df.columns
    ):

        entity_type = (
            df["entity_type"]
            .fillna("")
            .astype(str)
            .str.casefold()
        )

        entity_id = (
            df["entity_id"]
            .fillna("")
            .astype(str)
            .str.strip()
        )

        request_mask = (
            entity_type.str.contains(
                "request",
                regex=False,
            )
            & result.fillna("")
            .astype(str)
            .str.strip()
            .eq("")
        )

        result.loc[
            request_mask
        ] = entity_id.loc[
            request_mask
        ]

    return (
        result
        .fillna("")
        .astype(str)
        .str.replace(
            r"\.0$",
            "",
            regex=True,
        )
        .str.strip()
    )


def _auditor_request_value(
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

        if str(
            value
        ).strip() in {
            "",
            "nan",
            "None",
        }:
            continue

        return value

    return ""


def _auditor_enrich_request_reference(
    df: pd.DataFrame,
) -> pd.DataFrame:

    if (
        df is None
        or df.empty
    ):

        return pd.DataFrame(
            columns=(
                []
                if df is None
                else df.columns
            )
        )

    result = df.copy()

    request_ids = _auditor_request_id_series(
        result
    )

    requests = _load_table(
        "purchase_requests",
        5000,
    )

    request_map = {}

    if (
        not requests.empty
        and "id" in requests.columns
    ):

        for _, row in requests.iterrows():

            key = str(
                row.get(
                    "id"
                )
            ).replace(
                ".0",
                "",
            ).strip()

            request_map[
                key
            ] = row

    request_no = []
    department = []
    category = []
    amount = []
    request_status = []
    requester = []

    for request_id in request_ids:

        request = request_map.get(
            str(
                request_id
            ),
        )

        if request is None:

            request_no.append("")
            department.append("")
            category.append("")
            amount.append("")
            request_status.append("")
            requester.append("")

            continue

        request_no.append(
            _auditor_request_value(
                request,
                (
                    "request_no",
                    "request_number",
                    "reference",
                ),
            )
        )

        department.append(
            _auditor_request_value(
                request,
                (
                    "department_project",
                    "department",
                    "project",
                ),
            )
        )

        category.append(
            _auditor_request_value(
                request,
                (
                    "category",
                    "request_category",
                ),
            )
        )

        amount.append(
            _auditor_request_value(
                request,
                (
                    "estimated_amount",
                    "approved_amount",
                    "amount",
                    "total_amount",
                ),
            )
        )

        request_status.append(
            _auditor_request_value(
                request,
                (
                    "status",
                ),
            )
        )

        requester.append(
            _auditor_request_value(
                request,
                (
                    "requested_by",
                    "created_by",
                    "requester_user_id",
                    "user_id",
                ),
            )
        )

    result.insert(
        0,
        "Request No",
        request_no,
    )

    result.insert(
        1,
        "Request ID",
        request_ids,
    )

    result.insert(
        2,
        "Department / Project",
        department,
    )

    result.insert(
        3,
        "Category",
        category,
    )

    result.insert(
        4,
        "Request Amount",
        amount,
    )

    result.insert(
        5,
        "Current Request Status",
        request_status,
    )

    result.insert(
        6,
        "Requester",
        requester,
    )

    return result


def render_enhanced_approval_trails() -> None:

    st.subheader(
        "Approval Trails"
    )

    st.caption(
        "Read-only approval evidence from 1 August 2026 onward. "
        "Each approval is linked to the exact procurement request "
        "where a request reference can be resolved."
    )

    history = _load_table(
        "approval_history",
        5000,
    )

    history = _auditor_filter_event_window(
        history
    )

    history = _auditor_enrich_request_reference(
        history
    )

    _show(
        "Approval History ? Request Linked",
        history,
    )

    rescissions = _load_table(
        "approval_rescissions",
        5000,
    )

    rescissions = _auditor_filter_event_window(
        rescissions
    )

    rescissions = _auditor_enrich_request_reference(
        rescissions
    )

    _show(
        "Approval Rescissions ? Request Linked",
        rescissions,
    )

    audit_rows = _load_table(
        "audit_events",
        5000,
    )

    audit_rows = _auditor_filter_event_window(
        audit_rows
    )

    if not audit_rows.empty:

        search_columns = [
            column
            for column in (
                "action",
                "event",
                "event_type",
                "status_before",
                "status_after",
                "reason",
                "details",
                "message",
            )
            if column in audit_rows.columns
        ]

        if search_columns:

            combined = (
                audit_rows[
                    search_columns
                ]
                .fillna("")
                .astype(str)
                .agg(
                    " ".join,
                    axis=1,
                )
                .str.casefold()
            )

            approval_mask = (
                combined.str.contains(
                    "approv",
                    regex=False,
                )
                | combined.str.contains(
                    "reject",
                    regex=False,
                )
                | combined.str.contains(
                    "rescind",
                    regex=False,
                )
            )

            audit_rows = audit_rows.loc[
                approval_mask
            ].copy()

    audit_rows = _auditor_enrich_request_reference(
        audit_rows
    )

    _show(
        "Approval Audit Events ? Request Linked",
        audit_rows,
    )


def render_schema_audit_page(
    title: str,
) -> None:

    st.subheader(
        title
    )

    tables = AUDITOR_SCHEMA_PAGES.get(
        title,
        (),
    )

    if not tables:

        st.warning(
            "No read-only schema mapping is configured "
            "for this Auditor page."
        )

        return

    if any(
        table in AUDITOR_EVENT_TABLES
        for table in tables
    ):

        st.caption(
            "Audit/activity event schemas are shown from "
            "1 August 2026 onward. Older evidence remains "
            "stored in the database."
        )

    else:

        st.caption(
            "Read-only evidence view. Sensitive values "
            "are masked before display and export."
        )

    for table in tables:

        df = _load_table(
            table,
            5000,
        )

        if table in AUDITOR_EVENT_TABLES:

            df = _auditor_filter_event_window(
                df
            )

        _show(
            table.replace(
                "_",
                " ",
            ).title(),
            df,
        )


def render_auditor_dashboard() -> None:

    st.subheader(
        "Audit & Compliance Command Centre"
    )

    st.caption(
        "Read-only oversight across ProcureFlow. "
        "Audit and activity event counts begin on "
        "1 August 2026; older evidence remains retained."
    )

    events = _auditor_filter_event_window(
        _load_table(
            "audit_events",
            5000,
        )
    )

    users = _load_table(
        "users",
        5000,
    )

    requests = _load_table(
        "purchase_requests",
        5000,
    )

    rescissions = _auditor_filter_event_window(
        _load_table(
            "approval_rescissions",
            5000,
        )
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

    c1, c2, c3, c4 = st.columns(
        4
    )

    c1.metric(
        "Audit Events Since 01 Aug",
        len(
            events
        ),
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
        "Approval Rescissions Since 01 Aug",
        len(
            rescissions
        ),
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
                    ROLE_PURPOSE[
                        role
                    ],

                "Mode":
                    "READ ONLY",
            }
            for role in ROLE_MIRRORS
        ]
    )

    _show(
        "Role Coverage",
        coverage,
    )

    feed = activity_feed(
        250
    )

    _show(
        "Activity Since 01 August 2026",
        feed,
    )

# ============================================================
# PROCUREFLOW_AUDITOR_EXPORT_BANK_REVEAL_V3
#
# Corrections:
# - Excel-safe timezone/value normalization
# - export failures do not crash the whole Auditor page
# - controlled Auditor reveal of encrypted payment bank details
# - reveal requires a reason and uses existing immutable access audit
# - only Account Name / Bank Name / Account Number are unmasked
# - revealed bank report supports Excel, CSV and PDF
# ============================================================

from services.payee_service import (
    audit_payee_reveal as _auditor_audit_payee_reveal,
)
from services.security_service import (
    decrypt_text as _auditor_decrypt_text,
)


AUDITOR_BANK_REVEAL_SECONDS = 300


def _auditor_value_present(value) -> bool:

    if value is None:
        return False

    try:
        missing = pd.isna(value)

        if (
            not hasattr(
                missing,
                "__len__",
            )
            and bool(missing)
        ):
            return False

    except Exception:
        pass

    return str(value).strip() not in {
        "",
        "None",
        "nan",
        "NaT",
    }


def _auditor_excel_safe_cell(value):

    from datetime import (
        date,
        datetime,
        timezone,
    )

    import re

    if value is None:
        return None

    try:
        missing = pd.isna(value)

        if (
            not hasattr(
                missing,
                "__len__",
            )
            and bool(missing)
        ):
            return None

    except Exception:
        pass

    if isinstance(
        value,
        pd.Timestamp,
    ):

        if pd.isna(
            value
        ):
            return None

        if value.tzinfo is not None:

            value = (
                value
                .tz_convert(
                    "UTC"
                )
                .tz_localize(
                    None
                )
            )

        return value.to_pydatetime()

    if isinstance(
        value,
        datetime,
    ):

        if (
            value.tzinfo is not None
            and value.utcoffset()
            is not None
        ):

            value = (
                value
                .astimezone(
                    timezone.utc
                )
                .replace(
                    tzinfo=None
                )
            )

        return value

    if isinstance(
        value,
        date,
    ):
        return value

    if isinstance(
        value,
        (
            dict,
            list,
            tuple,
            set,
        ),
    ):

        return json.dumps(
            value,
            ensure_ascii=False,
            default=str,
        )

    if isinstance(
        value,
        bytes,
    ):

        return value.hex()

    if isinstance(
        value,
        str,
    ):

        # Excel/openpyxl rejects several control characters.
        return re.sub(
            r"[\x00-\x08\x0B\x0C\x0E-\x1F]",
            "",
            value,
        )

    return value


def _auditor_excel_safe_dataframe(
    df: pd.DataFrame,
) -> pd.DataFrame:

    if df is None:
        return pd.DataFrame()

    safe = df.copy()

    for column in safe.columns:

        safe[column] = safe[
            column
        ].map(
            _auditor_excel_safe_cell
        )

    return safe


# V3 override of the V2 Excel generator.
def _auditor_excel_bytes(
    df: pd.DataFrame,
) -> bytes:

    from io import BytesIO

    safe = _auditor_excel_safe_dataframe(
        df
    )

    out = BytesIO()

    with pd.ExcelWriter(
        out,
        engine="openpyxl",
    ) as writer:

        safe.to_excel(
            writer,
            index=False,
            sheet_name="Audit Data",
        )

    return out.getvalue()


def _auditor_download_surface(
    title: str,
    df: pd.DataFrame,
    *,
    mask: bool,
    namespace: str,
) -> None:

    if (
        df is None
        or df.empty
    ):
        return

    if mask:
        export_df = _mask_sensitive(
            df
        )
    else:
        export_df = df.copy()

    key = _auditor_export_key(
        (
            f"{namespace}:"
            f"{title}"
        ),
        export_df,
    )

    filename = _auditor_safe_filename(
        title
    )

    choice = st.selectbox(
        f"Export {title}",
        [
            "Excel (.xlsx)",
            "CSV (.csv)",
            "PDF (.pdf)",
        ],
        key=(
            f"auditor_v3_export_format_"
            f"{namespace}_{key}"
        ),
        label_visibility="collapsed",
    )

    try:

        if choice.startswith(
            "Excel"
        ):

            payload = _auditor_excel_bytes(
                export_df
            )

            extension = "xlsx"

            mime = (
                "application/vnd.openxmlformats-officedocument."
                "spreadsheetml.sheet"
            )

        elif choice.startswith(
            "CSV"
        ):

            payload = export_df.to_csv(
                index=False
            ).encode(
                "utf-8-sig"
            )

            extension = "csv"

            mime = "text/csv"

        else:

            payload = _auditor_pdf_bytes(
                export_df,
                title,
            )

            extension = "pdf"

            mime = "application/pdf"

    except Exception:

        # Never allow preparation of one optional export format
        # to take down the entire Auditor page.
        st.error(
            (
                f"Could not prepare the {choice} export. "
                "The audit records remain available on screen; "
                "choose another format or contact Admin."
            )
        )

        return

    st.download_button(
        (
            f"Download {title} "
            f"{extension.upper()}"
        ),
        data=payload,
        file_name=(
            f"{filename}.{extension}"
        ),
        mime=mime,
        key=(
            f"auditor_v3_export_"
            f"{namespace}_{key}_{extension}"
        ),
        use_container_width=True,
    )


# V3 override used by every ordinary Auditor _show() surface.
# Normal audit schemas remain masked.
def _auditor_schema_download(
    title: str,
    df: pd.DataFrame,
) -> None:

    _auditor_download_surface(
        title,
        df,
        mask=True,
        namespace="masked",
    )


def _auditor_id_text(
    value,
) -> str:

    if not _auditor_value_present(
        value
    ):
        return ""

    text = str(
        value
    ).strip()

    if (
        text.endswith(
            ".0"
        )
        and text[
            :-2
        ].isdigit()
    ):

        text = text[
            :-2
        ]

    return text


def _auditor_request_number_map() -> dict[str, str]:

    requests = _load_table(
        "purchase_requests",
        5000,
    )

    result = {}

    if (
        requests.empty
        or "id" not in requests.columns
    ):
        return result

    for _, row in requests.iterrows():

        request_id = _auditor_id_text(
            row.get(
                "id"
            )
        )

        if not request_id:
            continue

        request_no = str(
            row.get(
                "request_no"
            )
            or (
                f"Request #{request_id}"
            )
        )

        result[
            request_id
        ] = request_no

    return result


def _auditor_decrypted_bank_frame(
    row: pd.Series,
    request_no: str,
) -> pd.DataFrame:

    def reveal_field(
        field: str,
    ) -> str:

        encrypted_column = (
            f"{field}_encrypted"
        )

        encrypted = row.get(
            encrypted_column
        )

        if _auditor_value_present(
            encrypted
        ):

            value = _auditor_decrypt_text(
                str(
                    encrypted
                )
            )

            return str(
                value
                or ""
            )

        # Compatibility fallback for older records that may use
        # an already-readable field instead of the encrypted one.
        value = row.get(
            field
        )

        if _auditor_value_present(
            value
        ):
            return str(
                value
            )

        return ""

    record = {
        "Request No":
            request_no,

        "Request ID":
            _auditor_id_text(
                row.get(
                    "purchase_request_id"
                )
            ),

        "Payee Detail ID":
            _auditor_id_text(
                row.get(
                    "id"
                )
            ),

        "Account Name":
            reveal_field(
                "account_name"
            ),

        "Bank Name":
            reveal_field(
                "bank_name"
            ),

        "Account Number":
            reveal_field(
                "account_number"
            ),

        "Currency":
            str(
                row.get(
                    "currency"
                )
                or ""
            ),

        "Verification Status":
            str(
                row.get(
                    "verification_status"
                )
                or ""
            ),

        "Payment Readiness":
            str(
                row.get(
                    "payment_readiness_status"
                )
                or row.get(
                    "payment_readiness"
                )
                or ""
            ),

        "Created At":
            row.get(
                "created_at"
            ),

        "Updated At":
            row.get(
                "updated_at"
            ),
    }

    return pd.DataFrame(
        [
            record
        ]
    )


def _auditor_bank_detail_reveal_panel() -> None:

    import time

    st.markdown(
        "### Controlled Bank Detail Reveal"
    )

    st.warning(
        (
            "Confidential payment information. "
            "Revealing bank details requires an audit reason. "
            "The reveal is available for five minutes in this "
            "Auditor session and does not modify procurement records."
        )
    )

    actor = (
        st.session_state.get(
            "user"
        )
        or {}
    )

    actor_role = str(
        actor.get(
            "role"
        )
        or ""
    )

    if actor_role != "Auditor":

        st.error(
            "Only the Auditor role may use this audit reveal surface."
        )

        return

    try:
        actor_user_id = int(
            actor.get(
                "id"
            )
            or 0
        )
    except Exception:
        actor_user_id = 0

    if actor_user_id <= 0:

        st.error(
            "The current Auditor session has no valid user identifier."
        )

        return

    payees = _load_table(
        "payment_payee_details",
        5000,
    )

    if (
        payees.empty
        or "id" not in payees.columns
    ):

        st.info(
            "No payment payee detail records are available."
        )

        return

    request_numbers = (
        _auditor_request_number_map()
    )

    labels = []

    id_by_label = {}

    for _, row in payees.iterrows():

        payee_id = _auditor_id_text(
            row.get(
                "id"
            )
        )

        if not payee_id:
            continue

        request_id = _auditor_id_text(
            row.get(
                "purchase_request_id"
            )
        )

        request_no = request_numbers.get(
            request_id,
            (
                f"Request #{request_id}"
                if request_id
                else "Unlinked Request"
            ),
        )

        verification = str(
            row.get(
                "verification_status"
            )
            or "Unknown"
        )

        label = (
            f"{request_no} ? "
            f"Payee Detail #{payee_id} ? "
            f"{verification}"
        )

        labels.append(
            label
        )

        id_by_label[
            label
        ] = payee_id

    if not labels:

        st.info(
            "No selectable payee detail records were found."
        )

        return

    selected_label = st.selectbox(
        "Payment payee record",
        labels,
        key="auditor_v3_bank_record",
    )

    selected_id = id_by_label[
        selected_label
    ]

    selected_rows = payees[
        payees[
            "id"
        ]
        .astype(str)
        .str.replace(
            r"\.0$",
            "",
            regex=True,
        )
        .eq(
            selected_id
        )
    ]

    if selected_rows.empty:

        st.error(
            "The selected payee record could not be loaded."
        )

        return

    selected_row = (
        selected_rows.iloc[
            0
        ]
    )

    request_id = _auditor_id_text(
        selected_row.get(
            "purchase_request_id"
        )
    )

    request_no = request_numbers.get(
        request_id,
        (
            f"Request #{request_id}"
            if request_id
            else "Unlinked Request"
        ),
    )

    reason = st.text_area(
        "Reason for revealing bank details",
        placeholder=(
            "Example: Reviewing payment evidence for "
            "internal audit case AUD-2026-..."
        ),
        key=(
            f"auditor_v3_bank_reason_"
            f"{selected_id}"
        ),
    )

    reveal_state_key = (
        "auditor_v3_bank_reveal"
    )

    state = (
        st.session_state.get(
            reveal_state_key
        )
        or {}
    )

    expires_at = float(
        state.get(
            "expires_at"
        )
        or 0
    )

    if (
        state
        and time.time()
        >= expires_at
    ):

        st.session_state.pop(
            reveal_state_key,
            None,
        )

        state = {}

        st.info(
            "The previous bank-detail reveal has expired."
        )

    reveal_clicked = st.button(
        "Reveal Bank Details for 5 Minutes",
        type="primary",
        disabled=not reason.strip(),
        key=(
            f"auditor_v3_reveal_bank_"
            f"{selected_id}"
        ),
    )

    if reveal_clicked:

        try:

            # Prove decryption succeeds before recording a
            # successful reveal event.
            _auditor_decrypted_bank_frame(
                selected_row,
                request_no,
            )

            _auditor_audit_payee_reveal(
                int(
                    selected_id
                ),
                actor_user_id,
                actor_role,
                reason.strip(),
            )

        except Exception:

            st.error(
                (
                    "Bank details could not be securely revealed. "
                    "No confidential values were displayed."
                )
            )

            return

        st.session_state[
            reveal_state_key
        ] = {
            "payee_id":
                selected_id,

            "expires_at":
                time.time()
                + AUDITOR_BANK_REVEAL_SECONDS,
        }

        st.rerun()

    state = (
        st.session_state.get(
            reveal_state_key
        )
        or {}
    )

    reveal_active = (
        str(
            state.get(
                "payee_id"
            )
            or ""
        )
        == selected_id
        and time.time()
        < float(
            state.get(
                "expires_at"
            )
            or 0
        )
    )

    if not reveal_active:
        return

    try:

        revealed = (
            _auditor_decrypted_bank_frame(
                selected_row,
                request_no,
            )
        )

    except Exception:

        st.session_state.pop(
            reveal_state_key,
            None,
        )

        st.error(
            (
                "The encrypted bank information could not "
                "be decrypted with the active application key."
            )
        )

        return

    remaining_seconds = max(
        0,
        int(
            float(
                state[
                    "expires_at"
                ]
            )
            - time.time()
        ),
    )

    st.success(
        (
            "Authorized bank details revealed. "
            f"This view expires in about {remaining_seconds} seconds."
        )
    )

    st.dataframe(
        revealed,
        use_container_width=True,
        hide_index=True,
    )

    _auditor_download_surface(
        (
            f"{request_no} "
            "Bank Details"
        ),
        revealed,
        mask=False,
        namespace=(
            f"revealed_bank_"
            f"{selected_id}"
        ),
    )

    if st.button(
        "Hide Bank Details Now",
        key=(
            f"auditor_v3_hide_bank_"
            f"{selected_id}"
        ),
    ):

        st.session_state.pop(
            reveal_state_key,
            None,
        )

        st.rerun()


# Preserve the V2 schema renderer, then extend only the dedicated
# Payment Payee / Bank Detail Access Audit page.
_render_schema_audit_page_v2 = (
    render_schema_audit_page
)


def render_schema_audit_page(
    title: str,
) -> None:

    _render_schema_audit_page_v2(
        title
    )

    if (
        title
        == "Payment Payee / Bank Detail Access Audit"
    ):

        st.divider()

        _auditor_bank_detail_reveal_panel()

# ============================================================
# PROCUREFLOW_AUDITOR_DOWNLOAD_REVEAL_UX_V4
#
# - Download buttons do not rerun/navigation-race the app.
# - Download payload signatures are validated.
# - Bank detail controls appear before the long audit tables.
# - Masked bank fields are always visibly presented.
# - Reveal duration reduced to 60 seconds.
# - Active reveal automatically refreshes until expiry.
# ============================================================


AUDITOR_BANK_REVEAL_SECONDS = 60


def _auditor_validate_download_payload(
    payload,
    extension: str,
) -> bytes:

    if isinstance(
        payload,
        bytearray,
    ):
        payload = bytes(
            payload
        )

    if not isinstance(
        payload,
        bytes,
    ):
        raise ValueError(
            "Download payload is not binary data."
        )

    if not payload:
        raise ValueError(
            "Download payload is empty."
        )

    ext = str(
        extension
    ).lower()

    if (
        ext == "xlsx"
        and not payload.startswith(
            b"PK"
        )
    ):
        raise ValueError(
            "Excel payload signature is invalid."
        )

    if (
        ext == "pdf"
        and not payload.startswith(
            b"%PDF"
        )
    ):
        raise ValueError(
            "PDF payload signature is invalid."
        )

    # Do not allow an HTML application/error page to be
    # accidentally presented as CSV data.
    if ext == "csv":

        head = (
            payload[
                :512
            ]
            .lstrip()
            .lower()
        )

        if (
            head.startswith(
                b"<!doctype html"
            )
            or head.startswith(
                b"<html"
            )
        ):
            raise ValueError(
                "CSV payload unexpectedly contains HTML."
            )

    return payload


def _auditor_download_surface(
    title: str,
    df: pd.DataFrame,
    *,
    mask: bool,
    namespace: str,
) -> None:

    if (
        df is None
        or df.empty
    ):
        return

    export_df = (
        _mask_sensitive(
            df
        )
        if mask
        else df.copy()
    )

    key = _auditor_export_key(
        f"{namespace}:{title}",
        export_df,
    )

    filename = _auditor_safe_filename(
        title
    )

    choice = st.selectbox(
        f"Export {title}",
        [
            "Excel (.xlsx)",
            "CSV (.csv)",
            "PDF (.pdf)",
        ],
        key=(
            "auditor_v4_export_format_"
            + namespace
            + "_"
            + key
        ),
        label_visibility="collapsed",
    )

    try:

        if choice.startswith(
            "Excel"
        ):

            extension = "xlsx"

            payload = (
                _auditor_excel_bytes(
                    export_df
                )
            )

            mime = (
                "application/vnd.openxmlformats-officedocument."
                "spreadsheetml.sheet"
            )

        elif choice.startswith(
            "CSV"
        ):

            extension = "csv"

            payload = (
                export_df
                .to_csv(
                    index=False
                )
                .encode(
                    "utf-8-sig"
                )
            )

            mime = "text/csv"

        else:

            extension = "pdf"

            payload = (
                _auditor_pdf_bytes(
                    export_df,
                    title,
                )
            )

            mime = "application/pdf"

        payload = (
            _auditor_validate_download_payload(
                payload,
                extension,
            )
        )

    except Exception:

        st.error(
            (
                f"Could not prepare the {choice} file. "
                "No HTML or invalid download was returned."
            )
        )

        return

    st.download_button(
        label=(
            f"Download {title} "
            f"{extension.upper()}"
        ),
        data=payload,
        file_name=(
            f"{filename}.{extension}"
        ),
        mime=mime,
        key=(
            "auditor_v4_download_"
            + namespace
            + "_"
            + key
            + "_"
            + extension
        ),
        on_click="ignore",
        width="stretch",
    )


def _auditor_masked_bank_preview(
    row: pd.Series,
    request_no: str,
) -> None:

    request_id = _auditor_id_text(
        row.get(
            "purchase_request_id"
        )
    )

    payee_id = _auditor_id_text(
        row.get(
            "id"
        )
    )

    preview = pd.DataFrame(
        [
            {
                "Request No":
                    request_no,

                "Request ID":
                    request_id,

                "Payee Detail ID":
                    payee_id,

                "Account Name":
                    "????????",

                "Bank Name":
                    "????????",

                "Account Number":
                    "????????",

                "Currency":
                    str(
                        row.get(
                            "currency"
                        )
                        or ""
                    ),

                "Verification Status":
                    str(
                        row.get(
                            "verification_status"
                        )
                        or ""
                    ),
            }
        ]
    )

    st.markdown(
        "#### Bank Details ? Masked by Default"
    )

    st.caption(
        (
            "Sensitive banking values remain hidden until "
            "the Auditor provides a reason and explicitly reveals them."
        )
    )

    st.dataframe(
        preview,
        use_container_width=True,
        hide_index=True,
    )


def _auditor_bank_detail_reveal_panel() -> None:

    import time

    st.markdown(
        "### Payment Bank Detail Review"
    )

    actor = (
        st.session_state.get(
            "user"
        )
        or {}
    )

    actor_role = str(
        actor.get(
            "role"
        )
        or ""
    )

    if actor_role != "Auditor":

        st.error(
            "Only the Auditor role can access this review surface."
        )

        return

    try:

        actor_user_id = int(
            actor.get(
                "id"
            )
            or 0
        )

    except Exception:

        actor_user_id = 0

    if actor_user_id <= 0:

        st.error(
            "The current Auditor session is invalid."
        )

        return

    payees = _load_table(
        "payment_payee_details",
        5000,
    )

    if (
        payees.empty
        or "id" not in payees.columns
    ):

        st.info(
            "No payment payee details are available."
        )

        return

    request_numbers = (
        _auditor_request_number_map()
    )

    labels = []

    ids = {}

    for _, row in payees.iterrows():

        payee_id = _auditor_id_text(
            row.get(
                "id"
            )
        )

        if not payee_id:
            continue

        request_id = _auditor_id_text(
            row.get(
                "purchase_request_id"
            )
        )

        request_no = (
            request_numbers.get(
                request_id,
                (
                    f"Request #{request_id}"
                    if request_id
                    else "Unlinked Request"
                ),
            )
        )

        label = (
            f"{request_no} ? "
            f"Payee Detail #{payee_id}"
        )

        labels.append(
            label
        )

        ids[
            label
        ] = payee_id

    if not labels:

        st.info(
            "No selectable payee details were found."
        )

        return

    selected_label = st.selectbox(
        "Select payment bank record",
        labels,
        key="auditor_v4_bank_record",
    )

    selected_id = ids[
        selected_label
    ]

    matching = payees[
        payees[
            "id"
        ]
        .astype(str)
        .str.replace(
            r"\.0$",
            "",
            regex=True,
        )
        .eq(
            selected_id
        )
    ]

    if matching.empty:

        st.error(
            "The selected bank record could not be loaded."
        )

        return

    row = matching.iloc[
        0
    ]

    request_id = _auditor_id_text(
        row.get(
            "purchase_request_id"
        )
    )

    request_no = request_numbers.get(
        request_id,
        (
            f"Request #{request_id}"
            if request_id
            else "Unlinked Request"
        ),
    )

    _auditor_masked_bank_preview(
        row,
        request_no,
    )

    state_key = (
        "auditor_v4_bank_reveal"
    )

    state = (
        st.session_state.get(
            state_key
        )
        or {}
    )

    expires_at = float(
        state.get(
            "expires_at"
        )
        or 0
    )

    now = time.time()

    if (
        state
        and now >= expires_at
    ):

        st.session_state.pop(
            state_key,
            None,
        )

        state = {}

        st.info(
            "Unmasked bank details have been automatically hidden."
        )

    reason = st.text_area(
        "Reason for viewing unmasked bank details",
        placeholder=(
            "Enter the audit purpose for accessing this payment record."
        ),
        key=(
            "auditor_v4_bank_reason_"
            + selected_id
        ),
    )

    if st.button(
        "Reveal Unmasked Bank Details",
        type="primary",
        disabled=not reason.strip(),
        key=(
            "auditor_v4_bank_reveal_button_"
            + selected_id
        ),
    ):

        try:

            revealed = (
                _auditor_decrypted_bank_frame(
                    row,
                    request_no,
                )
            )

            _auditor_audit_payee_reveal(
                int(
                    selected_id
                ),
                actor_user_id,
                actor_role,
                reason.strip(),
            )

        except Exception:

            st.error(
                (
                    "The bank details could not be securely revealed. "
                    "No unmasked values were displayed."
                )
            )

            return

        st.session_state[
            state_key
        ] = {
            "payee_id":
                selected_id,

            "expires_at":
                time.time()
                + AUDITOR_BANK_REVEAL_SECONDS,
        }

        st.rerun()

    state = (
        st.session_state.get(
            state_key
        )
        or {}
    )

    active = (
        str(
            state.get(
                "payee_id"
            )
            or ""
        )
        == selected_id
        and time.time()
        < float(
            state.get(
                "expires_at"
            )
            or 0
        )
    )

    if not active:
        return

    # Force lightweight reruns while confidential data is visible
    # so expiry does not depend on the user clicking another control.
    try:

        from streamlit_autorefresh import (
            st_autorefresh,
        )

        st_autorefresh(
            interval=10000,
            key=(
                "auditor_v4_bank_expiry_"
                + selected_id
            ),
        )

    except Exception:

        pass

    remaining = max(
        0,
        int(
            float(
                state[
                    "expires_at"
                ]
            )
            - time.time()
        ),
    )

    try:

        revealed = (
            _auditor_decrypted_bank_frame(
                row,
                request_no,
            )
        )

    except Exception:

        st.session_state.pop(
            state_key,
            None,
        )

        st.error(
            "The encrypted bank details could not be decrypted."
        )

        return

    st.success(
        (
            "Unmasked bank details are visible. "
            f"They will be hidden automatically in {remaining} seconds."
        )
    )

    st.dataframe(
        revealed,
        use_container_width=True,
        hide_index=True,
    )

    _auditor_download_surface(
        f"{request_no} Bank Details",
        revealed,
        mask=False,
        namespace=(
            "unmasked_bank_"
            + selected_id
        ),
    )

    if st.button(
        "Hide Bank Details Now",
        key=(
            "auditor_v4_hide_bank_"
            + selected_id
        ),
    ):

        st.session_state.pop(
            state_key,
            None,
        )

        st.rerun()


# Put the bank review controls at the TOP of the dedicated page.
# The V3 alias still points to the original V2 generic renderer.
def render_schema_audit_page(
    title: str,
) -> None:

    if (
        title
        == "Payment Payee / Bank Detail Access Audit"
    ):

        _auditor_bank_detail_reveal_panel()

        st.divider()

    _render_schema_audit_page_v2(
        title
    )
