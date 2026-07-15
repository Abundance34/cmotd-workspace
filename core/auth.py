from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import streamlit as st

try:
    from streamlit_cookies_manager import EncryptedCookieManager
except Exception:  # pragma: no cover - optional only when dependencies are incomplete
    EncryptedCookieManager = None  # type: ignore

try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError, InvalidHashError
except Exception:  # pragma: no cover
    PasswordHasher = None  # type: ignore
    VerifyMismatchError = InvalidHashError = Exception  # type: ignore

from core.db import run_query, now_iso, log_audit, df_query, create_notification
from core.branding import COMPANY_NAME, company_logo_data_uri

SESSION_TIMEOUT_MINUTES = int(os.environ.get("PROCUREFLOW_SESSION_TIMEOUT_MINUTES", "43200"))
REMEMBER_ME_SESSION_DAYS = int(os.environ.get("PROCUREFLOW_REMEMBER_ME_SESSION_DAYS", "90"))
PRODUCTION_MODE = os.environ.get("PROCUREFLOW_PRODUCTION", "0") == "1"
SESSION_COOKIE_NAME = "pf_session_token"
SESSION_COOKIE_MANAGER_KEY = "_pf_session_cookie_manager"

# Login artwork is derived from the user-provided CMOTD reference design. It is
# presentation-only and never reads or changes the SQLite database.
LOGIN_VISUAL_PATH = Path(__file__).resolve().parents[1] / "static" / "branding" / "cmotd_login_left_panel.webp"


@lru_cache(maxsize=1)
def _login_visual_data_uri() -> str:
    """Return the branded login-left visual as an embedded WebP data URI.

    Using a data URI keeps the login screen identical on local Windows runs and
    Streamlit Cloud without relying on a static-file URL or third-party host.
    """
    try:
        encoded = base64.b64encode(LOGIN_VISUAL_PATH.read_bytes()).decode("ascii")
    except OSError:
        return ""
    return f"data:image/webp;base64,{encoded}"


# Stdlib PBKDF2 password hashing. This avoids the passlib/bcrypt 72-byte password
# error that can occur with newer bcrypt releases while still being much stronger
# than the original MVP's plain SHA256 hashing.
PBKDF2_ITERATIONS = 260_000
LOGIN_LOCKOUT_ATTEMPTS = int(os.environ.get("PROCUREFLOW_LOGIN_LOCKOUT_ATTEMPTS", "5"))
PASSWORD_HISTORY_COUNT = int(os.environ.get("PROCUREFLOW_PASSWORD_HISTORY_COUNT", "5"))
PASSWORD_MIN_LENGTH = 12 if PRODUCTION_MODE else 8
_ARGON2 = PasswordHasher() if PasswordHasher else None

from core.permissions import safe_role_permissions

ROLE_PERMISSIONS = {
    role: safe_role_permissions(role)
    for role in ["Admin", "Procurement Manager", "Facility Manager", "Logistics Officer", "Finance", "Approver", "Auditor"]
}


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.b64decode(data.encode("ascii"))


def hash_password(password: str) -> str:
    """Use Argon2id for new/changed passwords with PBKDF2 legacy support."""
    if password is None:
        password = ""
    if _ARGON2 is not None:
        return _ARGON2.hash(password)
    # Safe fallback for constrained local environments. requirements pins argon2-cffi.
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${_b64(salt)}${_b64(digest)}"

