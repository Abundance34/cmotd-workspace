"""Presentation-only company branding helpers for ProcureFlow.

The functions in this module only load static image assets for the interface.
They do not read from or modify the SQLite database, sessions, roles, or
workflow records.
"""

from __future__ import annotations

from base64 import b64encode
from functools import lru_cache
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
COMPANY_LOGO_PATH = PROJECT_ROOT / "static" / "branding" / "cmotd_company_wordmark.png"
COMPANY_NAME = "Center for Marine and Offshore Technology Development"


@lru_cache(maxsize=1)
def company_logo_data_uri() -> str:
    """Return the official company wordmark as an embeddable PNG data URI.

    Embedding the local asset keeps the logo reliable on Streamlit Cloud and
    local Windows installations without introducing an external CDN or any
    third-party UI dependency.
    """
    try:
        encoded = b64encode(COMPANY_LOGO_PATH.read_bytes()).decode("ascii")
    except OSError:
        return ""
    return f"data:image/png;base64,{encoded}"
