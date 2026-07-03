from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
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

from core.db import run_query, now_iso, log_audit, df_query
from core.branding import COMPANY_NAME, company_logo_data_uri

SESSION_TIMEOUT_MINUTES = int(os.environ.get("PROCUREFLOW_SESSION_TIMEOUT_MINUTES", "60"))
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


def create_persistent_session(user: dict) -> str:
    """Create a DB-backed server session without placing a token in the URL.

    Streamlit session state owns the opaque browser-session token. Production
    reverse proxies may add HttpOnly/Secure/SameSite cookies around this server
    session; the application never writes session credentials to query params.
    """
    token = secrets.token_urlsafe(32)
    token_hash = _session_token_hash(token)
    ts = now_iso()
    try:
        run_query(
            "INSERT INTO user_sessions (session_token, user_id, login_at, last_seen_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Active', ?, ?)",
            (token_hash, int(user["id"]), ts, ts, ts, ts),
        )
    except Exception:
        return ""
    return token

def restore_user_from_session() -> bool:
    # The opaque token is restored from the encrypted browser cookie after a
    # full refresh. It is never written to URL query parameters.
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
    last_seen = row.get("last_seen_at") or row.get("login_at")
    try:
        last = datetime.fromisoformat(last_seen)
        if datetime.now() - last > timedelta(minutes=SESSION_TIMEOUT_MINUTES):
            run_query("UPDATE user_sessions SET status='Expired', logout_at=?, updated_at=? WHERE session_token=?", (now_iso(), now_iso(), token_hash))
            log_audit("SESSION_EXPIRED", "User", row.get("user_id"), "Session expired", row.get("user_id"), row.get("role"))
            return False
    except Exception:
        pass
    user = {k: row[k] for k in row.keys() if k in {"id", "username", "full_name", "role", "password_hash", "must_change_password", "is_active", "last_login_at", "account_locked", "failed_login_count", "created_at", "updated_at"}}
    st.session_state["user"] = user
    st.session_state["last_seen_at"] = datetime.now().isoformat(timespec="seconds")
    run_query("UPDATE user_sessions SET last_seen_at=?, updated_at=? WHERE session_token=?", (now_iso(), now_iso(), token_hash))
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
    last_seen = st.session_state.get("last_seen_at")
    if not last_seen:
        return False
    try:
        last = datetime.fromisoformat(last_seen)
    except ValueError:
        return False
    return datetime.now() - last > timedelta(minutes=SESSION_TIMEOUT_MINUTES)


def require_user() -> bool:
    if "user" not in st.session_state:
        if not restore_user_from_session():
            # Shared workspace URLs can include a sender's navigation hints.
            # Anonymous visitors always start at the login page.
            _clear_navigation_query_params()
            return False
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


