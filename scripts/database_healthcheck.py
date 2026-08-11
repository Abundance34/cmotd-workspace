#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.db import DB_PATH
from core.db_backend import database_backend, postgres_health_check


def main() -> None:
    backend = database_backend()
    if backend == "postgresql":
        result = postgres_health_check()
        print(json.dumps(result.__dict__, indent=2))
        raise SystemExit(0 if result.ok else 1)
    try:
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5)
        integrity = con.execute("PRAGMA quick_check").fetchone()[0]
        con.close()
        ok = integrity == "ok"
        print(json.dumps({"backend": "sqlite", "ok": ok, "message": integrity, "path": str(DB_PATH)}, indent=2))
        raise SystemExit(0 if ok else 1)
    except Exception as exc:
        print(json.dumps({"backend": "sqlite", "ok": False, "message": f"{type(exc).__name__}: {exc}"}, indent=2))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
