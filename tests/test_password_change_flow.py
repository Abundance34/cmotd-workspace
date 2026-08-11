from __future__ import annotations

import shutil
import sys
import types
from pathlib import Path

import pytest

# The production dependency is Streamlit. CI for service-level tests may not
# install its UI package, so provide only the import-time surface needed by
# core.auth. No Streamlit widget is exercised in this test.
if "streamlit" not in sys.modules:
    streamlit_stub = types.ModuleType("streamlit")
    streamlit_stub.session_state = {}
    streamlit_stub.query_params = {}
    sys.modules["streamlit"] = streamlit_stub

import core.db as db
from core.auth import hash_password, update_password_credentials, verify_password


def test_forced_password_change_revokes_old_sessions_and_clears_flag(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    seeded_database_template: Path,
):
    database = tmp_path / "procureflow.db"
    shutil.copy2(seeded_database_template, database)
    uploads = tmp_path / "uploads"
    backups = tmp_path / "backups"
    monkeypatch.setattr(db, "DB_PATH", database)
    monkeypatch.setattr(db, "ATTACHMENT_DIR", uploads)
    monkeypatch.setattr(db, "BACKUP_DIR", backups)
    monkeypatch.setattr(db, "_DB_INIT_DONE", True)

    user = dict(db.run_query("SELECT * FROM users WHERE username='admin'", fetch=True)[0])
    temporary_password = "Temporary-Password-2026!"
    new_password = "New-Secure-Password-2026!"
    db.run_query(
        "UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?",
        (hash_password(temporary_password), int(user["id"])),
    )
    db.run_query(
        "INSERT INTO user_sessions (session_token,user_id,login_at,last_seen_at,status,created_at,updated_at) VALUES ('old-session',?,?,?,'Active',?,?)",
        (int(user["id"]), db.now_iso(), db.now_iso(), db.now_iso(), db.now_iso()),
    )

    changed = update_password_credentials(
        int(user["id"]), temporary_password, new_password, new_password
    )

    assert int(changed["must_change_password"]) == 0
    assert verify_password(new_password, changed["password_hash"])
    assert not verify_password(temporary_password, changed["password_hash"])
    stored = dict(db.run_query("SELECT password_hash,must_change_password FROM users WHERE id=?", (int(user["id"]),), fetch=True)[0])
    assert int(stored["must_change_password"]) == 0
    assert verify_password(new_password, stored["password_hash"])
    session = dict(db.run_query("SELECT status,logout_at FROM user_sessions WHERE session_token='old-session'", fetch=True)[0])
    assert session["status"] == "Password Changed"
    assert session["logout_at"]


def test_session_expiry_accepts_timezone_aware_postgres_timestamp(monkeypatch: pytest.MonkeyPatch):
    """PostgreSQL timestamptz values must compare safely against the UTC clock."""
    from datetime import datetime, timedelta, timezone
    import core.auth as auth

    state = {
        "pf_session_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        "pf_remember_me": False,
    }
    monkeypatch.setattr(auth.st, "session_state", state)

    assert auth.session_expired() is False


def test_session_expiry_normalises_legacy_naive_timestamp(monkeypatch: pytest.MonkeyPatch):
    """Legacy SQLite/session-state timestamps without offsets remain supported."""
    from datetime import datetime, timedelta
    import core.auth as auth

    state = {
        "pf_session_expires_at": (datetime.now() - timedelta(minutes=1)).isoformat(),
        "pf_remember_me": False,
    }
    monkeypatch.setattr(auth.st, "session_state", state)

    assert auth.session_expired() is True
