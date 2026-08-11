"""Excel report generation helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from typing import Mapping

import pandas as pd
from pandas.api.types import is_datetime64_any_dtype


def _safe_sheet_name(name: str) -> str:
    cleaned = "".join(ch for ch in str(name) if ch not in r"[]:*?/\\")[:31]
    return cleaned or "Sheet"


def _excel_safe_datetime(value):
    """Return a timezone-naive UTC value that Excel can serialize.

    PostgreSQL returns ``TIMESTAMPTZ`` columns as timezone-aware Python
    datetimes/Pandas timestamps. Excel deliberately has no timezone-aware
    datetime cell type, so values must be normalised before ``to_excel``.
    Non-datetime values are returned unchanged.
    """
    if value is None or value is pd.NaT:
        return value

    if isinstance(value, pd.Timestamp):
        if value.tzinfo is not None:
            return value.tz_convert("UTC").tz_localize(None)
        return value

    if isinstance(value, datetime):
        if value.tzinfo is not None and value.utcoffset() is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    return value


def _excel_safe_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Copy *df* and remove timezone information from datetime values.

    Handles both native timezone-aware Pandas datetime columns and object
    columns containing mixed Python/Pandas datetime values. The conversion is
    centralised here so every ProcureFlow Excel export behaves consistently.
    """
    data = df.copy() if isinstance(df, pd.DataFrame) else pd.DataFrame(df)

    for column in data.columns:
        series = data[column]

        # Fast path for homogeneous DatetimeTZDtype columns.
        if isinstance(series.dtype, pd.DatetimeTZDtype):
            data[column] = series.dt.tz_convert("UTC").dt.tz_localize(None)
            continue

        # Timezone-naive datetime64 columns are already Excel-compatible.
        if is_datetime64_any_dtype(series.dtype):
            continue

        # PostgreSQL result frames may use object dtype when a column contains
        # nullable/mixed datetime values. Convert only actual datetime objects.
        if series.dtype == "object":
            data[column] = series.map(_excel_safe_datetime)

    return data


def build_excel_workbook(sheets: Mapping[str, pd.DataFrame], title: str = "ProcureFlow Report") -> bytes:
    """Return an .xlsx workbook containing one or more sanitized sheets."""
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        used: set[str] = set()
        for raw_name, df in sheets.items():
            name = _safe_sheet_name(raw_name)
            base = name
            i = 2
            while name in used:
                suffix = f"_{i}"
                name = (base[: 31 - len(suffix)] + suffix)[:31]
                i += 1
            used.add(name)
            data = _excel_safe_dataframe(df)
            data.to_excel(writer, index=False, sheet_name=name)
            ws = writer.book[name]
            ws.freeze_panes = "A2"
            for cell in ws[1]:
                cell.style = "Headline 4"
            for col in ws.columns:
                values = [str(c.value or "") for c in col[:200]]
                width = min(max(len(v) for v in values) + 2, 42)
                ws.column_dimensions[col[0].column_letter].width = width
    return output.getvalue()


def excel_mime() -> str:
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
