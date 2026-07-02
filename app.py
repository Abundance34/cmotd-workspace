import streamlit as st

from core.db import init_db, df_query, run_query, now_iso
from core.auth import initialize_browser_session_storage, login_panel, logout_button, require_user
from modules.role_workspaces import render_app, render_notification_panel
from core.permissions import display_role
from core.branding import COMPANY_NAME, company_logo_data_uri


@st.cache_resource(show_spinner=False)
def boot_database_once():
    """Initialize SQLite schema/seeds once per Streamlit server process.

    Streamlit reruns the script on every click. Running all migrations and seed
    checks on every navigation click makes the UI feel slow, so this wrapper
    keeps startup safety while avoiding repeated database boot work.
    """
    init_db()
    return True


ROLE_LANDING = {
    "Admin": "Admin Console",
    "Procurement Manager": "Procurement Workspace",
    "Facility Manager": "Utility Head / Facility Head Workspace",
    "Logistics Officer": "Logistics Workspace",
    "Finance": "Finance Workspace",
    "Approver": "Executive Approval Workspace",
    "Auditor": "Audit & Compliance Workspace",
}


ROLE_SECTIONS = {
    "Admin": (
        "Admin Navigation",
        "admin_section",
        [
            "Admin Dashboard",
            "Budget Tracker",
            "Income",
            "User Management",
            "Roles & Permissions",
            "Approval Configuration",
            "Import Center",
            "All Procurement Records",
            "Notifications Monitor",
            "Availability & Delegation Requests",
            "Gateway Pass Management",
            "Activity & History Logs",
            "Audit Logs",
            "Backup / Export",
            "Settings",
        ],
    ),
    "Procurement Manager": (
        "Procurement Navigation",
        "procurement_section",
        [
            "Operations Dashboard",
            "Purchase Requests",
            "Low-Value Approvals",
            "Utility Head / Facility Head Inbox",
            "Import Center",
            "Sourcing",
            "Vendor Quotes",
            "Vendor Recommendation",
            "Commercial PO Management",
            "Vendors",
            "Gateway Pass Review",
            "Post-Payment Closure",
            "Availability / Away Notice",
            "Procurement Documents",
            "Procurement Reports",
            "Income",
            "My Activity History",
            "Settings",
        ],
    ),
    "Facility Manager": (
        "Utility / Facility Navigation",
        "facility_section",
        [
            "Utility / Facility Dashboard",
            "Create Request Draft",
            "My Draft Requests",
            "Submit to Procurement Manager",
            "Import Documents",
            "Gateway Pass",
            "Shared Thread with Procurement Manager",
            "Returned Requests",
            "Approved / Accepted Requests",
            "Income",
            "My Activity History",
            "Settings",
        ],
    ),
    "Logistics Officer": (
        "Logistics Navigation",
        "logistics_section",
        [
            "Logistics Dashboard",
            "PO Delivery Handover",
            "Delivery Tracking",
            "Receiving Slips",
            "Delivery Exceptions & Returns",
            "Gateway Pass Coordination",
            "Logistics Documents",
            "My Activity History",
            "Settings",
        ],
    ),
    "Finance": (
        "Finance Navigation",
        "finance_section",
        [
            "Financial Dashboard",
            "Approved for Payment",
            "Receipts",
            "Invoices",
            "Expenses",
            "Payments",
            "Cash Advances",
            "Budgets",
            "Income",
            "Vendor Payment Records",
            "Reconciliation",
            "Financial Reports",
            "Settings",
        ],
    ),
    "Approver": (
        "Executive Navigation",
        "executive_section",
        [
            "Approval Dashboard",
            "Pending Approvals",
            "Quote Comparison",
            "PO Approval",
            "Payment Approval",
            "Gateway Pass Approval",
            "Availability / Away Notice",
            "My Approval History",
            "Income",
            "Settings",
        ],
    ),
    "Auditor": (
        "Audit Navigation",
        "audit_section",
        [
            "Audit Dashboard",
            "All Activity & Evidence Ledger",
            "Procurement Records",
            "Sourcing & Vendor Quote Audit",
            "Purchase Order & Logistics Evidence",
            "Receiving Slips, Proof of Delivery & Returns",
            "Finance, Invoice & Payment Audit",
            "Approval Trails",
            "Delegated Approval Review",
            "Payment Payee / Bank Detail Access Audit",
            "Gateway Pass Audit",
            "Document Archive & Download Audit",
            "Notification Delivery Audit",
            "User & Security Audit",
            "Vendor History",
            "Budget Audit",
            "Facility / Utility Handoff Trail",
            "Expense Review",
            "Compliance Reports",
            "Income",
            "Settings",
        ],
    ),
}



