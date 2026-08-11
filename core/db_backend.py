"""Database backend abstraction for ProcureFlow.

The application historically used ``sqlite3`` directly and therefore has a
large, proven body of qmark-parameterized SQL.  This module preserves that
public contract while adding a pooled PostgreSQL implementation suitable for
Google Cloud SQL.  It intentionally exposes a small DB-API compatible wrapper
instead of introducing a second ORM/query layer into the existing codebase.
"""
from __future__ import annotations

import atexit
import json
import os
import re
import threading
import time
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any


_POSTGRES_SCHEMES = ("postgres://", "postgresql://", "postgresql+psycopg://")


def database_url() -> str:
    """Return the configured production database URL, if present."""
    return (
        os.environ.get("PROCUREFLOW_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or ""
    ).strip()


def database_backend() -> str:
    explicit = os.environ.get("PROCUREFLOW_DATABASE_BACKEND", "").strip().lower()
    if explicit in {"postgres", "postgresql", "cloudsql"}:
        return "postgresql"
    if explicit == "sqlite":
        return "sqlite"
    url = database_url().lower()
    if url.startswith(_POSTGRES_SCHEMES):
        return "postgresql"
    if os.environ.get("INSTANCE_CONNECTION_NAME") or os.environ.get("CLOUD_SQL_CONNECTION_NAME"):
        return "postgresql"
    return "sqlite"


def is_postgres() -> bool:
    return database_backend() == "postgresql"


def is_sqlite() -> bool:
    return not is_postgres()


def _cloud_sql_dsn() -> str:
    """Build a psycopg connection string for Cloud Run's Cloud SQL socket.

    Cloud Run mounts the official Cloud SQL Auth Proxy socket at
    ``/cloudsql/INSTANCE_CONNECTION_NAME``.  The connection remains protected
    by IAM/service-account controls while credentials are supplied through
    Secret Manager-backed environment variables.
    """
    instance = (
        os.environ.get("INSTANCE_CONNECTION_NAME")
        or os.environ.get("CLOUD_SQL_CONNECTION_NAME")
        or ""
    ).strip()
    db_name = (os.environ.get("PROCUREFLOW_DB_NAME") or os.environ.get("DB_NAME") or "procureflow").strip()
    db_user = (os.environ.get("PROCUREFLOW_DB_USER") or os.environ.get("DB_USER") or "").strip()
    db_password = os.environ.get("PROCUREFLOW_DB_PASSWORD") or os.environ.get("DB_PASSWORD") or ""
    if not instance:
        raise RuntimeError("Cloud SQL connection name is not configured.")
    if not db_user:
        raise RuntimeError("Cloud SQL database user is not configured.")
    # psycopg's keyword DSN avoids URL escaping errors for generated passwords.
    return " ".join(
        [
            f"dbname={_quote_dsn_value(db_name)}",
            f"user={_quote_dsn_value(db_user)}",
            f"password={_quote_dsn_value(db_password)}",
            f"host={_quote_dsn_value('/cloudsql/' + instance)}",
            f"connect_timeout={int(os.environ.get('PROCUREFLOW_DB_CONNECT_TIMEOUT_SECONDS', '10'))}",
            "application_name=procureflow",
        ]
    )


def _quote_dsn_value(value: str) -> str:
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def postgres_dsn() -> str:
    url = database_url()
    if url:
        if url.startswith("postgresql+psycopg://"):
            return "postgresql://" + url[len("postgresql+psycopg://") :]
        if url.startswith("postgres://"):
            return "postgresql://" + url[len("postgres://") :]
        return url
    return _cloud_sql_dsn()


class CompatRow(Mapping[str, Any]):
    """A row that supports both sqlite-style numeric and named access."""

    __slots__ = ("_columns", "_values", "_index")

    def __init__(self, columns: Sequence[str], values: Sequence[Any]):
        self._columns = tuple(columns)
        self._values = tuple(_normalize_db_value(value) for value in values)
        self._index = {name: idx for idx, name in enumerate(self._columns)}

    def __getitem__(self, key: str | int | slice) -> Any:
        if isinstance(key, (int, slice)):
            return self._values[key]
        return self._values[self._index[key]]

    def __iter__(self) -> Iterator[str]:
        return iter(self._columns)

    def __len__(self) -> int:
        return len(self._values)

    def keys(self):  # sqlite3.Row compatibility
        return self._columns

    def values(self):
        return self._values

    def items(self):
        return zip(self._columns, self._values)

    def __repr__(self) -> str:
        return f"CompatRow({dict(self)!r})"


def _normalize_db_value(value: Any) -> Any:
    # SQLite historically returned JSON columns as strings.  PostgreSQL's
    # adapter returns dict/list for JSONB; serializing keeps all existing code
    # and audit canonicalization behaviour backward compatible.
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return value


_QMARK_RE = re.compile(r"\?")
_DATETIME_RE = re.compile(r"\bdatetime\(([^()]+)\)", re.IGNORECASE)
_DATE_RE = re.compile(r"\bdate\(([^()]+)\)", re.IGNORECASE)
_GROUP_CONCAT_RE = re.compile(
    r"\bGROUP_CONCAT\(\s*([^,()]+(?:\([^)]*\))?)\s*,\s*([^)]*)\)",
    re.IGNORECASE,
)


def _escape_pyformat_percent_literals(sql: str) -> str:
    """Escape literal percent signs for psycopg's pyformat parser.

    ``qmark_to_pyformat`` creates ``%s`` placeholders. Any other single
    percent sign must be doubled when parameters are passed to psycopg, even
    when it appears inside a quoted LIKE pattern. Existing ``%%`` escapes and
    psycopg's supported ``%s``/``%b``/``%t`` placeholders are preserved.
    """
    out: list[str] = []
    i = 0
    while i < len(sql):
        ch = sql[i]
        if ch != "%":
            out.append(ch)
            i += 1
            continue
        nxt = sql[i + 1] if i + 1 < len(sql) else ""
        if nxt in {"%", "s", "b", "t"}:
            out.extend([ch, nxt])
            i += 2
            continue
        out.append("%%")
        i += 1
    return "".join(out)


def qmark_to_pyformat(sql: str) -> str:
    """Translate DB-API qmark placeholders without touching quoted text."""
    out: list[str] = []
    i = 0
    quote: str | None = None
    line_comment = False
    block_comment = False
    dollar_tag: str | None = None
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""
        if line_comment:
            out.append(ch)
            if ch == "\n":
                line_comment = False
            i += 1
            continue
        if block_comment:
            out.append(ch)
            if ch == "*" and nxt == "/":
                out.append(nxt)
                i += 2
                block_comment = False
            else:
                i += 1
            continue
        if dollar_tag:
            if sql.startswith(dollar_tag, i):
                out.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
            else:
                out.append(ch)
                i += 1
            continue
        if quote:
            out.append(ch)
            if ch == quote:
                if nxt == quote:  # escaped SQL quote
                    out.append(nxt)
                    i += 2
                    continue
                quote = None
            elif ch == "\\" and nxt:
                out.append(nxt)
                i += 2
                continue
            i += 1
            continue
        if ch == "-" and nxt == "-":
            out.extend([ch, nxt]); i += 2; line_comment = True; continue
        if ch == "/" and nxt == "*":
            out.extend([ch, nxt]); i += 2; block_comment = True; continue
        if ch in {"'", '"'}:
            quote = ch; out.append(ch); i += 1; continue
        if ch == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", sql[i:])
            if match:
                dollar_tag = match.group(0)
                out.append(dollar_tag)
                i += len(dollar_tag)
                continue
        if ch == "?":
            out.append("%s")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


# Columns represented as BOOLEAN in PostgreSQL.  The application historically
# supplied 0/1 values, so the compatibility layer converts those values for
# inserts/updates/filters before psycopg adaptation.
BOOLEAN_COLUMNS: dict[str, set[str]] = {
    "users": {"must_change_password", "is_active", "account_locked"},
    "vendors": set(),
    "approval_rules": {"requires_sourcing", "requires_finance", "is_active", "pm_fallback_enabled", "finance_required", "sourcing_required"},
    "approval_delegations": {"enabled"},
    "budgets": {"override_required"},
    "purchase_requests": {"delegated_approval_allowed"},
    "vendor_quotes": {"is_recommended", "is_selected"},
    "notifications": {"is_read", "popup_shown", "push_sent", "email_sent", "attention_counted"},
    "notification_settings": {"email_enabled", "in_app_enabled"},
    "notification_preferences": {"in_app_enabled", "browser_push_enabled", "email_enabled", "important_only", "approval_notifications", "gateway_pass_notifications", "finance_notifications", "delegation_notifications"},
    "push_subscriptions": {"is_active"},
    "expenses": {"duplicate_warning"},
    "receipt_records": {"duplicate_warning"},
    "imported_legacy_documents": {"duplicate_warning"},
    "document_ocr_attempts": {"success"},
    "payment_payee_details": {"recipient_known", "is_current"},
    "logistics_exceptions": {"payment_impact"},
}

JSON_COLUMNS: dict[str, set[str]] = {
    "annual_budgets": {"distribution_json"},
    "audit_chain_verifications": {"invalid_event_ids_json"},
    "audit_events": {"before_values_redacted_json", "after_values_redacted_json", "metadata_redacted_json", "canonical_payload_json"},
    "audit_logs": {"before_values", "after_values"},
    "budget_history": {"before_values", "after_values"},
    "imported_legacy_documents": {"parsed_json"},
    "expenses": {"ocr_json"},
    "invoices": {"ocr_json"},
    "parsed_document_line_items": {"raw_json"},
    "payment_payee_detail_versions": {"values_redacted_json"},
    "purchase_orders": {"attachments_json"},
    "purchase_requests": {"attachments_json", "approval_history_json"},
    "quote_comparisons": {"scoring_json"},
    "receipt_document_versions": {"original_ocr_json", "corrected_ocr_json"},
    "receipt_records": {"ocr_json", "original_ocr_json", "corrected_ocr_json", "cash_denominations"},
    "vendors": {"documents_json"},
}



def _coerce_bool(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if value in (0, "0", "false", "False", "FALSE", "no", "No"):
        return False
    if value in (1, "1", "true", "True", "TRUE", "yes", "Yes"):
        return True
    return value


def _coerce_jsonb(value: Any) -> Any:
    if value is None:
        return None
    parsed = value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            parsed = value
    try:
        from psycopg.types.json import Jsonb
        return Jsonb(parsed)
    except ImportError:  # pragma: no cover - psycopg is present in PostgreSQL deployments
        return parsed


def _coerce_boolean_params(sql: str, params: Sequence[Any]) -> tuple[Any, ...]:
    if not params:
        return tuple(params)
    values = list(params)
    upper = sql.lstrip().upper()
    table_match = re.search(r"\b(?:INSERT\s+(?:OR\s+IGNORE\s+)?INTO|UPDATE|FROM|JOIN)\s+\"?([A-Za-z_][A-Za-z0-9_]*)\"?", sql, re.IGNORECASE)
    table = table_match.group(1).lower() if table_match else ""
    bool_cols = BOOLEAN_COLUMNS.get(table, set())
    json_cols = JSON_COLUMNS.get(table, set())
    if not bool_cols and not json_cols:
        # SELECTs can reference several tables.  Coerce parameters for explicit
        # boolean-column comparisons regardless of the leading table.
        for idx, match in enumerate(re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?", sql, re.IGNORECASE)):
            if idx < len(values) and match.group(1).lower() in {c.lower() for cols in BOOLEAN_COLUMNS.values() for c in cols}:
                values[idx] = _coerce_bool(values[idx])
        return tuple(values)

    if upper.startswith("INSERT"):
        match = re.search(r"INTO\s+\"?[A-Za-z_][A-Za-z0-9_]*\"?\s*\((.*?)\)\s*VALUES\s*\((.*?)\)", sql, re.IGNORECASE | re.DOTALL)
        if match:
            columns = [c.strip().strip('"').lower() for c in match.group(1).split(",")]
            value_tokens = _split_sql_csv(match.group(2))
            param_index = 0
            for col, token in zip(columns, value_tokens):
                placeholders = token.count("?")
                if placeholders and col in {c.lower() for c in bool_cols}:
                    values[param_index] = _coerce_bool(values[param_index])
                if placeholders and col in {c.lower() for c in json_cols}:
                    values[param_index] = _coerce_jsonb(values[param_index])
                param_index += placeholders
            return tuple(values)
    if upper.startswith("UPDATE"):
        set_part = re.split(r"\bWHERE\b", sql, maxsplit=1, flags=re.IGNORECASE)[0]
        param_index = 0
        for assignment in _split_sql_csv(re.split(r"\bSET\b", set_part, maxsplit=1, flags=re.IGNORECASE)[1]):
            col = assignment.split("=", 1)[0].strip().strip('"').lower()
            placeholders = assignment.count("?")
            if placeholders and col in {c.lower() for c in bool_cols}:
                values[param_index] = _coerce_bool(values[param_index])
            if placeholders and col in {c.lower() for c in json_cols}:
                values[param_index] = _coerce_jsonb(values[param_index])
            param_index += placeholders
        # Remaining WHERE parameters.
        where_part = re.split(r"\bWHERE\b", sql, maxsplit=1, flags=re.IGNORECASE)
        if len(where_part) == 2:
            for match in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?", where_part[1], re.IGNORECASE):
                if param_index < len(values) and match.group(1).lower() in {c.lower() for c in bool_cols}:
                    values[param_index] = _coerce_bool(values[param_index])
                param_index += 1
        return tuple(values)
    # SELECT / DELETE filters.
    param_index = 0
    for match in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|<>|!=)\s*\?", sql, re.IGNORECASE):
        if param_index < len(values) and match.group(1).lower() in {c.lower() for c in bool_cols}:
            values[param_index] = _coerce_bool(values[param_index])
        param_index += 1
    return tuple(values)


def _split_sql_csv(value: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    depth = 0
    quote: str | None = None
    for ch in value:
        if quote:
            current.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in {"'", '"'}:
            quote = ch; current.append(ch); continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append("".join(current).strip()); current = []
        else:
            current.append(ch)
    if current:
        parts.append("".join(current).strip())
    return parts


def _boolean_column_names() -> set[str]:
    return {column.lower() for columns in BOOLEAN_COLUMNS.values() for column in columns}


def _rewrite_boolean_comparisons(sql: str) -> str:
    """Rewrite SQLite-style 0/1 boolean comparisons for PostgreSQL.

    This helper is intentionally used only on filter/join expressions.  A
    previous global replacement also touched ``UPDATE ... SET flag=1`` and
    produced invalid SQL such as ``SET flag IS TRUE``.
    """
    text = sql
    for column in sorted(_boolean_column_names(), key=len, reverse=True):
        qualified = rf"(?P<column>(?:[A-Za-z_][A-Za-z0-9_]*\.)?{re.escape(column)})"
        text = re.sub(rf"\b{qualified}\s*=\s*1\b", r"\g<column> IS TRUE", text, flags=re.IGNORECASE)
        text = re.sub(rf"\b{qualified}\s*=\s*0\b", r"\g<column> IS FALSE", text, flags=re.IGNORECASE)
        text = re.sub(rf"\b{qualified}\s*<>\s*0\b", r"\g<column> IS TRUE", text, flags=re.IGNORECASE)
        text = re.sub(rf"\b{qualified}\s*!=\s*0\b", r"\g<column> IS TRUE", text, flags=re.IGNORECASE)
    text = re.sub(r"(COALESCE\([^()]+,\s*TRUE\))\s*=\s*1\b", r"\1 IS TRUE", text, flags=re.IGNORECASE)
    text = re.sub(r"(COALESCE\([^()]+,\s*FALSE\))\s*=\s*0\b", r"\1 IS FALSE", text, flags=re.IGNORECASE)
    text = re.sub(r"(COALESCE\([^()]+,\s*FALSE\))\s*(?:<>|!=)\s*0\b", r"\1 IS TRUE", text, flags=re.IGNORECASE)
    return text


def _rewrite_boolean_literals(sql: str) -> str:
    """Convert literal SQLite booleans to PostgreSQL TRUE/FALSE safely.

    Parameter values are handled by :func:`_coerce_boolean_params`; this
    function covers the many established statements that embed literal 0/1
    values directly in INSERT and UPDATE SQL.
    """
    text = sql
    bool_names = _boolean_column_names()

    # SQLite commonly uses COALESCE(boolean_column, 0/1). PostgreSQL requires
    # the fallback to have the same BOOLEAN type.
    for column in sorted(bool_names, key=len, reverse=True):
        qualified = rf"((?:[A-Za-z_][A-Za-z0-9_]*\.)?{re.escape(column)})"
        text = re.sub(rf"COALESCE\(\s*{qualified}\s*,\s*0\s*\)", r"COALESCE(\1, FALSE)", text, flags=re.IGNORECASE)
        text = re.sub(rf"COALESCE\(\s*{qualified}\s*,\s*1\s*\)", r"COALESCE(\1, TRUE)", text, flags=re.IGNORECASE)

    upper = text.lstrip().upper()

    if upper.startswith("INSERT"):
        match = re.search(
            r"INTO\s+\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s*\((.*?)\)\s*VALUES\s*\((.*?)\)",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            table = match.group(1).lower()
            columns = [item.strip().strip('"').lower() for item in _split_sql_csv(match.group(2))]
            tokens = _split_sql_csv(match.group(3))
            table_bool_columns = {item.lower() for item in BOOLEAN_COLUMNS.get(table, set())}
            changed = False
            for index, (column, token) in enumerate(zip(columns, tokens)):
                stripped = token.strip()
                if column in table_bool_columns and stripped in {"0", "1"}:
                    tokens[index] = "TRUE" if stripped == "1" else "FALSE"
                    changed = True
            if changed:
                start, end = match.span(3)
                text = text[:start] + ", ".join(tokens) + text[end:]
        return text

    if upper.startswith("UPDATE"):
        match = re.match(
            r"(?P<prefix>\s*UPDATE\s+\"?(?P<table>[A-Za-z_][A-Za-z0-9_]*)\"?\s+SET\s+)(?P<set>.*?)(?P<where>\s+WHERE\s+.*)?$",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            table = match.group("table").lower()
            table_bool_columns = {item.lower() for item in BOOLEAN_COLUMNS.get(table, set())}
            assignments = _split_sql_csv(match.group("set"))
            for index, assignment in enumerate(assignments):
                assignment_match = re.match(
                    r"\s*\"?(?P<column>[A-Za-z_][A-Za-z0-9_]*)\"?\s*=\s*(?P<value>[01])\s*$",
                    assignment,
                    re.IGNORECASE | re.DOTALL,
                )
                if assignment_match and assignment_match.group("column").lower() in table_bool_columns:
                    assignments[index] = (
                        f'{assignment_match.group("column")}'
                        f'={"TRUE" if assignment_match.group("value") == "1" else "FALSE"}'
                    )
            where_clause = match.group("where") or ""
            if where_clause:
                where_clause = _rewrite_boolean_comparisons(where_clause)
            return match.group("prefix") + ", ".join(assignments) + where_clause

    # SELECT, DELETE and other statements only need filter/join comparison
    # conversion; there is no SET clause to protect.
    return _rewrite_boolean_comparisons(text)


def _normalize_sqlite_ddl_for_postgres(sql: str) -> str:
    """Translate SQLite-only DDL used by legacy runtime schema guards.

    PostgreSQL parses a ``CREATE TABLE IF NOT EXISTS`` statement even when the
    table already exists, so SQLite tokens such as ``AUTOINCREMENT`` can still
    fail a page at runtime.  The checked-in PostgreSQL migrations remain the
    source of truth; this translation is a defensive compatibility layer for
    old non-destructive schema guards that still run during application boot or
    when a page is opened.
    """
    text = str(sql)
    text = re.sub(
        r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b",
        "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
        text,
        flags=re.IGNORECASE,
    )
    # Any remaining AUTOINCREMENT token is invalid in PostgreSQL.  Removing it
    # is safe because the canonical id definition above has already been
    # converted to an identity column.
    text = re.sub(r"\bAUTOINCREMENT\b", "", text, flags=re.IGNORECASE)

    # If a legacy runtime guard creates one of the known tables in an otherwise
    # empty database, keep BOOLEAN/JSONB declarations aligned with the canonical
    # PostgreSQL schema instead of silently creating INTEGER/TEXT substitutes.
    table_match = re.search(
        r"\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+\"?([A-Za-z_][A-Za-z0-9_]*)\"?",
        text,
        re.IGNORECASE,
    )
    if table_match:
        table = table_match.group(1).lower()
        for column in BOOLEAN_COLUMNS.get(table, set()):
            prefix = rf"(?P<prefix>(?:^|[(,])\s*\"?{re.escape(column)}\"?\s+)"
            text = re.sub(prefix + r"INTEGER\b", r"\g<prefix>BOOLEAN", text, flags=re.IGNORECASE | re.MULTILINE)
            text = re.sub(
                prefix + r"BOOLEAN(?:\s+NOT\s+NULL)?\s+DEFAULT\s+0\b",
                lambda match: match.group("prefix") + re.sub(r"0\b", "FALSE", match.group(0)[len(match.group("prefix")):], count=1),
                text,
                flags=re.IGNORECASE | re.MULTILINE,
            )
            text = re.sub(
                prefix + r"BOOLEAN(?:\s+NOT\s+NULL)?\s+DEFAULT\s+1\b",
                lambda match: match.group("prefix") + re.sub(r"1\b", "TRUE", match.group(0)[len(match.group("prefix")):], count=1),
                text,
                flags=re.IGNORECASE | re.MULTILINE,
            )
        for column in JSON_COLUMNS.get(table, set()):
            prefix = rf"(?P<prefix>(?:^|[(,])\s*\"?{re.escape(column)}\"?\s+)"
            text = re.sub(prefix + r"TEXT\b", r"\g<prefix>JSONB", text, flags=re.IGNORECASE | re.MULTILINE)

    alter_match = re.search(
        r"\bALTER\s+TABLE\s+\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s+",
        text,
        re.IGNORECASE,
    )
    if alter_match:
        table, column = alter_match.group(1).lower(), alter_match.group(2).lower()
        if column in {item.lower() for item in BOOLEAN_COLUMNS.get(table, set())}:
            text = re.sub(r"(\bADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+\"?[A-Za-z_][A-Za-z0-9_]*\"?\s+)INTEGER\b", r"\1BOOLEAN", text, count=1, flags=re.IGNORECASE)
            text = re.sub(r"\bDEFAULT\s+0\b", "DEFAULT FALSE", text, flags=re.IGNORECASE)
            text = re.sub(r"\bDEFAULT\s+1\b", "DEFAULT TRUE", text, flags=re.IGNORECASE)
        if column in {item.lower() for item in JSON_COLUMNS.get(table, set())}:
            text = re.sub(r"(\bADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+\"?[A-Za-z_][A-Za-z0-9_]*\"?\s+)TEXT\b", r"\1JSONB", text, count=1, flags=re.IGNORECASE)
    return text


def normalize_postgres_sql(sql: str) -> str:
    text = _normalize_sqlite_ddl_for_postgres(str(sql).strip())
    if text.rstrip(";").upper() == "BEGIN IMMEDIATE":
        return "BEGIN"
    # SQLite's idempotent insertion maps directly to PostgreSQL's no-target
    # conflict handler.  Existing explicit ON CONFLICT clauses are retained.
    had_or_ignore = bool(re.search(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", text, re.IGNORECASE))
    text = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", text, flags=re.IGNORECASE)
    if had_or_ignore and "ON CONFLICT" not in text.upper():
        semicolon = ";" if text.endswith(";") else ""
        text = text.rstrip(";") + " ON CONFLICT DO NOTHING" + semicolon
    # Legacy filters use SQLite's date()/datetime() wrappers around simple
    # columns and qmark parameters. PostgreSQL uses explicit casts instead.
    # Complex SQLite modifiers are intentionally removed from runtime SQL and
    # calculated in Python so the same query remains deterministic on both
    # backends.
    text = _DATETIME_RE.sub(r"CAST(\1 AS TIMESTAMPTZ)", text)
    text = _DATE_RE.sub(r"CAST(\1 AS DATE)", text)
    text = _GROUP_CONCAT_RE.sub(r"STRING_AGG(CAST(\1 AS TEXT), \2)", text)
    text = re.sub(r"\bCOLLATE\s+NOCASE\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\blast_insert_rowid\s*\(\s*\)", "LASTVAL()", text, flags=re.IGNORECASE)
    text = _rewrite_boolean_literals(text)
    return qmark_to_pyformat(text)


@dataclass
class PoolHealth:
    backend: str
    ok: bool
    message: str
    pool_size: int | None = None
    pool_available: int | None = None


_pool = None
_pool_lock = threading.Lock()


def get_postgres_pool():
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            from psycopg_pool import ConnectionPool
        except ImportError as exc:  # pragma: no cover - only in PostgreSQL deployment
            raise RuntimeError(
                "PostgreSQL is configured but psycopg/psycopg_pool is not installed. "
                "Install the project requirements."
            ) from exc
        min_size = max(1, int(os.environ.get("PROCUREFLOW_DB_POOL_MIN", "1")))
        max_size = max(min_size, int(os.environ.get("PROCUREFLOW_DB_POOL_MAX", "8")))
        timeout = float(os.environ.get("PROCUREFLOW_DB_POOL_TIMEOUT_SECONDS", "15"))
        kwargs = {
            "autocommit": False,
            "connect_timeout": int(os.environ.get("PROCUREFLOW_DB_CONNECT_TIMEOUT_SECONDS", "10")),
            "options": "-c timezone=UTC -c statement_timeout=" + str(int(os.environ.get("PROCUREFLOW_DB_STATEMENT_TIMEOUT_MS", "30000"))),
        }
        _pool = ConnectionPool(
            conninfo=postgres_dsn(),
            min_size=min_size,
            max_size=max_size,
            timeout=timeout,
            kwargs=kwargs,
            open=True,
            name="procureflow-cloudsql",
        )
        _pool.wait(timeout=timeout)
        return _pool


def close_postgres_pool() -> None:
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool is not None:
        try:
            pool.close(timeout=5)
        except TypeError:
            pool.close()
        except Exception:
            pass


atexit.register(close_postgres_pool)


class PostgresCursor:
    def __init__(self, connection: "PostgresConnection"):
        self.connection = connection
        self._cursor = connection._raw.cursor()
        self._columns: tuple[str, ...] = ()
        self.lastrowid: int | None = None

    @property
    def description(self):
        return self._cursor.description

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def execute(self, sql: str, params: Iterable[Any] = ()) -> "PostgresCursor":
        raw_params = tuple(params or ())
        normalized_params = _coerce_boolean_params(str(sql), raw_params)
        normalized_sql = normalize_postgres_sql(str(sql))
        if normalized_params:
            # psycopg uses pyformat placeholders and therefore interprets every
            # percent sign when a parameter sequence is supplied, including
            # percent signs inside SQL LIKE literals. Escape only literal
            # percent signs while preserving %s/%b/%t placeholders.
            normalized_sql = _escape_pyformat_percent_literals(normalized_sql)
            self._cursor.execute(normalized_sql, normalized_params)
        else:
            # Passing an empty tuple still activates psycopg's placeholder
            # parser and breaks valid literals such as LIKE '%DOWNLOAD%'.
            self._cursor.execute(normalized_sql)
        self._columns = tuple(desc.name if hasattr(desc, "name") else desc[0] for desc in (self._cursor.description or ()))
        return self

    def executemany(self, sql: str, params: Iterable[Iterable[Any]]) -> "PostgresCursor":
        batches = [
            _coerce_boolean_params(str(sql), tuple(item))
            for item in params
        ]
        normalized_sql = _escape_pyformat_percent_literals(normalize_postgres_sql(str(sql)))
        self._cursor.executemany(normalized_sql, batches)
        self._columns = tuple(desc.name if hasattr(desc, "name") else desc[0] for desc in (self._cursor.description or ()))
        return self

    def fetchone(self) -> CompatRow | None:
        row = self._cursor.fetchone()
        if row is None:
            return None
        return CompatRow(self._columns, row)

    def fetchall(self) -> list[CompatRow]:
        return [CompatRow(self._columns, row) for row in self._cursor.fetchall()]

    def __iter__(self):
        for row in self._cursor:
            yield CompatRow(self._columns, row)

    def close(self) -> None:
        self._cursor.close()


class PostgresConnection:
    """Small pooled connection wrapper with sqlite3-like methods."""

    def __init__(self, pool, raw):
        self._pool = pool
        self._raw = raw
        self._closed = False

    def cursor(self) -> PostgresCursor:
        return PostgresCursor(self)

    def execute(self, sql: str, params: Iterable[Any] = ()) -> PostgresCursor:
        return self.cursor().execute(sql, params)

    def executemany(self, sql: str, params: Iterable[Iterable[Any]]) -> PostgresCursor:
        return self.cursor().executemany(sql, params)

    def executescript(self, sql: str) -> None:
        # Migration scripts are written as PostgreSQL-native SQL and may contain
        # dollar-quoted DO blocks.  Psycopg simple-query mode accepts the full
        # script while preserving those blocks.
        with self._raw.cursor() as cur:
            cur.execute(sql, prepare=False)

    def create_function(self, *args, **kwargs) -> None:
        # SQLite UDF registration is intentionally a no-op on PostgreSQL.
        return None

    def commit(self) -> None:
        self._raw.commit()

    def rollback(self) -> None:
        self._raw.rollback()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self._raw.info.transaction_status != 0:
                self._raw.rollback()
        except Exception:
            pass
        self._pool.putconn(self._raw)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()
        self.close()
        return False


def get_postgres_connection() -> PostgresConnection:
    pool = get_postgres_pool()
    retries = max(1, int(os.environ.get("PROCUREFLOW_DB_CONNECT_RETRIES", "3")))
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            raw = pool.getconn(timeout=float(os.environ.get("PROCUREFLOW_DB_POOL_TIMEOUT_SECONDS", "15")))
            if raw.closed:
                pool.putconn(raw, close=True)
                raise RuntimeError("Database pool returned a closed connection.")
            return PostgresConnection(pool, raw)
        except Exception as exc:  # pragma: no cover - deployment path
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(min(2.0, 0.25 * (2**attempt)))
    raise RuntimeError("Unable to obtain a PostgreSQL connection.") from last_error


def postgres_health_check() -> PoolHealth:
    try:
        pool = get_postgres_pool()
        conn = get_postgres_connection()
        try:
            row = conn.execute("SELECT current_database(), current_user, now()").fetchone()
            conn.commit()
        finally:
            conn.close()
        stats = pool.get_stats() if hasattr(pool, "get_stats") else {}
        return PoolHealth(
            backend="postgresql",
            ok=bool(row),
            message=f"Connected to {row[0]} as {row[1]}" if row else "Connection returned no result.",
            pool_size=stats.get("pool_size"),
            pool_available=stats.get("pool_available"),
        )
    except Exception as exc:
        return PoolHealth("postgresql", False, f"{type(exc).__name__}: {exc}")