def _sha256_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _verify_pbkdf2(password: str, stored_hash: str) -> bool:
    try:
        _scheme, iterations, salt_b64, hash_b64 = stored_hash.split("$", 3)
        iterations = int(iterations)
        salt = _unb64(salt_b64)
        expected = _unb64(hash_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify Argon2id, PBKDF2 and original legacy SHA256 passwords."""
    if not stored_hash:
        return False
    if stored_hash.startswith("$argon2") and _ARGON2 is not None:
        try:
            return bool(_ARGON2.verify(stored_hash, password))
        except (VerifyMismatchError, InvalidHashError, ValueError):
            return False
    if stored_hash.startswith("pbkdf2_sha256$"):
        return _verify_pbkdf2(password, stored_hash)
    if len(stored_hash) == 64 and stored_hash == _sha256_hash(password):
        return True
    if stored_hash.startswith("sha256$") and stored_hash.split("$", 1)[1] == _sha256_hash(password):
        return True
    return False


def _password_used_recently(user_id: int, candidate: str, current_hash: str) -> bool:
    hashes = [current_hash]
    try:
        rows = run_query(
            "SELECT password_hash FROM password_history WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
            (int(user_id), PASSWORD_HISTORY_COUNT), fetch=True,
        )
        hashes.extend(str(row["password_hash"]) for row in rows)
    except Exception:
        pass
    return any(verify_password(candidate, stored) for stored in hashes if stored)

def login_user(username: str, password: str):
    rows = run_query("SELECT * FROM users WHERE username = ? AND is_active = 1", (username.strip(),), fetch=True)
    if not rows:
        log_audit("LOGIN_FAILED", "User", None, {"username": username.strip()[:64]}, None, "System", after_values={"outcome": "unknown_user"})
        return None
    user = dict(rows[0])
    if int(user.get("account_locked") or 0):
        log_audit("LOGIN_DENIED_ACCOUNT_LOCKED", "User", user["id"], "Locked account login attempt", user["id"], user.get("role"), after_values={"outcome": "denied"})
        return None
    if verify_password(password, user["password_hash"]):
        # Rehash PBKDF2/SHA256 upon successful login when Argon2id is available.
        if not str(user["password_hash"]).startswith("$argon2") and _ARGON2 is not None:
            run_query("UPDATE users SET password_hash = ?, updated_at=? WHERE id = ?", (hash_password(password), now_iso(), user["id"]))
        seen = now_iso()
        run_query("UPDATE users SET last_login_at = ?, failed_login_count=0 WHERE id = ?", (seen, user["id"]))
        log_audit("LOGIN_SUCCESS", "User", user["id"], "Authenticated session created", user["id"], user.get("role"), after_values={"outcome": "success"})
        user["last_login_at"] = seen
        return user
    attempts = int(user.get("failed_login_count") or 0) + 1
    locked = attempts >= LOGIN_LOCKOUT_ATTEMPTS
    try:
        run_query(
            "UPDATE users SET failed_login_count=?, account_locked=?, updated_at=? WHERE id=?",
            (attempts, 1 if locked else 0, now_iso(), user["id"]),
        )
    except Exception:
        pass
    log_audit(
        "ACCOUNT_LOCKED" if locked else "LOGIN_FAILED",
        "User", user["id"],
        {"attempt": attempts, "lockout_threshold": LOGIN_LOCKOUT_ATTEMPTS},
        user["id"], user.get("role"),
        after_values={"outcome": "locked" if locked else "failed"},
    )
    return None


def _get_query_param(name: str):
    try:
        value = st.query_params.get(name)
        if isinstance(value, list):
            return value[0] if value else None
        return value
    except Exception:
        try:
            params = st.experimental_get_query_params()
            return params.get(name, [None])[0]
        except Exception:
            return None


def _set_query_param(name: str, value: str | None):
    try:
        if value is None:
            if name in st.query_params:
                del st.query_params[name]
        else:
            st.query_params[name] = value
    except Exception:
        try:
            params = st.experimental_get_query_params()
            if value is None:
                params.pop(name, None)
            else:
                params[name] = value
            st.experimental_set_query_params(**params)
        except Exception:
            pass


def _clear_navigation_query_params() -> None:
    """Remove non-sensitive workspace hints before showing the login screen.

    A shared URL may include ``pf_section`` / ``pf_role`` from the sender's
    workspace. They are never authentication credentials, and an anonymous
    visitor must not inherit the sender's navigation context.
    """
    for parameter in ("pf_section", "pf_role"):
        _set_query_param(parameter, None)


def _session_cookie_password() -> str:
    """Return stable local/prod key material for the encrypted browser session cookie.

    The browser cookie contains only an opaque server-session token. The
    server keeps the token hash and still enforces the existing expiry,
    logout, account-status, and database session checks before restoring a
    user after a browser refresh.
    """
    configured = os.environ.get("PROCUREFLOW_SESSION_COOKIE_SECRET", "").strip()
    if configured:
        return configured
    try:
        # Reuse the existing protected local/prod key source without storing a
        # secret in code. A domain separator keeps this independent from the
        # payee-data encryption purpose.
        from services.security_service import encryption_key
        return hashlib.sha256(encryption_key() + b":procureflow-browser-session-cookie").hexdigest()
    except Exception:
        # Local fallback only. Fresh installations with the cookie package
        # will normally take the secure key path above.
        return hashlib.sha256(b"procureflow-local-session-cookie").hexdigest()


def initialize_browser_session_storage() -> bool:
    """Initialize the optional encrypted browser-cookie bridge safely.

    The cookie component can take an extra frontend cycle to become ready on
    Streamlit Community Cloud.  The earlier implementation called ``st.stop``
    while waiting, which could leave the entire application as a blank page if
    that component failed to finish loading.  ProcureFlow must always render
    its normal login/application view even when browser-cookie restoration is
    temporarily unavailable.

    A server-side session is still the authority.  The cookie contains only an
    opaque token and is used solely to restore a valid session after refresh.
    """
    if EncryptedCookieManager is None:
        st.session_state["_pf_cookie_bridge_ready"] = False
        return False

    manager = st.session_state.get(SESSION_COOKIE_MANAGER_KEY)
    if manager is None:
        try:
            manager = EncryptedCookieManager(
                prefix="procureflow_",
                password=_session_cookie_password(),
            )
            st.session_state[SESSION_COOKIE_MANAGER_KEY] = manager
        except Exception:
            st.session_state["_pf_cookie_bridge_ready"] = False
            return False

    try:
        ready = bool(manager.ready())
    except Exception:
        ready = False
    st.session_state["_pf_cookie_bridge_ready"] = ready

    # Never block the whole Streamlit page while a third-party component is
    # loading.  When it becomes ready on a later rerun, persist any session
    # token that was created before the browser bridge was available.
    if ready:
        pending_token = st.session_state.pop("pf_pending_browser_session_token", None)
        if pending_token:
            _store_browser_session_token(str(pending_token))
    return ready


def _browser_cookie_manager():
    return st.session_state.get(SESSION_COOKIE_MANAGER_KEY)


def _browser_session_token() -> str | None:
    manager = _browser_cookie_manager()
    if manager is None or not st.session_state.get("_pf_cookie_bridge_ready", False):
        return None
    try:
        token = manager.get(SESSION_COOKIE_NAME)
        return str(token) if token else None
    except Exception:
        return None


def _store_browser_session_token(token: str) -> None:
    manager = _browser_cookie_manager()
    if not token:
        return
    if manager is None or not st.session_state.get("_pf_cookie_bridge_ready", False):
        # Preserve the opaque token in memory until the optional component is
        # ready.  This avoids losing refresh persistence after a quick login
        # while also avoiding a blank app page during component startup.
        st.session_state["pf_pending_browser_session_token"] = str(token)
        return
    try:
        manager[SESSION_COOKIE_NAME] = str(token)
        manager.save()
        st.session_state.pop("pf_pending_browser_session_token", None)
    except Exception:
        # The server-side session remains valid; this only means a full
        # browser refresh will require a new login on this browser.
        st.session_state["pf_pending_browser_session_token"] = str(token)


def _clear_browser_session_token() -> None:
    manager = _browser_cookie_manager()
    if manager is None:
        return
    try:
        if SESSION_COOKIE_NAME in manager:
            del manager[SESSION_COOKIE_NAME]
        manager.save()
    except Exception:
        pass


def _session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _session_expiry_iso(remember_me: bool = False) -> str:
    """Return the server-side expiry time for a login session."""
    if remember_me:
        expiry = datetime.now() + timedelta(days=REMEMBER_ME_SESSION_DAYS)
    else:
        expiry = datetime.now() + timedelta(minutes=SESSION_TIMEOUT_MINUTES)
    return expiry.isoformat(timespec="seconds")


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _user_session_columns() -> set[str]:
    try:
        return {str(r["name"]) for r in run_query("PRAGMA table_info(user_sessions)", fetch=True)}
    except Exception:
        return set()


def _ensure_session_runtime_columns() -> None:
    """Add remember-me session columns when older SQLite files are opened.

    init_db() also performs this migration, but login can run against older
    databases copied from previous builds. These ALTERs are safe and do not
    touch existing users, passwords, procurement records, or workflows.
    """
    cols = _user_session_columns()
    try:
        if cols and "remember_me" not in cols:
            run_query("ALTER TABLE user_sessions ADD COLUMN remember_me INTEGER DEFAULT 0")
        if cols and "expires_at" not in cols:
            run_query("ALTER TABLE user_sessions ADD COLUMN expires_at TEXT")
    except Exception:
        pass


def create_persistent_session(user: dict, remember_me: bool = False) -> str:
    """Create a DB-backed server session without placing a token in the URL.

    Streamlit session state owns the opaque browser-session token. The optional
    Remember me checkbox only extends the server-side session expiry; it does
    not change passwords, roles, permissions, workflow records, or SQLite data.
    """
    _ensure_session_runtime_columns()
    token = secrets.token_urlsafe(32)
    token_hash = _session_token_hash(token)
    ts = now_iso()
    expires_at = _session_expiry_iso(bool(remember_me))
    cols = _user_session_columns()
    try:
        if {"remember_me", "expires_at"}.issubset(cols):
            run_query(
                """
                INSERT INTO user_sessions (session_token, user_id, login_at, last_seen_at, status, remember_me, expires_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?)
                """,
                (token_hash, int(user["id"]), ts, ts, 1 if remember_me else 0, expires_at, ts, ts),
            )
        else:
            run_query(
                "INSERT INTO user_sessions (session_token, user_id, login_at, last_seen_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Active', ?, ?)",
                (token_hash, int(user["id"]), ts, ts, ts, ts),
            )
    except Exception:
        return ""
    st.session_state["pf_remember_me"] = bool(remember_me)
    st.session_state["pf_session_expires_at"] = expires_at
    return token

def restore_user_from_session() -> bool:
    # The opaque token is restored from the encrypted browser cookie after a
    # full refresh. It is never written to URL query parameters.
    _ensure_session_runtime_columns()
    token = st.session_state.get("pf_session_token") or _browser_session_token()
    if not token:
        return False
    st.session_state["pf_session_token"] = str(token)
    token_hash = _session_token_hash(str(token))
    rows = run_query(
        """
        SELECT s.*, u.* FROM user_sessions s
        JOIN users u ON u.id=s.user_id
        WHERE s.session_token=? AND s.status='Active' AND u.is_active=1 AND (s.logout_at IS NULL OR s.logout_at='')
        ORDER BY s.id DESC LIMIT 1
        """,
        (token_hash,), fetch=True,
    )
    if not rows:
        return False
    row = dict(rows[0])
    remember_me = bool(int(row.get("remember_me") or 0))
    expires_at = _parse_iso_datetime(row.get("expires_at"))
    if expires_at is not None:
        if datetime.now() > expires_at:
            run_query("UPDATE user_sessions SET status='Expired', logout_at=?, updated_at=? WHERE session_token=?", (now_iso(), now_iso(), token_hash))
            log_audit("SESSION_EXPIRED", "User", row.get("user_id"), "Session expired", row.get("user_id"), row.get("role"))
            return False
    else:
        last_seen = row.get("last_seen_at") or row.get("login_at")
        try:
            last = datetime.fromisoformat(last_seen)
            limit = timedelta(days=REMEMBER_ME_SESSION_DAYS) if remember_me else timedelta(minutes=SESSION_TIMEOUT_MINUTES)
            if datetime.now() - last > limit:
                run_query("UPDATE user_sessions SET status='Expired', logout_at=?, updated_at=? WHERE session_token=?", (now_iso(), now_iso(), token_hash))
                log_audit("SESSION_EXPIRED", "User", row.get("user_id"), "Session expired", row.get("user_id"), row.get("role"))
                return False
        except Exception:
            pass
    user = {k: row[k] for k in row.keys() if k in {"id", "username", "full_name", "role", "password_hash", "must_change_password", "is_active", "last_login_at", "account_locked", "failed_login_count", "created_at", "updated_at"}}
    st.session_state["user"] = user
    st.session_state["last_seen_at"] = datetime.now().isoformat(timespec="seconds")
    st.session_state["pf_remember_me"] = remember_me
    new_expiry = _session_expiry_iso(remember_me)
    st.session_state["pf_session_expires_at"] = new_expiry
    try:
        cols = _user_session_columns()
        if "expires_at" in cols:
            run_query("UPDATE user_sessions SET last_seen_at=?, expires_at=?, updated_at=? WHERE session_token=?", (now_iso(), new_expiry, now_iso(), token_hash))
        else:
            run_query("UPDATE user_sessions SET last_seen_at=?, updated_at=? WHERE session_token=?", (now_iso(), now_iso(), token_hash))
    except Exception:
        pass
    return True

def close_persistent_session():
    token = st.session_state.get("pf_session_token")
    if token:
        token_hash = _session_token_hash(str(token))
        try:
            run_query("UPDATE user_sessions SET logout_at=?, last_seen_at=?, status='Logged Out', updated_at=? WHERE session_token=?", (now_iso(), now_iso(), now_iso(), token_hash))
        except Exception:
            pass
    st.session_state.pop("pf_session_token", None)
    _clear_browser_session_token()
    # Do not leave a previous role/workspace link in the address bar after logout.
    _clear_navigation_query_params()

def has_permission(permission: str) -> bool:
    user = st.session_state.get("user")
    if not user:
        return False
    if permission in ROLE_PERMISSIONS.get(user["role"], set()):
        return True
    try:
        rows = run_query(
            "SELECT 1 FROM role_permissions WHERE role_name=? AND permission_name=? LIMIT 1",
            (user["role"], permission),
            fetch=True,
        )
        return bool(rows)
    except Exception:
        return False


def require_permission(permission: str) -> bool:
    if has_permission(permission):
        return True
    st.warning("You do not have permission to perform this action.")
    return False


def session_expired() -> bool:
    expiry = _parse_iso_datetime(st.session_state.get("pf_session_expires_at"))
    if expiry is not None:
        return datetime.now() > expiry
    last_seen = st.session_state.get("last_seen_at")
    if not last_seen:
        return False
    try:
        last = datetime.fromisoformat(last_seen)
    except ValueError:
        return False
    limit = timedelta(days=REMEMBER_ME_SESSION_DAYS) if st.session_state.get("pf_remember_me") else timedelta(minutes=SESSION_TIMEOUT_MINUTES)
    return datetime.now() - last > limit

def require_user() -> bool:
    if "user" not in st.session_state:
        if not restore_user_from_session():
            # After a browser refresh, Streamlit's encrypted cookie component can
            # need one or two frontend cycles before it can expose the existing
            # server-session token. Wait briefly for that bridge instead of
            # immediately sending a valid signed-in user back to the login page.
            if (
                EncryptedCookieManager is not None
                and st.session_state.get(SESSION_COOKIE_MANAGER_KEY) is not None
                and not st.session_state.get("_pf_cookie_bridge_ready", False)
            ):
                attempts = int(st.session_state.get("_pf_cookie_restore_attempts", 0) or 0)
                if attempts < 12:
                    st.session_state["_pf_cookie_restore_attempts"] = attempts + 1
                    st.info("Restoring your signed-in session…")
                    time.sleep(0.15)
                    st.rerun()
            st.session_state.pop("_pf_cookie_restore_attempts", None)
            # Shared workspace URLs can include a sender's navigation hints.
            # Anonymous visitors always start at the login page.
            _clear_navigation_query_params()
            return False
    st.session_state.pop("_pf_cookie_restore_attempts", None)
    if session_expired():
        close_persistent_session()
        st.session_state.clear()
        st.warning("Your session expired. Please log in again.")
        return False

    # Streamlit reruns on every click. Writing last_seen_at to SQLite on every
    # rerun made navigation feel sluggish after the app gained many badges and
    # dashboard panels. Keep the in-memory timestamp current, but persist the
    # DB heartbeat at most every 30 seconds. Login/logout audit times still
    # remain exact, and refresh restore still works through the session token.
    now_dt = datetime.now()
    st.session_state["last_seen_at"] = now_dt.isoformat(timespec="seconds")
    token = st.session_state.get("pf_session_token")
    last_db_touch = st.session_state.get("pf_last_session_db_touch")
    should_touch = True
    if last_db_touch:
        try:
            should_touch = (now_dt - datetime.fromisoformat(last_db_touch)).total_seconds() >= 30
        except Exception:
            should_touch = True
    if token and should_touch:
        try:
            ts = now_iso()
            run_query("UPDATE user_sessions SET last_seen_at=?, updated_at=? WHERE session_token=?", (ts, ts, _session_token_hash(str(token))))
            st.session_state["pf_last_session_db_touch"] = now_dt.isoformat(timespec="seconds")
        except Exception:
            pass
    return True


def request_password_reset(username: str) -> bool:
    """Notify Admin that a user needs password help.

    The request does not reveal account existence to the requester and does not
    reset a password automatically. Admin still controls the existing forced
    password-change/reset process from User Management.
    """
    clean_username = (username or "").strip()
    if not clean_username:
        return False
    rows = run_query(
        "SELECT id, username, full_name, role FROM users WHERE lower(username)=lower(?) AND is_active=1 LIMIT 1",
        (clean_username,),
        fetch=True,
    )
    if rows:
        target = dict(rows[0])
        title = "Password reset requested"
        message = (
            f"{target.get('full_name') or target.get('username')} ({target.get('username')}, {target.get('role')}) "
            "requested password assistance from the login screen. Admin should review User Management and force a password change or issue a temporary password if appropriate."
        )
        try:
            create_notification(None, "Admin", title, message, "User", int(target["id"]), "High", ["in_app", "browser_push"], action_label="Open User Management")
        except Exception:
            try:
                create_notification(None, "Admin", title, message, "User", int(target["id"]), "High")
            except Exception:
                pass
        log_audit("PASSWORD_RESET_REQUESTED", "User", int(target["id"]), {"username": target.get("username"), "source": "login_screen"}, None, "Anonymous")
    else:
        log_audit("PASSWORD_RESET_REQUESTED_UNKNOWN_USER", "User", None, {"username": clean_username[:64], "source": "login_screen"}, None, "Anonymous")
    return True


def login_panel():
    """Render a compact, fixed desktop login screen.

    This is presentation-only. Authentication, passwords, SQLite records,
    shared-link handling, roles, permissions, and workflow logic remain
    untouched. The desktop composition is anchored to the browser viewport so
    every visible control fits without vertical scrolling.
    """
    logo_uri = company_logo_data_uri()
    company_logo = (
        f'<img src="{logo_uri}" alt="{COMPANY_NAME}" />'
        if logo_uri
        else '<span class="pf-login-company-fallback">CMOTD</span>'
    )
    marine_visual_uri = _login_visual_data_uri()
    marine_visual_css = f"background-image:url('{marine_visual_uri}');" if marine_visual_uri else ""

    st.markdown(
        """
        <style>
        /* Login-only viewport reset. Nothing below applies after authentication. */
        html:has(.pf-login-page),
        body:has(.pf-login-page) {
            height:100% !important;
            min-height:100% !important;
            margin:0 !important;
            overflow:hidden !important;
            background:#f7faff !important;
        }
        body:has(.pf-login-page) [data-testid="stHeader"],
        body:has(.pf-login-page) [data-testid="stToolbar"] { display:none !important; }
        body:has(.pf-login-page) [data-testid="stApp"],
        body:has(.pf-login-page) [data-testid="stAppViewContainer"],
        body:has(.pf-login-page) .main,
        body:has(.pf-login-page) [data-testid="stMain"] {
            width:100vw !important;
            height:100vh !important;
            min-height:100vh !important;
            max-height:100vh !important;
            margin:0 !important;
            overflow:hidden !important;
            background:#f7faff !important;
        }
        body:has(.pf-login-page) [data-testid="stMainBlockContainer"],
        body:has(.pf-login-page) .main .block-container {
            width:100vw !important;
            max-width:none !important;
            height:100vh !important;
            min-height:100vh !important;
            max-height:100vh !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
        }

        /* Markers do not reserve vertical space in Streamlit's element stack. */
        body:has(.pf-login-page) [data-testid="stElementContainer"]:has(.pf-login-page),
        body:has(.pf-login-page) [data-testid="stElementContainer"]:has(.pf-login-left-anchor),
        body:has(.pf-login-page) [data-testid="stElementContainer"]:has(.pf-login-right-stage) {
            height:0 !important;
            min-height:0 !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
        }
        body:has(.pf-login-page) .pf-login-page,
        body:has(.pf-login-page) .pf-login-left-anchor,
        body:has(.pf-login-page) .pf-login-right-stage {
            display:block !important;
            width:0 !important;
            height:0 !important;
            min-height:0 !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
            pointer-events:none !important;
        }

        /* Decorative details stay behind the fixed two-panel layout. */
        body:has(.pf-login-page) .pf-login-page::before,
        body:has(.pf-login-page) .pf-login-page::after {
            content:"";
            position:fixed;
            z-index:0;
            pointer-events:none;
        }
        body:has(.pf-login-page) .pf-login-page::before {
            top:18px;
            right:34px;
            width:84px;
            height:84px;
            opacity:.9;
            background-image:radial-gradient(circle,rgba(37,105,229,.24) 1.55px,transparent 2px);
            background-size:16px 16px;
        }
        body:has(.pf-login-page) .pf-login-page::after {
            right:-156px;
            bottom:-178px;
            width:580px;
            height:520px;
            border:1px solid rgba(67,126,231,.11);
            border-radius:50%;
            box-shadow:0 0 0 27px rgba(67,126,231,.035),0 0 0 56px rgba(67,126,231,.023),0 0 0 85px rgba(67,126,231,.016);
        }

        /* Pin the Streamlit column row to the viewport. This removes the
           blank top gap and keeps the login page truly static on desktop. */
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) {
            position:fixed !important;
            z-index:1 !important;
            inset:0 !important;
            width:100vw !important;
            height:100vh !important;
            min-height:100vh !important;
            max-height:100vh !important;
            display:flex !important;
            flex-wrap:nowrap !important;
            gap:0 !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
            align-items:stretch !important;
            background:#f7faff !important;
        }
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"] {
            height:100vh !important;
            min-height:100vh !important;
            max-height:100vh !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
        }
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:first-child {
            flex:0 0 40% !important;
            width:40% !important;
            background:#073379 !important;
        }
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:last-child {
            flex:0 0 60% !important;
            width:60% !important;
            position:relative !important;
            background:linear-gradient(145deg,#fbfdff 0%,#f4f8ff 100%) !important;
        }

        /* The marine artwork is a true full-height panel, not an in-flow
           Streamlit image, so it cannot begin halfway down the page. */
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) > div,
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) [data-testid="stVerticalBlock"],
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) [data-testid="stElementContainer"]:has(.pf-login-left-visual),
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) [data-testid="stMarkdown"]:has(.pf-login-left-visual) {
            width:100% !important;
            height:100vh !important;
            min-height:100vh !important;
            max-height:100vh !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
        }
        .pf-login-left-visual {
            display:block !important;
            width:100% !important;
            height:100vh !important;
            min-height:100vh !important;
            background-color:#063178 !important;
            background-repeat:no-repeat !important;
            background-position:center center !important;
            background-size:cover !important;
        }

        /* The card is centered independently from Streamlit's regular block
           flow. This guarantees that it stays within the visible desktop area. */
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) > div,
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) [data-testid="stVerticalBlock"] {
            min-height:100% !important;
        }
        body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) {
            position:absolute !important;
            top:50% !important;
            left:50% !important;
            z-index:2 !important;
            width:min(630px,calc(100% - 64px)) !important;
            max-height:calc(100vh - 28px) !important;
            margin:0 !important;
            transform:translate(-50%,-50%) !important;
            overflow:hidden !important;
            box-sizing:border-box !important;
            background:rgba(255,255,255,.98) !important;
            border:1px solid rgba(218,229,246,.98) !important;
            border-radius:18px !important;
            box-shadow:0 18px 44px rgba(38,77,140,.11) !important;
        }
        body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) > div {
            padding:clamp(20px,2.2vh,28px) clamp(32px,4vw,48px) clamp(17px,2vh,24px) !important;
            box-sizing:border-box !important;
        }

        .pf-login-brand {
            display:flex;
            align-items:center;
            justify-content:center;
            min-height:38px;
            margin:0 0 9px;
        }
        .pf-login-brand img {
            display:block;
            width:min(100%,320px);
            max-height:45px;
            object-fit:contain;
        }
        .pf-login-company-fallback { color:#132753; font-size:17px; font-weight:850; }
        .pf-login-title {
            margin:0;
            color:#102246;
            font-size:clamp(22px,1.58vw,27px);
            font-weight:850;
            line-height:1.15;
            letter-spacing:-.032em;
            text-align:center;
        }
        .pf-login-title strong { color:#1463e8; font-weight:850; }
        .pf-login-subtitle {
            max-width:530px;
            margin:7px auto 12px;
            color:#4e638b;
            font-size:clamp(12px,.83vw,13px);
            font-weight:560;
            line-height:1.45;
            text-align:center;
        }
        .pf-login-divider {
            position:relative;
            height:2px;
            margin:0 0 13px;
            background:#e3ebf7;
        }
        .pf-login-divider::after {
            content:"";
            position:absolute;
            top:0;
            left:50%;
            width:52px;
            height:2px;
            margin-left:-26px;
            border-radius:99px;
            background:#1464e9;
        }

        body:has(.pf-login-page) [data-testid="stForm"] { border:0 !important; padding:0 !important; }
        body:has(.pf-login-page) [data-testid="stTextInput"] { margin-bottom:9px !important; }
        body:has(.pf-login-page) [data-testid="stTextInput"] label {
            margin:0 0 5px !important;
            color:#16315f !important;
            font-size:12px !important;
            font-weight:800 !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"] input {
            min-height:43px !important;
            padding:0 44px 0 46px !important;
            border:1px solid #cbd9f0 !important;
            border-radius:9px !important;
            color:#1d3156 !important;
            font-size:14px !important;
            font-weight:600 !important;
            box-shadow:none !important;
            background-color:#fff !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"] input:focus {
            border-color:#2b70eb !important;
            box-shadow:0 0 0 3px rgba(43,112,235,.12) !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"]:has(input:not([type="password"])) input {
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' fill='none' stroke='%238099bd' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='M20 21a8 8 0 1 0-16 0'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E") !important;
            background-repeat:no-repeat !important;
            background-position:15px center !important;
            background-size:18px !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"]:has(input[type="password"]) input {
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' fill='none' stroke='%238099bd' stroke-width='2' viewBox='0 0 24 24'%3E%3Crect x='5' y='10' width='14' height='10' rx='2'/%3E%3Cpath d='M8 10V7a4 4 0 0 1 8 0v3'/%3E%3C/svg%3E") !important;
            background-repeat:no-repeat !important;
            background-position:15px center !important;
            background-size:18px !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"] button { right:12px !important; color:#6680aa !important; }
        .pf-login-options {
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:14px;
            margin:0 0 11px;
            color:#314d7a;
            font-size:12px;
            font-weight:700;
        }
        .pf-login-options .pf-remember { display:inline-flex; align-items:center; gap:8px; }
        .pf-login-options .pf-remember i {
            display:inline-block;
            width:14px;
            height:14px;
            box-sizing:border-box;
            border:1.5px solid #9fb3d4;
            border-radius:3px;
            background:#fff;
        }
        .pf-login-options .pf-forgot { color:#1463e8; font-weight:800; }
        body:has(.pf-login-page) [data-testid="stCheckbox"] { margin:0 0 8px !important; }
        body:has(.pf-login-page) [data-testid="stCheckbox"] label,
        body:has(.pf-login-page) [data-testid="stCheckbox"] p { color:#314d7a !important; font-size:12px !important; font-weight:750 !important; }
        body:has(.pf-login-page) div[class*="st-key-pf_forgot_password_button"] button {
            min-height:24px !important;
            padding:0 !important;
            border:0 !important;
            background:transparent !important;
            box-shadow:none !important;
            color:#1463e8 !important;
            font-size:12px !important;
            font-weight:850 !important;
            text-align:right !important;
        }
        body:has(.pf-login-page) div[class*="st-key-pf_forgot_password_button"] button:hover {
            background:transparent !important;
            color:#0c4fbd !important;
            text-decoration:underline !important;
        }
        body:has(.pf-login-page) [data-testid="stFormSubmitButton"] button {
            min-height:44px !important;
            border:0 !important;
            border-radius:9px !important;
            background:linear-gradient(90deg,#1b68e9 0%,#135bd8 100%) !important;
            color:#fff !important;
            font-size:14px !important;
            font-weight:800 !important;
            box-shadow:0 8px 16px rgba(20,94,216,.18) !important;
        }
        body:has(.pf-login-page) [data-testid="stFormSubmitButton"] button:hover {
            background:linear-gradient(90deg,#135edc 0%,#0e51c8 100%) !important;
            transform:translateY(-1px);
        }
        .pf-login-card-footer {
            margin-top:12px;
            color:#7184a5;
            font-size:11px;
            font-weight:650;
            text-align:center;
        }
        .pf-login-card-footer b { color:#1765e5; padding:0 7px; }
        .pf-login-legal {
            margin-top:7px;
            color:#7b8eae;
            font-size:10px;
            line-height:1.4;
            text-align:center;
        }

        /* Tight laptop heights keep the whole card visible without scrolling. */
        @media (max-height:760px) and (min-width:781px) {
            body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) > div { padding:18px 38px 16px !important; }
            .pf-login-brand { min-height:30px; margin-bottom:6px; }
            .pf-login-brand img { max-height:37px; width:min(100%,275px); }
            .pf-login-title { font-size:22px; }
            .pf-login-subtitle { margin:5px auto 9px; font-size:12px; line-height:1.35; }
            .pf-login-divider { margin-bottom:10px; }
            body:has(.pf-login-page) [data-testid="stTextInput"] { margin-bottom:6px !important; }
            body:has(.pf-login-page) [data-testid="stTextInput"] input { min-height:39px !important; }
            .pf-login-options { margin:0 0 8px; }
            body:has(.pf-login-page) [data-testid="stFormSubmitButton"] button { min-height:40px !important; }
            .pf-login-card-footer { margin-top:9px; }
            .pf-login-legal { margin-top:5px; }
        }

        /* Mobile retains access to the full form rather than clipping it. */
        @media (max-width:780px) {
            html:has(.pf-login-page), body:has(.pf-login-page),
            body:has(.pf-login-page) [data-testid="stApp"],
            body:has(.pf-login-page) [data-testid="stAppViewContainer"],
            body:has(.pf-login-page) .main,
            body:has(.pf-login-page) [data-testid="stMain"],
            body:has(.pf-login-page) [data-testid="stMainBlockContainer"],
            body:has(.pf-login-page) .main .block-container {
                width:100% !important;
                height:auto !important;
                min-height:100vh !important;
                max-height:none !important;
                overflow:auto !important;
            }
            body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) {
                position:relative !important;
                inset:auto !important;
                width:100% !important;
                height:auto !important;
                min-height:100vh !important;
                max-height:none !important;
                display:block !important;
                overflow:visible !important;
            }
            body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:first-child { display:none !important; }
            body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:last-child {
                width:100% !important;
                min-height:100vh !important;
                position:relative !important;
                overflow:visible !important;
            }
            body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) {
                position:relative !important;
                top:auto !important;
                left:auto !important;
                width:calc(100% - 32px) !important;
                max-height:none !important;
                margin:30px auto !important;
                transform:none !important;
                overflow:visible !important;
            }
            body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) > div { padding:28px 24px 22px !important; }
            .pf-login-title { font-size:23px; }
            .pf-login-subtitle { font-size:13px; }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    st.markdown('<div class="pf-login-page" aria-hidden="true"></div>', unsafe_allow_html=True)
    left_column, right_column = st.columns([40, 60], gap="small")

    with left_column:
        st.markdown('<div class="pf-login-left-anchor" aria-hidden="true"></div>', unsafe_allow_html=True)
        st.markdown(
            f'<div class="pf-login-left-visual" style="{marine_visual_css}" aria-label="Marine procurement workspace visual"></div>',
            unsafe_allow_html=True,
        )

    with right_column:
        st.markdown('<div class="pf-login-right-stage" aria-hidden="true"></div>', unsafe_allow_html=True)
        with st.container(border=True):
            st.markdown(
                f"""
                <div class="pf-login-brand" aria-label="{COMPANY_NAME}">{company_logo}</div>
                <h1 class="pf-login-title">ProcureFlow <strong>Procurement Workspace</strong></h1>
                <p class="pf-login-subtitle">ServiceNow-inspired procurement command center for requests, sourcing, POs, receiving, invoices, expenses, cash advances, budgets, and audits.</p>
                <div class="pf-login-divider" aria-hidden="true"></div>
                """,
                unsafe_allow_html=True,
            )
            with st.form("pf_login_form", clear_on_submit=False):
                username = st.text_input("Username", value="", placeholder="Enter your username", key="pf_login_username")
                password = st.text_input("Password", value="", type="password", placeholder="Enter your password", key="pf_login_password")
                remember_me = st.checkbox("Remember me", value=False, key="pf_login_remember")
                submitted = st.form_submit_button("↪  Login", use_container_width=True)
                if submitted:
                    user = login_user(username, password)
                    if user:
                        st.session_state["user"] = user
                        st.session_state["last_seen_at"] = datetime.now().isoformat(timespec="seconds")
                        token = create_persistent_session(user, remember_me=bool(remember_me))
                        if token:
                            st.session_state["pf_session_token"] = token
                            _store_browser_session_token(token)
                        log_audit("LOGIN", "User", user["id"], "User logged in", user["id"], user.get("role"), after_values={"remember_me": bool(remember_me)})
                        st.rerun()
                    else:
                        st.error("Invalid username or password.")
            if st.button("Forgot password?", key="pf_forgot_password_button", use_container_width=True):
                requested_username = str(st.session_state.get("pf_login_username") or "").strip()
                if not requested_username:
                    st.warning("Enter your username first, then click Forgot password again.")
                else:
                    request_password_reset(requested_username)
                    st.success("If the account exists, Admin has been notified to review User Management and force a password change.")
            st.markdown(
                f"""
                <div class="pf-login-card-footer">Secure<b>•</b>Reliable<b>•</b>Built for Procurement Excellence</div>
                <div class="pf-login-legal">© 2026 {COMPANY_NAME}. All rights reserved.</div>
                """,
                unsafe_allow_html=True,
            )

def logout_button():
    if st.button("Logout", use_container_width=True):
        current = st.session_state.get("user")
        if current:
            log_audit("LOGOUT", "User", current["id"], "User logged out", current["id"], current.get("role"))
        close_persistent_session()
        st.session_state.clear()
        st.rerun()


def change_password_panel():
    user = st.session_state.get("user")
    if not user:
        return
    with st.form("change_password_form"):
        current = st.text_input("Current password", type="password")
        new = st.text_input("New password", type="password")
        confirm = st.text_input("Confirm new password", type="password")
        submitted = st.form_submit_button("Change password")
    if submitted:
        rows = run_query("SELECT password_hash FROM users WHERE id = ?", (user["id"],), fetch=True)
        if not rows or not verify_password(current, rows[0]["password_hash"]):
            st.error("Current password is incorrect.")
        elif len(new) < PASSWORD_MIN_LENGTH:
            st.error(f"Use at least {PASSWORD_MIN_LENGTH} characters.")
        elif new != confirm:
            st.error("Passwords do not match.")
        elif _password_used_recently(int(user["id"]), new, str(rows[0]["password_hash"])):
            st.error("Choose a password that has not been used recently.")
        else:
            prior_hash = str(rows[0]["password_hash"])
            try:
                run_query("INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)", (user["id"], prior_hash, now_iso()))
                run_query("DELETE FROM password_history WHERE id NOT IN (SELECT id FROM password_history WHERE user_id=? ORDER BY created_at DESC LIMIT ? ) AND user_id=?", (user["id"], PASSWORD_HISTORY_COUNT, user["id"]))
            except Exception:
                pass
            run_query("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at=? WHERE id = ?", (hash_password(new), now_iso(), user["id"]))
            log_audit("PASSWORD_CHANGE", "User", user["id"], "Password changed", user["id"])
            st.success("Password changed.")