def login_panel():
    """Render a fixed-height CMOTD login screen without page scrolling.

    Authentication, passwords, SQLite records, roles, permissions and the
    shared-link login protection remain unchanged.  This function only
    controls the anonymous login presentation.
    """
    logo_uri = company_logo_data_uri()
    company_logo = (
        f'<img src="{logo_uri}" alt="{COMPANY_NAME}" />'
        if logo_uri
        else '<span class="pf-login-company-fallback">CMOTD</span>'
    )

    # Scoped CSS: it is active only while the anonymous login marker exists.
    # Desktop intentionally uses the visible browser viewport as the complete
    # canvas so the page is static rather than a vertically scrolling form.
    st.markdown(
        """
        <style>
        html:has(.pf-login-page),
        body:has(.pf-login-page) {
            height:100% !important;
            max-height:100% !important;
            overflow:hidden !important;
            background:#f8fbff !important;
        }
        body:has(.pf-login-page) [data-testid="stApp"],
        body:has(.pf-login-page) [data-testid="stAppViewContainer"],
        body:has(.pf-login-page) .main,
        body:has(.pf-login-page) [data-testid="stMain"] {
            height:100dvh !important;
            min-height:100dvh !important;
            max-height:100dvh !important;
            overflow:hidden !important;
            background:#f8fbff !important;
        }
        body:has(.pf-login-page) [data-testid="stHeader"] { display:none !important; }
        body:has(.pf-login-page) [data-testid="stMainBlockContainer"],
        body:has(.pf-login-page) .main .block-container {
            width:100% !important;
            max-width:none !important;
            height:100dvh !important;
            min-height:100dvh !important;
            max-height:100dvh !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
        }
        body:has(.pf-login-page) .pf-login-page {
            position:absolute !important;
            width:0 !important;
            height:0 !important;
            overflow:hidden !important;
            pointer-events:none !important;
        }
        body:has(.pf-login-page) .pf-login-page::before,
        body:has(.pf-login-page) .pf-login-page::after {
            content:"";
            position:fixed;
            z-index:0;
            pointer-events:none;
        }
        body:has(.pf-login-page) .pf-login-page::before {
            top:22px;
            right:42px;
            width:96px;
            height:96px;
            background-image:radial-gradient(circle,rgba(34,104,232,.22) 1.6px,transparent 2px);
            background-size:16px 16px;
        }
        body:has(.pf-login-page) .pf-login-page::after {
            right:-165px;
            bottom:-190px;
            width:660px;
            height:590px;
            border:1px solid rgba(58,119,228,.12);
            border-radius:50%;
            box-shadow:0 0 0 28px rgba(58,119,228,.040),0 0 0 58px rgba(58,119,228,.027),0 0 0 88px rgba(58,119,228,.018);
        }

        /* Fixed, full-screen two-panel composition. */
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) {
            position:relative !important;
            z-index:1 !important;
            width:100% !important;
            height:100dvh !important;
            min-height:100dvh !important;
            max-height:100dvh !important;
            gap:0 !important;
            align-items:stretch !important;
            overflow:hidden !important;
        }
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"] {
            height:100dvh !important;
            min-height:100dvh !important;
            max-height:100dvh !important;
            overflow:hidden !important;
        }
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:first-child {
            flex:0 0 45% !important;
            width:45% !important;
            background:#073378 !important;
        }
        body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:last-child {
            flex:0 0 55% !important;
            width:55% !important;
            position:relative !important;
            background:linear-gradient(145deg,#f8fbff 0%,#f5f9ff 100%) !important;
        }
        .pf-login-left-anchor,
        .pf-login-right-stage {
            width:0 !important;
            height:0 !important;
            min-height:0 !important;
            margin:0 !important;
            padding:0 !important;
            overflow:hidden !important;
        }
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) [data-testid="stImage"],
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) [data-testid="stImage"] > div,
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) [data-testid="stImage"] img {
            display:block !important;
            width:100% !important;
            height:100dvh !important;
            min-height:100dvh !important;
            max-height:100dvh !important;
            margin:0 !important;
            padding:0 !important;
        }
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-left-anchor) [data-testid="stImage"] img {
            object-fit:cover !important;
            object-position:center center !important;
        }
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) > div:first-child,
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) [data-testid="stVerticalBlock"]:has(.pf-login-right-stage) {
            height:100dvh !important;
            min-height:100dvh !important;
            max-height:100dvh !important;
            overflow:hidden !important;
        }
        body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) [data-testid="stVerticalBlock"]:has(.pf-login-right-stage) {
            display:flex !important;
            flex-direction:column !important;
            justify-content:center !important;
            gap:0 !important;
            padding:22px 0 !important;
            box-sizing:border-box !important;
        }

        /* Compact login card: every control remains above the bottom edge. */
        body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) {
            width:min(calc(100% - 56px),630px) !important;
            margin:0 auto !important;
            overflow:hidden !important;
            background:rgba(255,255,255,.97) !important;
            border:1px solid rgba(220,230,246,.98) !important;
            border-radius:18px !important;
            box-shadow:0 18px 46px rgba(41,84,150,.10) !important;
        }
        body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) > div {
            padding:34px 54px 26px !important;
        }
        .pf-login-brand {
            display:flex;
            justify-content:center;
            align-items:center;
            min-height:48px;
            margin:0 0 14px;
        }
        .pf-login-brand img {
            display:block;
            width:min(100%,340px);
            max-height:54px;
            object-fit:contain;
        }
        .pf-login-company-fallback { font-weight:850; color:#102a56; font-size:18px; }
        .pf-login-title {
            margin:0;
            color:#0b1f48;
            font-size:27px;
            font-weight:850;
            line-height:1.16;
            letter-spacing:-.035em;
            text-align:center;
        }
        .pf-login-title strong { color:#1461e7; font-weight:850; }
        .pf-login-subtitle {
            max-width:535px;
            margin:9px auto 18px;
            color:#4f6389;
            font-size:14px;
            font-weight:550;
            line-height:1.54;
            text-align:center;
        }
        .pf-login-divider {
            position:relative;
            height:2px;
            margin:0 0 20px;
            background:#e3eaf6;
        }
        .pf-login-divider::before {
            content:"";
            position:absolute;
            top:-1px;
            left:calc(50% - 21px);
            width:42px;
            height:3px;
            border-radius:99px;
            background:#1967ee;
        }
        body:has(.pf-login-page) [data-testid="stForm"],
        body:has(.pf-login-page) [data-testid="stForm"] > div,
        body:has(.pf-login-page) [data-testid="stForm"] form {
            margin:0 !important;
            padding:0 !important;
            border:0 !important;
            background:transparent !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"] { margin-bottom:16px !important; }
        body:has(.pf-login-page) [data-testid="stTextInput"] label,
        body:has(.pf-login-page) [data-testid="stTextInput"] [data-testid="stWidgetLabel"] p {
            color:#1c3259 !important;
            font-size:13px !important;
            font-weight:800 !important;
            margin-bottom:7px !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"] input {
            min-height:48px !important;
            padding:0 47px 0 46px !important;
            border:1px solid #cbd9ee !important;
            border-radius:9px !important;
            background-color:#fff !important;
            color:#243a61 !important;
            font-size:14px !important;
            font-weight:600 !important;
            box-shadow:0 1px 2px rgba(20,50,102,.02) !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"] input:focus {
            border-color:#2a6ce8 !important;
            box-shadow:0 0 0 3px rgba(42,108,232,.12) !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"]:has(input[type="text"]) input {
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' fill='none' stroke='%238095b7' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='M20 21a8 8 0 1 0-16 0'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E") !important;
            background-repeat:no-repeat !important;
            background-position:16px center !important;
            background-size:18px !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"]:has(input[type="password"]) input {
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' fill='none' stroke='%238095b7' stroke-width='2' viewBox='0 0 24 24'%3E%3Crect x='5' y='10' width='14' height='10' rx='2'/%3E%3Cpath d='M8 10V7a4 4 0 0 1 8 0v3'/%3E%3C/svg%3E") !important;
            background-repeat:no-repeat !important;
            background-position:16px center !important;
            background-size:18px !important;
        }
        body:has(.pf-login-page) [data-testid="stTextInput"] button { right:13px !important; color:#6880a7 !important; }
        .pf-login-options {
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:16px;
            margin:-1px 0 16px;
            color:#314b77;
            font-size:13px;
            font-weight:650;
        }
        .pf-login-options .pf-remember { display:inline-flex; align-items:center; gap:8px; }
        .pf-login-options .pf-remember i {
            width:15px;
            height:15px;
            display:inline-block;
            border:1.5px solid #9db0ce;
            border-radius:3px;
            background:#fff;
        }
        .pf-login-options .pf-forgot { color:#1766ed; font-weight:750; }
        body:has(.pf-login-page) [data-testid="stFormSubmitButton"] button {
            min-height:50px !important;
            border:0 !important;
            border-radius:9px !important;
            background:linear-gradient(90deg,#1767e8 0%,#1461dc 100%) !important;
            color:#fff !important;
            font-size:15px !important;
            font-weight:800 !important;
            box-shadow:0 9px 18px rgba(20,95,221,.20) !important;
        }
        body:has(.pf-login-page) [data-testid="stFormSubmitButton"] button:hover {
            background:linear-gradient(90deg,#0f5dde 0%,#0e54c9 100%) !important;
            transform:translateY(-1px);
        }
        .pf-login-card-footer {
            margin-top:18px;
            color:#6c80a3;
            font-size:12px;
            font-weight:650;
            text-align:center;
        }
        .pf-login-card-footer b { color:#1c64df; padding:0 8px; }
        .pf-login-legal {
            width:min(calc(100% - 56px),630px);
            margin:12px auto 0;
            color:#7184a5;
            font-size:11px;
            line-height:1.55;
            text-align:center;
        }

        @media (max-height:820px) and (min-width:781px) {
            body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) > div { padding:28px 48px 20px !important; }
            .pf-login-brand { min-height:42px; margin-bottom:10px; }
            .pf-login-brand img { max-height:48px; }
            .pf-login-title { font-size:24px; }
            .pf-login-subtitle { margin:7px auto 13px; font-size:13px; line-height:1.45; }
            .pf-login-divider { margin-bottom:15px; }
            body:has(.pf-login-page) [data-testid="stTextInput"] { margin-bottom:12px !important; }
            body:has(.pf-login-page) [data-testid="stTextInput"] input { min-height:45px !important; }
            .pf-login-options { margin:0 0 12px; }
            body:has(.pf-login-page) [data-testid="stFormSubmitButton"] button { min-height:47px !important; }
            .pf-login-card-footer { margin-top:14px; }
            .pf-login-legal { margin-top:9px; }
        }
        @media (max-width:780px) {
            html:has(.pf-login-page), body:has(.pf-login-page),
            body:has(.pf-login-page) [data-testid="stApp"],
            body:has(.pf-login-page) [data-testid="stAppViewContainer"],
            body:has(.pf-login-page) .main,
            body:has(.pf-login-page) [data-testid="stMain"],
            body:has(.pf-login-page) [data-testid="stMainBlockContainer"],
            body:has(.pf-login-page) .main .block-container {
                height:auto !important;
                min-height:100dvh !important;
                max-height:none !important;
                overflow:auto !important;
            }
            body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) { height:auto !important; min-height:100dvh !important; max-height:none !important; }
            body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:first-child { display:none !important; }
            body:has(.pf-login-page) [data-testid="stHorizontalBlock"]:has(.pf-login-left-anchor) > [data-testid="stColumn"]:last-child { flex:0 0 100% !important; width:100% !important; }
            body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) > div:first-child,
            body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) [data-testid="stVerticalBlock"]:has(.pf-login-right-stage) { height:auto !important; min-height:100dvh !important; max-height:none !important; overflow:visible !important; }
            body:has(.pf-login-page) [data-testid="stColumn"]:has(.pf-login-right-stage) [data-testid="stVerticalBlock"]:has(.pf-login-right-stage) { justify-content:center !important; padding:30px 0 !important; }
            body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) { width:calc(100% - 32px) !important; }
            body:has(.pf-login-page) [data-testid="stVerticalBlockBorderWrapper"]:has(.pf-login-brand) > div { padding:34px 24px 28px !important; }
            .pf-login-title { font-size:23px; }
            .pf-login-subtitle { font-size:13px; }
            .pf-login-legal { width:calc(100% - 32px); }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    # A marker enables the CSS to stay strictly limited to this anonymous page.
    st.markdown('<div class="pf-login-page" aria-hidden="true"></div>', unsafe_allow_html=True)
    left_column, right_column = st.columns([45, 55], gap="small")

    with left_column:
        st.markdown('<div class="pf-login-left-anchor" aria-hidden="true"></div>', unsafe_allow_html=True)
        # Streamlit serves this local image through its managed media endpoint.
        # That is more reliable than a large CSS data-URI on Streamlit Cloud.
        st.image(str(LOGIN_VISUAL_PATH), use_container_width=True)

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
                st.markdown(
                    """
                    <div class="pf-login-options" aria-label="Login assistance">
                        <span class="pf-remember"><i aria-hidden="true"></i>Remember me</span>
                        <span class="pf-forgot">Forgot password?</span>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )
                submitted = st.form_submit_button("↪  Login", use_container_width=True)
                if submitted:
                    user = login_user(username, password)
                    if user:
                        st.session_state["user"] = user
                        st.session_state["last_seen_at"] = datetime.now().isoformat(timespec="seconds")
                        token = create_persistent_session(user)
                        if token:
                            st.session_state["pf_session_token"] = token
                            _store_browser_session_token(token)
                        log_audit("LOGIN", "User", user["id"], "User logged in", user["id"], user.get("role"))
                        st.rerun()
                    else:
                        st.error("Invalid username or password.")
            st.markdown(
                """
                <div class="pf-login-card-footer">Secure<b>•</b>Reliable<b>•</b>Built for Procurement Excellence</div>
                """,
                unsafe_allow_html=True,
            )
        st.markdown(
            f'<div class="pf-login-legal">© 2026 {COMPANY_NAME}.<br />All rights reserved.</div>',
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