def inject_shell_css():
    """Inject the shared Manage.ly-inspired ProcureFlow visual shell.

    This changes presentation only: it does not alter navigation state,
    permissions, database calls, page contents, or workflow behavior.
    """
    st.markdown(
        """
        <style>
        :root {
            --pf-navy: #0f172a;
            --pf-sidebar: #111827;
            --pf-sidebar-soft: #1f2937;
            --pf-blue: #2563eb;
            --pf-blue-dark: #1d4ed8;
            --pf-blue-soft: #eaf2ff;
            --pf-page: #f6f8fc;
            --pf-card: #ffffff;
            --pf-line: #e6ebf2;
            --pf-text: #162033;
            --pf-muted: #6b7280;
        }

        [data-testid="stAppViewContainer"] {
            background: var(--pf-page) !important;
        }
        [data-testid="stApp"] {
            background: var(--pf-page) !important;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: var(--pf-text);
        }
        [data-testid="stHeader"] {
            background: transparent !important;
            border-bottom: 0 !important;
        }
        [data-testid="stToolbar"] { right: 1rem !important; }
        [data-testid="stMainBlockContainer"], .main .block-container {
            max-width: 1560px;
            padding-top: 1.15rem;
            padding-bottom: 3rem;
        }

        /* Main top utility bar */
        .pf-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            min-height: 64px;
            margin: 0 0 21px;
            padding: 0 0 17px;
            border-bottom: 1px solid var(--pf-line);
        }
        .pf-topbar-context { min-width: 0; }
        .pf-breadcrumb {
            color: var(--pf-text);
            font-size: 15px;
            font-weight: 800;
            letter-spacing: -0.01em;
        }
        .pf-breadcrumb span { color: #a7b1c2; padding: 0 7px; }
        .pf-topbar-label {
            color: var(--pf-muted);
            font-size: 12px;
            margin-top: 3px;
        }
        .pf-topbar-user {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }
        .pf-avatar {
            width: 35px;
            height: 35px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 35px;
            border-radius: 50%;
            background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
            border: 1px solid #bfdbfe;
            color: #1d4ed8;
            font-size: 13px;
            font-weight: 800;
        }
        .pf-user-copy { min-width: 0; line-height: 1.2; }
        .pf-user-name {
            color: var(--pf-text);
            font-size: 13px;
            font-weight: 800;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 185px;
        }
        .pf-user-caption { color: var(--pf-muted); font-size: 11px; margin-top: 2px; }
        .pf-role-pill, .pf-landing-pill {
            display: inline-flex;
            align-items: center;
            min-height: 28px;
            padding: 5px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 800;
            white-space: nowrap;
        }
        .pf-role-pill { background: var(--pf-blue-soft); color: var(--pf-blue-dark); border: 1px solid #d4e4ff; }
        .pf-landing-pill { background: #f3f6fa; color: #5f6d80; border: 1px solid #e7edf4; }

        /* Dark operational sidebar */
        section[data-testid="stSidebar"],
        section[data-testid="stSidebar"] > div:first-child {
            background: var(--pf-sidebar) !important;
        }
        section[data-testid="stSidebar"] {
            border-right: 1px solid rgba(255,255,255,.055) !important;
        }
        section[data-testid="stSidebar"] > div:first-child {
            padding-top: .55rem;
        }
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h1,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h2,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h3,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h4,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] span,
        section[data-testid="stSidebar"] label,
        section[data-testid="stSidebar"] [data-testid="stCaptionContainer"],
        section[data-testid="stSidebar"] [data-testid="stAlert"] {
            color: #d8e0ed !important;
        }
        .pf-sidebar-brand {
            display: flex;
            align-items: center;
            gap: 11px;
            margin: 1px 0 25px;
            padding: 3px 7px 0;
        }
        .pf-sidebar-logo {
            width: 31px;
            height: 31px;
            display: grid;
            place-items: center;
            border-radius: 10px;
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
            box-shadow: 0 7px 16px rgba(37,99,235,.25);
            font-size: 11px;
            font-weight: 900;
            letter-spacing: -.04em;
        }
        .pf-sidebar-product {
            color: #f8fafc;
            font-size: 17px;
            font-weight: 800;
            letter-spacing: -.03em;
        }
        .pf-sidebar-caption {
            color: #93a4bb;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
            margin-top: 2px;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] > div {
            gap: 2px;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label {
            width: 100%;
            min-height: 37px;
            display: flex !important;
            align-items: center;
            margin: 0 0 2px !important;
            padding: 8px 10px !important;
            border: 1px solid transparent;
            border-radius: 10px;
            color: #bfcbda !important;
            font-size: 13px;
            font-weight: 650;
            line-height: 1.22;
            transition: background .14s ease, color .14s ease, border-color .14s ease;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label:hover {
            background: rgba(148,163,184,.12);
            color: #ffffff !important;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label:has(input:checked) {
            background: linear-gradient(90deg, rgba(37,99,235,.95), rgba(37,99,235,.68));
            border-color: rgba(96,165,250,.35);
            color: #ffffff !important;
            box-shadow: 0 5px 12px rgba(0,0,0,.12);
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label > div:first-child {
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            opacity: 0 !important;
            overflow: hidden !important;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label p {
            color: inherit !important;
            margin: 0 !important;
        }
        section[data-testid="stSidebar"] hr {
            border-color: rgba(148,163,184,.18) !important;
        }
        section[data-testid="stSidebar"] .stButton > button {
            background: rgba(255,255,255,.06) !important;
            color: #e2e8f0 !important;
            border: 1px solid rgba(148,163,184,.22) !important;
            box-shadow: none !important;
        }
        section[data-testid="stSidebar"] .stButton > button:hover {
            background: rgba(255,255,255,.12) !important;
            border-color: rgba(191,219,254,.45) !important;
        }
        section[data-testid="stSidebar"] [data-testid="stAlert"] {
            background: rgba(30,41,59,.82) !important;
            border-color: rgba(96,165,250,.20) !important;
        }

        /* Login page */
        .pf-login-heading {
            display: flex;
            align-items: flex-start;
            gap: 13px;
            margin: 5.5rem 0 18px;
        }
        .pf-login-mark {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            flex: 0 0 42px;
            border-radius: 13px;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            color: #ffffff;
            box-shadow: 0 8px 18px rgba(37,99,235,.18);
            font-size: 13px;
            font-weight: 900;
        }
        .pf-login-heading h1 {
            margin: -2px 0 5px;
            color: var(--pf-text);
            font-size: clamp(1.55rem, 2.3vw, 2.15rem);
            font-weight: 800;
            line-height: 1.13;
            letter-spacing: -.035em;
        }
        .pf-login-heading p {
            margin: 0;
            color: var(--pf-muted);
            font-size: .88rem;
            line-height: 1.5;
        }
        @media (max-width: 860px) {
            .pf-login-heading { margin-top: 2.4rem; }
        }

        /* Responsive main shell */
        @media (max-width: 900px) {
            .pf-topbar { align-items: flex-start; flex-direction: column; gap: 10px; }
            .pf-topbar-user { width: 100%; flex-wrap: wrap; }
            .pf-role-pill, .pf-landing-pill { font-size: 10px; }
        }

        /*
         * Modern desktop-shell refinement
         * Presentation only: this intentionally overrides spacing and native
         * Streamlit chrome without changing any page routing or application data.
         */
        :root {
            --pf-primary: #2563eb;
            --pf-primary-hover: #1d4ed8;
            --pf-canvas: #f8fafc;
            --pf-surface: #ffffff;
            --pf-border: #e4e7ec;
            --pf-heading: #101828;
            --pf-copy: #344054;
            --pf-subtle: #667085;
            /* A brighter, modern blue shell shared by every signed-in role. */
            --pf-sidebar-deep: #2b73d6;
            --pf-sidebar-text: #ffffff;
        }

        /* Remove Streamlit Cloud chrome so it cannot collide with the app bar. */
        [data-testid="stHeader"],
        [data-testid="stToolbar"],
        [data-testid="stDecoration"],
        [data-testid="stStatusWidget"],
        #MainMenu,
        footer {
            display: none !important;
        }
        [data-testid="stAppViewContainer"],
        [data-testid="stApp"],
        [data-testid="stMain"] {
            background: var(--pf-canvas) !important;
        }
        [data-testid="stMainBlockContainer"],
        .main .block-container {
            max-width: 1600px !important;
            padding: 18px 30px 52px !important;
        }
        @media (min-width: 1500px) {
            [data-testid="stMainBlockContainer"],
            .main .block-container { padding-left: 46px !important; padding-right: 46px !important; }
        }

        /* Compact application bar: no repeated chips or tall empty region. */
        .pf-topbar {
            min-height: 48px !important;
            margin: 0 0 24px !important;
            padding: 0 0 13px !important;
            gap: 14px !important;
            border-bottom: 1px solid var(--pf-border) !important;
        }
        .pf-breadcrumb {
            color: var(--pf-heading) !important;
            font-size: 14px !important;
            font-weight: 720 !important;
            letter-spacing: -0.015em !important;
        }
        .pf-breadcrumb span { color: #98a2b3 !important; padding: 0 8px !important; font-weight: 400; }
        .pf-topbar-label,
        .pf-role-pill,
        .pf-landing-pill { display: none !important; }
        .pf-topbar-user {
            gap: 8px !important;
            padding: 5px 10px 5px 5px;
            border: 1px solid var(--pf-border);
            border-radius: 12px;
            background: var(--pf-surface);
            box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
        }
        .pf-avatar {
            width: 30px !important;
            height: 30px !important;
            flex-basis: 30px !important;
            border-radius: 9px !important;
            background: #eff4ff !important;
            border-color: #d1e0ff !important;
            color: #175cd3 !important;
            font-size: 11px !important;
            box-shadow: none !important;
        }
        .pf-user-name { color: var(--pf-heading) !important; font-size: 12px !important; font-weight: 720 !important; }
        .pf-user-caption { color: var(--pf-subtle) !important; font-size: 10px !important; }

        /* Sidebar is intentionally narrow and dense, like a modern operational app. */
        section[data-testid="stSidebar"],
        section[data-testid="stSidebar"] > div:first-child {
            width: 272px !important;
            min-width: 272px !important;
            max-width: 272px !important;
            background: linear-gradient(180deg, #3b82f6 0%, var(--pf-sidebar-deep) 100%) !important;
        }
        [data-testid="stSidebarHeader"] {
            display: none !important;
            height: 0 !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
        }
        section[data-testid="stSidebar"] > div:first-child {
            padding-top: 0 !important;
        }
        [data-testid="stSidebarContent"] {
            padding: 18px 12px !important;
        }
        [data-testid="stSidebarContent"] > div { padding: 0 !important; }
        .pf-sidebar-brand {
            gap: 9px !important;
            margin: 0 0 20px !important;
            padding: 0 6px !important;
        }
        .pf-sidebar-logo {
            width: 32px !important;
            height: 32px !important;
            border-radius: 9px !important;
            background: #2563eb !important;
            box-shadow: none !important;
        }
        .pf-sidebar-product {
            color: #ffffff !important;
            font-size: 15px !important;
            font-weight: 800 !important;
        }
        .pf-sidebar-caption {
            color: #ffffff !important;
            font-size: 9px !important;
            font-weight: 750 !important;
            letter-spacing: .09em !important;
        }
        .pf-sidebar-nav-label {
            margin: 0 0 8px;
            padding: 0 8px;
            color: #ffffff !important;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .09em;
            text-transform: uppercase;
        }
        /* Hide the native radio group label. The custom label above is its visual replacement. */
        section[data-testid="stSidebar"] [data-testid="stRadio"] > label[data-testid="stWidgetLabel"],
        section[data-testid="stSidebar"] [data-testid="stRadio"] > label:first-child {
            display: none !important;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] > div { gap: 2px !important; }
        /* All navigation text is deliberately white and bold for immediate contrast. */
        section[data-testid="stSidebar"] [data-testid="stRadio"] label {
            min-height: 35px !important;
            margin: 0 0 2px !important;
            padding: 8px 10px !important;
            border-radius: 8px !important;
            color: #ffffff !important;
            font-size: 12px !important;
            font-weight: 750 !important;
            line-height: 1.18 !important;
            box-shadow: none !important;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label:hover {
            background: rgba(255,255,255,.15) !important;
            color: #ffffff !important;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label:has(input:checked) {
            background: #155ecb !important;
            border-color: rgba(255,255,255,.40) !important;
            color: #ffffff !important;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,.10) !important;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] label p,
        section[data-testid="stSidebar"] [data-testid="stRadio"] label span {
            color: #ffffff !important;
            font-weight: 750 !important;
            overflow-wrap: anywhere;
        }
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] span,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h1,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h2,
        section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h3,
        section[data-testid="stSidebar"] [data-testid="stWidgetLabel"] p,
        section[data-testid="stSidebar"] [data-testid="stWidgetLabel"] span,
        section[data-testid="stSidebar"] .stButton > button {
            color: #ffffff !important;
            font-weight: 750 !important;
        }
        section[data-testid="stSidebar"] .stButton > button {
            background: rgba(255,255,255,.12) !important;
            border-color: rgba(255,255,255,.30) !important;
        }
        section[data-testid="stSidebar"] [data-testid="stRadio"] { margin-bottom: 4px !important; }
        section[data-testid="stSidebar"] [data-testid="stDivider"] { margin: 12px 0 !important; }

        /* CMOTD company branding: shared by every role workspace. */
        .pf-sidebar-brand {
            display: block !important;
            margin: 0 0 20px !important;
            padding: 0 4px !important;
        }
        .pf-company-logo-card {
            display: flex;
            align-items: center;
            width: 100%;
            min-height: 62px;
            padding: 9px 11px;
            overflow: hidden;
            background: rgba(255,255,255,.98);
            border: 1px solid rgba(255,255,255,.72);
            border-radius: 13px;
            box-shadow: 0 8px 20px rgba(18, 78, 163, .16);
        }
        .pf-company-logo-card img {
            display: block;
            width: 100%;
            max-width: 100%;
            height: auto;
            max-height: 43px;
            object-fit: contain;
            object-position: left center;
        }
        .pf-company-logo-fallback {
            color: #123a72;
            font-size: 13px;
            font-weight: 850;
            letter-spacing: .015em;
        }
        .pf-sidebar-app-meta {
            display: flex;
            align-items: baseline;
            gap: 7px;
            margin-top: 9px;
            padding: 0 3px;
        }
        .pf-sidebar-brand .pf-sidebar-product {
            color: #ffffff !important;
            font-size: 15px !important;
            font-weight: 850 !important;
            line-height: 1.1;
        }
        .pf-sidebar-brand .pf-sidebar-caption {
            color: rgba(255,255,255,.94) !important;
            font-size: 8.5px !important;
            font-weight: 800 !important;
            letter-spacing: .075em !important;
            line-height: 1.1;
        }

        .pf-login-company-brand {
            display: flex;
            align-items: center;
            width: fit-content;
            max-width: 100%;
            min-height: 60px;
            margin: 3.15rem 0 13px;
            padding: 8px 12px;
            overflow: hidden;
            background: rgba(255,255,255,.94);
            border: 1px solid var(--pf-border);
            border-radius: 13px;
            box-shadow: 0 6px 18px rgba(16, 24, 40, .045);
        }
        .pf-login-company-brand img {
            display: block;
            width: min(100%, 340px);
            height: auto;
            max-height: 44px;
            object-fit: contain;
            object-position: left center;
        }
        .pf-login-company-brand .pf-company-logo-fallback {
            color: var(--pf-heading);
        }
        .pf-login-heading {
            margin: 0 0 18px !important;
        }
        @media (max-width: 860px) {
            .pf-login-company-brand { margin-top: 2rem; }
        }

        @media (max-width: 860px) {
            [data-testid="stMainBlockContainer"],
            .main .block-container { padding: 14px 16px 34px !important; }
            .pf-topbar { margin-bottom: 18px !important; }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_top_header(current: dict):
    """Render the compact user/context bar without changing workspace content."""
    from html import escape

    landing = ROLE_LANDING.get(current["role"], "Workspace")
    full_name = escape(str(current.get("full_name") or "User"))
    role = escape(str(display_role(current["role"])))
    landing_label = escape(str(landing))
    initials = "".join(part[:1] for part in str(current.get("full_name") or "User").split()[:2]).upper() or "U"
    initials = escape(initials)
    st.markdown(
        f"""
        <div class="pf-topbar">
            <div class="pf-topbar-context">
                <div class="pf-breadcrumb">ProcureFlow <span>/</span> {landing_label}</div>
            </div>
            <div class="pf-topbar-user" aria-label="Signed-in user: {full_name}, {role}">
                <div class="pf-avatar" aria-hidden="true">{initials}</div>
                <div class="pf-user-copy">
                    <div class="pf-user-name">{full_name}</div>
                    <div class="pf-user-caption">{role}</div>
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _nav_count_query(sql: str, params: tuple = ()) -> int:
    try:
        df = df_query(sql, params)
        return int(df.iloc[0, 0]) if not df.empty else 0
    except Exception:
        return 0


def _ensure_section_seen_schema():
    """Create the attention-read table once per browser session.

    Sidebar navigation runs on every Streamlit rerun.  Repeating CREATE TABLE /
    CREATE INDEX calls for every section makes a simple tab click unnecessarily
    slow on local Windows SQLite installations.  The schema is still created
    safely when needed, but subsequent clicks use the session guard.
    """
    if st.session_state.get("_pf_section_attention_schema_ready"):
        return
    try:
        run_query(
            """
            CREATE TABLE IF NOT EXISTS section_attention_reads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                section TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                UNIQUE(user_id, role, section)
            )
            """
        )
        run_query(
            "CREATE INDEX IF NOT EXISTS idx_section_attention_reads_user_section ON section_attention_reads(user_id, role, section, last_seen_at)"
        )
        st.session_state["_pf_section_attention_schema_ready"] = True
    except Exception:
        # Keep navigation available even if a first-run database migration is
        # temporarily blocked. The next rerun can retry.
        pass


def _section_last_seen(current: dict, section: str) -> str:
    """Return one section's last seen timestamp for compatibility callers."""
    return _section_last_seen_map(current, [section]).get(section, "1970-01-01 00:00:00")


def _section_last_seen_map(current: dict, sections: list[str]) -> dict[str, str]:
    """Fetch all sidebar last-seen markers in one query.

    This replaces one SQLite connection per sidebar section. It keeps the same
    WhatsApp-style badge behaviour while avoiding dozens of database round trips
    each time a user clicks a tab.
    """
    _ensure_section_seen_schema()
    default = "1970-01-01 00:00:00"
    unique_sections = list(dict.fromkeys(str(section) for section in sections if section))
    if not unique_sections:
        return {}
    try:
        placeholders = ",".join("?" for _ in unique_sections)
        rows = df_query(
            f"""
            SELECT section, last_seen_at
            FROM section_attention_reads
            WHERE user_id=? AND role=? AND section IN ({placeholders})
            """,
            (int(current.get("id") or 0), str(current.get("role") or ""), *unique_sections),
        )
        found = {
            str(row["section"]): str(row["last_seen_at"] or default)
            for _, row in rows.iterrows()
        }
        return {section: found.get(section, default) for section in unique_sections}
    except Exception:
        return {section: default for section in unique_sections}


def mark_section_attention_seen(current: dict, section: str):
    """Clear the red badge for the section the user has just opened.

    This does not delete or complete pending work. It simply records that the
    user has viewed the section, exactly like an unread chat badge clearing
    after the chat is opened. New or updated records will show the badge again.
    """
    _ensure_section_seen_schema()
    uid = int(current.get("id") or 0)
    role = current.get("role") or ""
    ts = now_iso()
    try:
        run_query(
            """
            INSERT INTO section_attention_reads (user_id, role, section, last_seen_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, role, section)
            DO UPDATE SET last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at
            """,
            (uid, role, section, ts, ts, ts),
        )
        # Opening a section clears only the red attention badge by updating
        # section_attention_reads. It must NOT mark notification records as read,
        # otherwise users think the notification never arrived after they open
        # the tab. The bell panel remains unread until the user clicks
        # "Mark all as read".
    except Exception:
        pass


def _unread_attention_counts(current: dict, sections: list[str]) -> dict[str, int]:
    """Return unread notification badge counts for every section in one query."""
    unique_sections = list(dict.fromkeys(str(section) for section in sections if section))
    if not unique_sections:
        return {}
    try:
        placeholders = ",".join("?" for _ in unique_sections)
        rows = df_query(
            f"""
            SELECT n.section_target AS section, COUNT(*) AS count
            FROM notifications n
            LEFT JOIN section_attention_reads seen
              ON seen.user_id=?
             AND seen.role=?
             AND seen.section=n.section_target
            WHERE n.is_read=0
              AND (n.user_id=? OR n.role=? OR n.role='All')
              AND n.section_target IN ({placeholders})
              AND datetime(n.created_at) > datetime(COALESCE(seen.last_seen_at, '1970-01-01 00:00:00'))
            GROUP BY n.section_target
            """,
            (
                int(current.get("id") or 0),
                str(current.get("role") or ""),
                int(current.get("id") or 0),
                str(current.get("role") or ""),
                *unique_sections,
            ),
        )
        return {
            str(row["section"]): int(row["count"] or 0)
            for _, row in rows.iterrows()
            if row.get("section") is not None
        }
    except Exception:
        return {}


def _count_since(sql: str, params: tuple, seen_at: str) -> int:
    return _nav_count_query(sql, tuple(params) + (seen_at,))


def attention_count_for_section(
    current: dict,
    section: str,
    seen_at: str | None = None,
    unread_count: int | None = None,
) -> int:
    """Return WhatsApp-style *new since opened* counts per role section.

    ``seen_at`` and ``unread_count`` are optional batch inputs used by the
    sidebar. The public two-argument form is retained for compatibility.
    """
    role = current.get("role")
    uid = int(current.get("id") or 0)
    if seen_at is None:
        seen_at = _section_last_seen(current, section)
    if unread_count is None:
        unread_count = _unread_attention_counts(current, [section]).get(section, 0)
    unread = int(unread_count or 0)
    count = 0
    if role == "Admin":
        mapping = {
            "Admin Dashboard": ("SELECT COUNT(*) FROM user_availability WHERE (admin_review_status='Pending Review' OR status IN ('Away Requested','Away Active')) AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Notifications Monitor": ("SELECT COUNT(*) FROM notification_outbox WHERE status IN ('Queued','Fallback') AND datetime(created_at) > datetime(?)", ()),
            "Availability & Delegation Requests": ("SELECT COUNT(*) FROM user_availability WHERE (admin_review_status='Pending Review' OR status='Away Requested') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Gateway Pass Management": ("SELECT COUNT(*) FROM gateway_passes WHERE status IN ('Sent for Procurement Review','Submitted','Submitted for Approval','Pending Approval','Pending Procurement Manager / Approver Review') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Audit Logs": ("SELECT COUNT(*) FROM audit_logs WHERE action IN ('LOGIN','LOGOUT','PASSWORD_RESET','ROLE_CHANGE') AND datetime(created_at) > datetime(?)", ()),
        }
        value = mapping.get(section)
        if value:
            count = _count_since(value[0], value[1], seen_at)
    elif role == "Procurement Manager":
        mapping = {
            "Utility Head / Facility Head Inbox": ("SELECT COUNT(*) FROM purchase_requests WHERE (status IN ('Sent for Procurement Review','Submitted to Procurement Manager') OR next_role='procurement_manager') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Gateway Pass Review": ("SELECT COUNT(*) FROM gateway_passes gp WHERE (gp.status IN ('Sent for Procurement Review','Submitted','Reviewed by Procurement','Pending Procurement Manager / Approver Review') OR gp.next_role='procurement_manager') AND datetime(COALESCE(gp.updated_at, gp.created_at)) > datetime(?)", ()),
            "Post-Payment Closure": ("SELECT COUNT(*) FROM purchase_requests WHERE (status IN ('Paid','Receipt Uploaded','Payment Submitted for Verification','Completed','Closed') OR (next_role='procurement_manager' AND payment_status='Paid')) AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Purchase Requests": ("SELECT COUNT(*) FROM purchase_requests WHERE status IN ('Submitted','Procurement Review','Requires Sourcing','Vendor Quote Collection','Approved') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Low-Value Approvals": (
                "SELECT "
                "(SELECT COUNT(*) FROM purchase_requests WHERE COALESCE(estimated_amount,0) <= 100000 "
                " AND status IN ('Draft','Sent for Procurement Review','Submitted','Reviewed by Procurement','Vendor Recommendation','Submitted for Approval')) "
                "+ (SELECT COUNT(*) FROM purchase_orders WHERE COALESCE(total_amount,0) <= 100000 "
                " AND status IN ('Draft','Pending Approval')) "
                "+ (SELECT COUNT(*) FROM payments WHERE COALESCE(amount,0) <= 100000 "
                " AND status='Pending Approval' AND COALESCE(next_role,'procurement_manager')='procurement_manager')",
                (),
            ),
            "Commercial PO Management": ("SELECT COUNT(*) FROM purchase_orders WHERE status IN ('Draft','Pending Approval','Approved') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Availability / Away Notice": ("SELECT COUNT(*) FROM user_availability WHERE user_id=? AND status NOT IN ('Returned','Cancelled') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", (uid,)),
        }
        value = mapping.get(section)
        if value:
            count = _count_since(value[0], value[1], seen_at)
    elif role == "Facility Manager":
        mapping = {
            "My Draft Requests": ("SELECT COUNT(*) FROM purchase_requests WHERE facility_manager_user_id=? AND status IN ('FM Draft','Returned to Facility Manager') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", (uid,)),
            "Submit to Procurement Manager": ("SELECT COUNT(*) FROM purchase_requests WHERE facility_manager_user_id=? AND status IN ('FM Draft','Returned to Facility Manager') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", (uid,)),
            "Gateway Pass": ("SELECT COUNT(*) FROM gateway_passes WHERE facility_manager_user_id=? AND status IN ('Approved','Generated','Downloaded','Returned for Correction','Returned') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", (uid,)),
            "Returned Requests": ("SELECT COUNT(*) FROM purchase_requests WHERE facility_manager_user_id=? AND status='Returned to Facility Manager' AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", (uid,)),
            "Approved / Accepted Requests": ("SELECT COUNT(*) FROM purchase_requests WHERE facility_manager_user_id=? AND status IN ('Accepted by Procurement Manager','Approved','Paid','Closed') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", (uid,)),
        }
        value = mapping.get(section)
        if value:
            count = _count_since(value[0], value[1], seen_at)
    elif role == "Logistics Officer":
        mapping = {
            "PO Delivery Handover": ("SELECT COUNT(*) FROM purchase_orders WHERE (next_role='logistics_officer' OR status='Released to Logistics') AND COALESCE(logistics_status,'Awaiting Handover') IN ('Awaiting Handover','Not Released') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Delivery Tracking": ("SELECT COUNT(*) FROM purchase_orders WHERE next_role='logistics_officer' AND status IN ('Scheduled','Dispatched','In Transit','Delayed','Arrived','Awaiting Delivery','Sent to Vendor') AND datetime(COALESCE(delivery_updated_at, updated_at, created_at)) > datetime(?)", ()),
            "Receiving Slips": ("SELECT COUNT(*) FROM purchase_orders WHERE next_role='logistics_officer' AND status IN ('Arrived','Awaiting Delivery','Partially Received') AND COALESCE(receiving_status,'Pending Receipt') IN ('Pending Receipt','Partially Received','Disputed') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Delivery Exceptions & Returns": ("SELECT COUNT(*) FROM logistics_exceptions WHERE status IN ('Open','In Progress') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Gateway Pass Coordination": ("SELECT COUNT(*) FROM gateway_passes WHERE status IN ('Approved','Generated','Downloaded') AND datetime(COALESCE(logistics_updated_at, updated_at, created_at)) > datetime(?)", ()),
        }
        value = mapping.get(section)
        if value:
            count = _count_since(value[0], value[1], seen_at)
    elif role == "Finance":
        mapping = {
            "Approved for Payment": ("SELECT COUNT(*) FROM purchase_requests WHERE (status='Approved for Payment' OR payment_status='Approved for Payment') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Invoices": ("SELECT COUNT(*) FROM invoices WHERE (status IN ('Uploaded','Needs Review','Returned') OR match_status IN ('Needs Review','Mismatch')) AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Receipts": ("SELECT COUNT(*) FROM receipt_records WHERE status='Recorded' AND datetime(created_at) > datetime(?)", ()),
            "Payments": ("SELECT COUNT(*) FROM payments WHERE status IN ('Pending Approval','Approved') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
        }
        value = mapping.get(section)
        if value:
            count = _count_since(value[0], value[1], seen_at)
    elif role == "Approver":
        mapping = {
            "Pending Approvals": (
                "SELECT COUNT(*) FROM purchase_requests pr LEFT JOIN users u ON u.id=pr.requested_by "
                "WHERE pr.status IN ('Submitted for Approval','Pending Approval','Pending Approver/MD Approval') "
                "AND (COALESCE(pr.estimated_amount,0) > 100000 OR (COALESCE(pr.estimated_amount,0) <= 100000 AND u.role='Procurement Manager')) "
                "AND datetime(COALESCE(pr.updated_at, pr.created_at)) > datetime(?)",
                (),
            ),
            "PO Approval": ("SELECT COUNT(*) FROM purchase_orders WHERE status='Pending Approval' AND COALESCE(total_amount,0) > 100000 AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Payment Approval": ("SELECT COUNT(*) FROM payments WHERE status='Pending Approval' AND COALESCE(amount,0) > 100000 AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Gateway Pass Approval": ("SELECT COUNT(*) FROM gateway_passes WHERE (status IN ('Submitted for Approval','Pending Approval') OR next_role='approver') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Availability / Away Notice": ("SELECT COUNT(*) FROM user_availability WHERE user_id=? AND status NOT IN ('Returned','Cancelled') AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", (uid,)),
        }
        value = mapping.get(section)
        if value:
            count = _count_since(value[0], value[1], seen_at)
    elif role == "Auditor":
        mapping = {
            "Audit Dashboard": ("SELECT COUNT(*) FROM audit_events WHERE datetime(occurred_at) > datetime(?)", ()),
            "All Activity & Evidence Ledger": ("SELECT COUNT(*) FROM audit_events WHERE datetime(occurred_at) > datetime(?)", ()),
            "Sourcing & Vendor Quote Audit": ("SELECT COUNT(*) FROM sourcing_tasks WHERE datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Purchase Order & Logistics Evidence": ("SELECT COUNT(*) FROM purchase_orders WHERE datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Receiving Slips, Proof of Delivery & Returns": ("SELECT COUNT(*) FROM receiving_slips WHERE datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Finance, Invoice & Payment Audit": ("SELECT COUNT(*) FROM payments WHERE datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Payment Payee / Bank Detail Access Audit": ("SELECT COUNT(*) FROM payment_payee_details WHERE datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Gateway Pass Audit": ("SELECT COUNT(*) FROM gateway_passes WHERE datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Document Archive & Download Audit": ("SELECT COUNT(*) FROM audit_events WHERE action LIKE '%DOWNLOAD%' AND datetime(occurred_at) > datetime(?)", ()),
            "Notification Delivery Audit": ("SELECT COUNT(*) FROM notification_outbox WHERE datetime(COALESCE(sent_at, last_failure_at, created_at)) > datetime(?)", ()),
            "User & Security Audit": ("SELECT COUNT(*) FROM audit_events WHERE (action LIKE '%LOGIN%' OR action LIKE '%PASSWORD%' OR action LIKE '%DENIED%') AND datetime(occurred_at) > datetime(?)", ()),
            "Approval Trails": ("SELECT COUNT(*) FROM approval_history WHERE datetime(created_at) > datetime(?)", ()),
            "Delegated Approval Review": ("SELECT COUNT(*) FROM approval_delegations WHERE enabled=1 AND datetime(COALESCE(updated_at, created_at)) > datetime(?)", ()),
            "Budget Audit": ("SELECT COUNT(*) FROM budget_history WHERE datetime(created_at) > datetime(?)", ()),
            "Compliance Reports": ("SELECT COUNT(*) FROM notifications WHERE (role='Auditor' OR user_id=?) AND is_read=0 AND datetime(created_at) > datetime(?)", (uid,)),
        }
        value = mapping.get(section)
        if value:
            count = _count_since(value[0], value[1], seen_at)
    return max(int(count or 0), int(unread or 0))


def _build_attention_count_map(current: dict, sections: list[str]) -> dict[str, int]:
    """Build sidebar red-badge counts with batched shared lookups.

    Per-section workflow counts remain accurate, but shared last-seen and
    notification calculations are now fetched once, which removes most of the
    repeated SQLite work from ordinary tab navigation.
    """
    _ensure_section_seen_schema()
    seen_map = _section_last_seen_map(current, sections)
    unread_map = _unread_attention_counts(current, sections)
    counts: dict[str, int] = {}
    for section in sections:
        try:
            counts[section] = int(
                attention_count_for_section(
                    current,
                    section,
                    seen_at=seen_map.get(section, "1970-01-01 00:00:00"),
                    unread_count=unread_map.get(section, 0),
                )
                or 0
            )
        except Exception:
            counts[section] = 0
    return counts

def format_nav_label(section: str, counts: dict[str, int]) -> str:
    count = int(counts.get(section, 0) or 0)
    return f"{section}  🔴 {count}" if count else section


def render_sidebar_navigation(current: dict):
    nav = ROLE_SECTIONS.get(current["role"])
    if nav:
        nav_title, state_key, sections = nav
        logo_uri = company_logo_data_uri()
        company_logo = (
            f'<img src="{logo_uri}" alt="{COMPANY_NAME}" />'
            if logo_uri
            else '<span class="pf-company-logo-fallback">CMOTD</span>'
        )
        st.markdown(
            f"""
            <div class="pf-sidebar-brand">
                <div class="pf-company-logo-card" aria-label="{COMPANY_NAME}">
                    {company_logo}
                </div>
                <div class="pf-sidebar-app-meta">
                    <div class="pf-sidebar-product">ProcureFlow</div>
                    <div class="pf-sidebar-caption">Procurement workspace</div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.markdown(
            f'<div class="pf-sidebar-nav-label">{nav_title}</div>',
            unsafe_allow_html=True,
        )

        # Programmatic navigation requests are stored under a separate pending
        # key because Streamlit forbids writing to a widget-backed key after
        # that widget has been instantiated in the same run. Action buttons can
        # safely set _pending_nav_<state_key>, rerun, and this block applies the
        # destination before the sidebar radio is created.
        pending_key = f"_pending_nav_{state_key}"
        pending_section = st.session_state.pop(pending_key, None)
        if pending_section in sections:
            st.session_state[state_key] = pending_section

        # Use an explicit widget key that is the same key read by the
        # workspace renderer. This prevents the common Streamlit "one click
        # behind" navigation issue where a page falls back to the dashboard
        # and only opens the requested section after a second click.
        if state_key not in st.session_state or st.session_state[state_key] not in sections:
            persisted = None
            try:
                if st.query_params.get("pf_role") == current.get("role"):
                    persisted = st.query_params.get("pf_section")
            except Exception:
                persisted = None
            st.session_state[state_key] = persisted if persisted in sections else sections[0]

        # Streamlit updates widget session_state before the script reruns. That
        # means the clicked section is already available here, so we can clear
        # its red badge *before* rendering the radio label and without forcing
        # another st.rerun(). The page now opens on the first click.
        preselected = st.session_state.get(state_key, sections[0])
        counts = _build_attention_count_map(current, list(sections))
        if int(counts.get(preselected, 0) or 0) > 0:
            mark_section_attention_seen(current, preselected)
            counts[preselected] = 0

        selected = st.radio(
            "Navigation menu",
            sections,
            key=state_key,
            label_visibility="collapsed",
            format_func=lambda sec: format_nav_label(sec, counts),
        )
        try:
            # Avoid rewriting URL query params on every rerun. Updating them
            # unnecessarily can trigger extra browser/history work and make
            # navigation feel slower.
            if st.query_params.get("pf_section") != selected:
                st.query_params["pf_section"] = selected
            if st.query_params.get("pf_role") != current.get("role", ""):
                st.query_params["pf_role"] = current.get("role", "")
        except Exception:
            pass
    else:
        st.info("No navigation has been configured for this role.")


def main():
    st.set_page_config(
        page_title="ProcureFlow Enterprise Procurement",
        page_icon="🧾",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    boot_database_once()
    initialize_browser_session_storage()
    inject_shell_css()

    if not require_user():
        login_panel()
        return

    current = st.session_state["user"]
    render_top_header(current)

    with st.sidebar:
        render_sidebar_navigation(current)
        st.divider()
        render_notification_panel(current)
        st.divider()
        logout_button()

    render_app()


if __name__ == "__main__":
    main()
