from __future__ import annotations

import html
from typing import Any

import pandas as pd
import streamlit as st

STATUS_COLORS = {

    "FM Draft": ("#475569", "#f1f5f9"), "Submitted to Procurement Manager": ("#1d4ed8", "#dbeafe"), "PM Reviewing": ("#0369a1", "#e0f2fe"), "Returned to Facility Manager": ("#b45309", "#fef3c7"), "Accepted by Procurement Manager": ("#047857", "#d1fae5"), "Converted to Purchase Request": ("#5b21b6", "#ede9fe"), "Rejected by Procurement Manager": ("#b91c1c", "#fee2e2"), "Approved for Payment": ("#047857", "#d1fae5"), "Delegated Approval Mode": ("#5b21b6", "#ede9fe"), "Normal Approval Mode": ("#0369a1", "#e0f2fe"),
    "Draft": ("#475569", "#f1f5f9"), "Submitted": ("#1d4ed8", "#dbeafe"), "Procurement Review": ("#0369a1", "#e0f2fe"), "Requires Sourcing": ("#92400e", "#fef3c7"), "Pending Approval": ("#a16207", "#fef9c3"), "Approved": ("#047857", "#d1fae5"), "Rejected": ("#b91c1c", "#fee2e2"), "PO Created": ("#5b21b6", "#ede9fe"), "Awaiting Delivery": ("#7c2d12", "#ffedd5"), "Received": ("#166534", "#dcfce7"), "Paid": ("#15803d", "#dcfce7"), "Closed": ("#334155", "#e2e8f0"),
    "Open": ("#0369a1", "#e0f2fe"), "Pending": ("#a16207", "#fef9c3"), "Sent to Vendor": ("#5b21b6", "#ede9fe"), "Partially Received": ("#92400e", "#fef3c7"), "Fully Received": ("#047857", "#d1fae5"), "Invoiced": ("#4f46e5", "#e0e7ff"), "Cancelled": ("#b91c1c", "#fee2e2"), "Disputed": ("#b91c1c", "#fee2e2"), "Returned": ("#b91c1c", "#fee2e2"),
    "Active": ("#047857", "#d1fae5"), "Suspended": ("#b91c1c", "#fee2e2"), "Under Review": ("#a16207", "#fef9c3"), "Needs Review": ("#a16207", "#fef9c3"), "Matched": ("#047857", "#d1fae5"), "Mismatch": ("#b91c1c", "#fee2e2"), "Not Matched": ("#64748b", "#f1f5f9"),
}


def inject_css():
    """Apply the shared Manage.ly-inspired workspace presentation.

    This stylesheet intentionally leaves all database, workflow, forms, labels,
    page routing, and calculations untouched. It is a presentation layer only.
    """
    st.markdown("""
    <style>
    :root {
        --pf-blue: #2563eb;
        --pf-blue-dark: #1d4ed8;
        --pf-blue-soft: #eaf2ff;
        --pf-page: #f6f8fc;
        --pf-card: #ffffff;
        --pf-line: #e6ebf2;
        --pf-text: #162033;
        --pf-muted: #6b7280;
    }

    /* Typography and page rhythm */
    .block-container { padding-top: .15rem; padding-bottom: 3rem; }
    h1, h2, h3, h4, h5, h6,
    [data-testid="stMarkdownContainer"] h1,
    [data-testid="stMarkdownContainer"] h2,
    [data-testid="stMarkdownContainer"] h3 {
        color: var(--pf-text) !important;
        letter-spacing: -.028em;
    }
    h1, [data-testid="stMarkdownContainer"] h1 { font-weight: 800 !important; }
    h2, [data-testid="stMarkdownContainer"] h2 { font-weight: 760 !important; }
    h3, [data-testid="stMarkdownContainer"] h3 { font-weight: 740 !important; }
    [data-testid="stCaptionContainer"], .pf-muted { color: var(--pf-muted) !important; }

    /* Page heading replaces the old large dark banner with a clean command-center title. */
    .pf-hero {
        position: relative;
        margin: 0 0 19px;
        padding: 4px 0 8px 17px;
        background: transparent;
        color: var(--pf-text);
        border: 0;
        border-radius: 0;
        box-shadow: none;
    }
    .pf-hero::before {
        content: "";
        position: absolute;
        left: 0;
        top: 8px;
        bottom: 12px;
        width: 4px;
        border-radius: 999px;
        background: var(--pf-blue);
    }
    .pf-hero h1 {
        margin: 0 !important;
        color: var(--pf-text) !important;
        font-size: clamp(1.72rem, 2.7vw, 2.28rem) !important;
        font-weight: 800 !important;
        line-height: 1.12 !important;
    }
    .pf-hero p {
        max-width: 980px;
        margin: 7px 0 0 !important;
        color: var(--pf-muted) !important;
        font-size: .94rem;
        line-height: 1.5;
    }

    /* KPI cards */
    div[data-testid="stMetric"] {
        position: relative;
        overflow: hidden;
        min-height: 109px;
        padding: 17px 17px 15px;
        background: var(--pf-card);
        border: 1px solid var(--pf-line);
        border-radius: 14px;
        box-shadow: 0 3px 12px rgba(15, 23, 42, .035);
    }
    div[data-testid="stMetric"]::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        width: 4px;
        height: 100%;
        background: #dbeafe;
    }
    div[data-testid="stMetric"] label {
        color: #677489 !important;
        font-size: .76rem !important;
        font-weight: 700 !important;
        letter-spacing: .005em;
        line-height: 1.15rem !important;
        white-space: normal !important;
    }
    div[data-testid="stMetric"] [data-testid="stMetricValue"] {
        margin-top: 4px;
        color: var(--pf-text) !important;
        font-size: clamp(1.26rem, 2.1vw, 1.9rem) !important;
        line-height: 2rem !important;
        font-weight: 800 !important;
        letter-spacing: -0.035em;
    }
    div[data-testid="stMetric"] [data-testid="stMetricDelta"] { font-size: .75rem !important; }

    /* White content cards, tables, and containers */
    .pf-card,
    div[data-testid="stVerticalBlockBorderWrapper"],
    div[data-testid="stExpander"] {
        background: var(--pf-card);
        border: 1px solid var(--pf-line) !important;
        border-radius: 14px !important;
        box-shadow: 0 3px 12px rgba(15, 23, 42, .03);
    }
    .pf-card { padding: 17px; margin-bottom: 13px; }
    div[data-testid="stVerticalBlockBorderWrapper"] { padding: 2px; }
    div[data-testid="stExpander"] { overflow: hidden; }
    div[data-testid="stExpander"] details summary { font-weight: 750; color: var(--pf-text); }

    div[data-testid="stDataFrame"] {
        overflow: hidden;
        background: var(--pf-card);
        border: 1px solid var(--pf-line);
        border-radius: 14px;
        box-shadow: 0 3px 12px rgba(15, 23, 42, .025);
    }
    div[data-testid="stDataFrame"] [role="columnheader"] {
        background: #f8faff !important;
        color: #64748b !important;
        font-size: .72rem !important;
        font-weight: 800 !important;
        text-transform: uppercase;
        letter-spacing: .035em;
    }
    div[data-testid="stDataFrame"] [role="gridcell"] {
        color: #334155 !important;
        border-color: #edf1f6 !important;
    }
    [data-testid="stMarkdownContainer"] table {
        width: 100%;
        margin: 8px 0 15px;
        overflow: hidden;
        border: 1px solid var(--pf-line);
        border-collapse: separate;
        border-spacing: 0;
        border-radius: 13px;
        background: var(--pf-card);
        box-shadow: 0 3px 12px rgba(15, 23, 42, .02);
    }
    [data-testid="stMarkdownContainer"] table th {
        padding: 11px 12px;
        background: #f8faff;
        color: #64748b;
        font-size: .72rem;
        font-weight: 800;
        letter-spacing: .035em;
        text-transform: uppercase;
        border-bottom: 1px solid var(--pf-line);
    }
    [data-testid="stMarkdownContainer"] table td {
        padding: 11px 12px;
        color: #334155;
        border-bottom: 1px solid #edf1f6;
        vertical-align: middle;
    }
    [data-testid="stMarkdownContainer"] table tr:last-child td { border-bottom: 0; }
    [data-testid="stMarkdownContainer"] table tbody tr:hover td { background: #f8fbff; }

    /* Buttons and inputs */
    .stButton > button,
    .stDownloadButton > button {
        min-height: 38px;
        padding: 0 15px;
        border-radius: 10px;
        font-size: .86rem;
        font-weight: 750;
        transition: transform .13s ease, box-shadow .13s ease, border-color .13s ease;
    }
    .stButton > button:hover,
    .stDownloadButton > button:hover {
        transform: translateY(-1px);
    }
    .stButton > button[kind="primary"],
    .stDownloadButton > button[kind="primary"],
    button[data-testid="baseButton-primary"] {
        background: var(--pf-blue) !important;
        color: #ffffff !important;
        border: 1px solid var(--pf-blue) !important;
        box-shadow: 0 6px 14px rgba(37,99,235,.18);
    }
    .stButton > button[kind="primary"]:hover,
    button[data-testid="baseButton-primary"]:hover {
        background: var(--pf-blue-dark) !important;
        border-color: var(--pf-blue-dark) !important;
        box-shadow: 0 8px 18px rgba(37,99,235,.22);
    }
    .stButton > button[kind="secondary"],
    .stDownloadButton > button[kind="secondary"],
    button[data-testid="baseButton-secondary"] {
        background: #ffffff !important;
        color: #344156 !important;
        border: 1px solid #dce4ee !important;
        box-shadow: 0 2px 7px rgba(15, 23, 42, .025);
    }
    .stButton > button[kind="secondary"]:hover,
    .stDownloadButton > button[kind="secondary"]:hover,
    button[data-testid="baseButton-secondary"]:hover {
        border-color: #aac7f7 !important;
        color: var(--pf-blue-dark) !important;
        background: #fbfdff !important;
    }
    div[data-baseweb="input"] > div,
    div[data-baseweb="select"] > div,
    [data-testid="stNumberInput"] div[data-baseweb="input"] > div,
    [data-testid="stDateInput"] div[data-baseweb="input"] > div,
    [data-testid="stTextArea"] textarea {
        border-color: #dce4ee !important;
        border-radius: 10px !important;
        background: #ffffff !important;
        box-shadow: none !important;
    }
    div[data-baseweb="input"] > div:focus-within,
    div[data-baseweb="select"] > div:focus-within,
    [data-testid="stTextArea"] textarea:focus {
        border-color: #82b1f7 !important;
        box-shadow: 0 0 0 3px rgba(37,99,235,.10) !important;
    }
    [data-testid="stFileUploader"] {
        border: 1px dashed #b8c7db !important;
        border-radius: 12px !important;
        background: #fbfdff !important;
    }

    /* Tabs become compact workspace switches. */
    div[data-baseweb="tab-list"] {
        gap: 6px;
        flex-wrap: wrap;
        padding: 2px 0 9px;
        border-bottom: 1px solid var(--pf-line);
    }
    button[data-baseweb="tab"] {
        min-height: 34px;
        padding: 7px 11px !important;
        border-radius: 9px !important;
        color: #66758a !important;
        font-size: .82rem !important;
        font-weight: 750 !important;
    }
    button[data-baseweb="tab"]:hover { color: var(--pf-blue-dark) !important; background: #f1f6ff !important; }
    button[data-baseweb="tab"][aria-selected="true"] {
        color: var(--pf-blue-dark) !important;
        background: var(--pf-blue-soft) !important;
    }
    div[data-baseweb="tab-highlight"] { background: var(--pf-blue) !important; height: 2px !important; }

    /* Forms, messages, and small UI elements */
    [data-testid="stAlert"] {
        border-radius: 12px !important;
        border: 1px solid #dce6f5 !important;
        box-shadow: 0 2px 8px rgba(15,23,42,.02);
    }
    [data-testid="stForm"] {
        padding: 17px !important;
        background: #ffffff;
        border: 1px solid var(--pf-line) !important;
        border-radius: 14px !important;
        box-shadow: 0 3px 12px rgba(15,23,42,.025);
    }
    [data-testid="stDivider"] { border-color: var(--pf-line) !important; }
    .pf-section-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        background: #ef4444;
        color: #ffffff;
        font-size: 11px;
        font-weight: 800;
        box-shadow: 0 3px 7px rgba(239,68,68,.18);
    }
    .pf-badge {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        padding: 4px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.1;
        border: 1px solid rgba(15,23,42,.06);
        letter-spacing: .005em;
        white-space: nowrap;
    }

    @media (max-width: 780px) {
        div[data-testid="stMetric"] { min-height: 96px; padding: 13px; }
        .pf-hero { padding-left: 14px; }
        [data-testid="stMarkdownContainer"] table { display: block; overflow-x: auto; }
    }
    </style>
    """, unsafe_allow_html=True)

    # Final visual layer: applied after the legacy stylesheet above so all
    # role pages share the same compact, contemporary enterprise treatment.
    st.markdown("""
    <style>
    :root {
        --pf-blue: #2563eb;
        --pf-blue-dark: #1d4ed8;
        --pf-blue-soft: #eff4ff;
        --pf-page: #f8fafc;
        --pf-card: #ffffff;
        --pf-line: #e4e7ec;
        --pf-text: #101828;
        --pf-heading: #101828;
        --pf-copy: #344054;
        --pf-muted: #667085;
    }

    /* Type hierarchy and page title */
    h1, h2, h3, h4, h5, h6,
    [data-testid="stMarkdownContainer"] h1,
    [data-testid="stMarkdownContainer"] h2,
    [data-testid="stMarkdownContainer"] h3 {
        color: var(--pf-text) !important;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: -0.028em !important;
    }
    h2, [data-testid="stMarkdownContainer"] h2 { font-size: 1.45rem !important; font-weight: 730 !important; }
    h3, [data-testid="stMarkdownContainer"] h3 { font-size: 1.17rem !important; font-weight: 700 !important; }
    /* Streamlit heading anchor icons look unfinished in an operational dashboard. */
    [data-testid="stHeaderActionElements"],
    [data-testid="stMarkdownContainer"] h1 a,
    [data-testid="stMarkdownContainer"] h2 a,
    [data-testid="stMarkdownContainer"] h3 a {
        display: none !important;
    }

    .pf-hero {
        margin: 0 0 26px !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
    }
    .pf-hero::before { display: none !important; }
    .pf-hero h1 {
        font-size: clamp(1.85rem, 2.35vw, 2.35rem) !important;
        font-weight: 760 !important;
        line-height: 1.14 !important;
        color: var(--pf-text) !important;
    }
    .pf-hero p {
        max-width: 900px;
        margin-top: 8px !important;
        color: var(--pf-muted) !important;
        font-size: .93rem !important;
        line-height: 1.55 !important;
    }

    /* KPI cards: flat, clean, and readable rather than heavily decorated. */
    div[data-testid="stMetric"] {
        min-height: 108px !important;
        padding: 16px !important;
        border: 1px solid var(--pf-line) !important;
        border-radius: 12px !important;
        background: var(--pf-card) !important;
        box-shadow: 0 1px 2px rgba(16,24,40,.035) !important;
    }
    div[data-testid="stMetric"]::before { display: none !important; }
    div[data-testid="stMetric"] label {
        color: var(--pf-muted) !important;
        font-size: .73rem !important;
        font-weight: 650 !important;
        letter-spacing: .01em !important;
    }
    div[data-testid="stMetric"] [data-testid="stMetricValue"] {
        margin-top: 6px !important;
        color: var(--pf-text) !important;
        font-size: clamp(1.32rem, 1.85vw, 1.8rem) !important;
        font-weight: 750 !important;
        line-height: 1.35 !important;
    }

    /* Containers, expanders, forms, and tables */
    .pf-card,
    div[data-testid="stVerticalBlockBorderWrapper"],
    div[data-testid="stExpander"],
    div[data-testid="stDataFrame"] {
        border: 1px solid var(--pf-line) !important;
        border-radius: 12px !important;
        background: var(--pf-card) !important;
        box-shadow: 0 1px 2px rgba(16,24,40,.035) !important;
    }
    div[data-testid="stVerticalBlockBorderWrapper"] { padding: 0 !important; }
    div[data-testid="stExpander"] { overflow: hidden !important; }
    div[data-testid="stExpander"] details > summary {
        min-height: 52px;
        padding: 14px 16px !important;
        background: #fcfcfd;
        color: var(--pf-text) !important;
        font-size: .9rem !important;
        font-weight: 680 !important;
        border-bottom: 1px solid var(--pf-line);
    }
    div[data-testid="stExpander"] details > div {
        padding: 0 !important;
        background: var(--pf-card) !important;
    }
    /* Avoid the visually heavy double-card effect of a form inside an expander. */
    div[data-testid="stExpander"] [data-testid="stForm"] {
        margin: 0 !important;
        padding: 16px !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
    }
    [data-testid="stForm"] {
        padding: 18px !important;
        border: 1px solid var(--pf-line) !important;
        border-radius: 12px !important;
        background: var(--pf-card) !important;
        box-shadow: 0 1px 2px rgba(16,24,40,.035) !important;
    }
    [data-testid="stDataFrame"] { overflow: hidden !important; }
    div[data-testid="stDataFrame"] [role="columnheader"] {
        min-height: 38px !important;
        background: #f9fafb !important;
        color: #475467 !important;
        font-size: .69rem !important;
        font-weight: 720 !important;
        letter-spacing: .045em !important;
    }
    div[data-testid="stDataFrame"] [role="gridcell"] {
        color: var(--pf-copy) !important;
        border-color: #eaecf0 !important;
        font-size: .82rem !important;
    }
    [data-testid="stMarkdownContainer"] table {
        margin: 8px 0 18px !important;
        border-color: var(--pf-line) !important;
        border-radius: 12px !important;
        box-shadow: 0 1px 2px rgba(16,24,40,.035) !important;
    }
    [data-testid="stMarkdownContainer"] table th {
        padding: 11px 13px !important;
        background: #f9fafb !important;
        color: #475467 !important;
        font-size: .69rem !important;
    }
    [data-testid="stMarkdownContainer"] table td {
        padding: 12px 13px !important;
        color: var(--pf-copy) !important;
        border-color: #eaecf0 !important;
    }

    /* Controls */
    [data-testid="stWidgetLabel"] p,
    [data-testid="stWidgetLabel"] span {
        color: var(--pf-copy) !important;
        font-size: .82rem !important;
        font-weight: 620 !important;
    }
    div[data-baseweb="input"] > div,
    div[data-baseweb="select"] > div,
    [data-testid="stNumberInput"] div[data-baseweb="input"] > div,
    [data-testid="stDateInput"] div[data-baseweb="input"] > div,
    [data-testid="stTextArea"] textarea {
        min-height: 42px !important;
        border: 1px solid #d0d5dd !important;
        border-radius: 9px !important;
        background: #ffffff !important;
        color: var(--pf-heading, #101828) !important;
        box-shadow: 0 1px 2px rgba(16,24,40,.025) !important;
    }
    [data-testid="stTextArea"] textarea { min-height: 96px !important; padding-top: 10px !important; }
    div[data-baseweb="input"] > div:hover,
    div[data-baseweb="select"] > div:hover,
    [data-testid="stTextArea"] textarea:hover { border-color: #98a2b3 !important; }
    div[data-baseweb="input"] > div:focus-within,
    div[data-baseweb="select"] > div:focus-within,
    [data-testid="stTextArea"] textarea:focus {
        border-color: var(--pf-blue) !important;
        box-shadow: 0 0 0 3px rgba(37,99,235,.12) !important;
    }
    .stButton > button,
    .stDownloadButton > button,
    [data-testid="stFormSubmitButton"] > button {
        min-height: 40px !important;
        padding: 0 14px !important;
        border-radius: 9px !important;
        font-size: .82rem !important;
        font-weight: 680 !important;
        box-shadow: none !important;
    }
    .stButton > button[kind="primary"],
    .stDownloadButton > button[kind="primary"],
    [data-testid="stFormSubmitButton"] > button,
    button[data-testid="baseButton-primary"] {
        background: var(--pf-blue) !important;
        border-color: var(--pf-blue) !important;
        color: #ffffff !important;
        box-shadow: 0 1px 2px rgba(16,24,40,.12) !important;
    }
    .stButton > button[kind="primary"]:hover,
    .stDownloadButton > button[kind="primary"]:hover,
    [data-testid="stFormSubmitButton"] > button:hover,
    button[data-testid="baseButton-primary"]:hover {
        background: var(--pf-blue-dark) !important;
        border-color: var(--pf-blue-dark) !important;
        transform: translateY(-1px);
    }
    .stButton > button[kind="secondary"],
    .stDownloadButton > button[kind="secondary"],
    button[data-testid="baseButton-secondary"] {
        background: #ffffff !important;
        border-color: #d0d5dd !important;
        color: var(--pf-copy) !important;
    }
    .stButton > button[kind="secondary"]:hover,
    .stDownloadButton > button[kind="secondary"]:hover,
    button[data-testid="baseButton-secondary"]:hover {
        background: #f9fafb !important;
        border-color: #98a2b3 !important;
        color: var(--pf-text) !important;
    }
    [data-baseweb="checkbox"] [role="checkbox"][aria-checked="true"] {
        background-color: var(--pf-blue) !important;
        border-color: var(--pf-blue) !important;
    }
    [data-testid="stFileUploader"] {
        border: 1px dashed #98a2b3 !important;
        border-radius: 10px !important;
        background: #fcfcfd !important;
    }

    /* Tabs and status chips */
    div[data-baseweb="tab-list"] {
        gap: 3px !important;
        padding: 0 0 10px !important;
        border-bottom: 1px solid var(--pf-line) !important;
    }
    button[data-baseweb="tab"] {
        min-height: 34px !important;
        padding: 7px 10px !important;
        border-radius: 8px !important;
        color: var(--pf-muted) !important;
        font-size: .8rem !important;
        font-weight: 650 !important;
    }
    button[data-baseweb="tab"][aria-selected="true"] {
        background: var(--pf-blue-soft) !important;
        color: var(--pf-blue-dark) !important;
    }
    div[data-baseweb="tab-highlight"] { height: 2px !important; background: var(--pf-blue) !important; }
    .pf-badge {
        min-height: 24px !important;
        padding: 4px 8px !important;
        border-radius: 999px !important;
        font-size: 10px !important;
        font-weight: 720 !important;
        letter-spacing: .01em !important;
    }
    [data-testid="stAlert"] {
        border-radius: 10px !important;
        border-color: #d0d5dd !important;
        box-shadow: none !important;
    }
    [data-testid="stDivider"] { border-color: var(--pf-line) !important; }

    @media (max-width: 780px) {
        .pf-hero { margin-bottom: 20px !important; }
        .pf-hero h1 { font-size: 1.8rem !important; }
        div[data-testid="stMetric"] { min-height: 96px !important; padding: 13px !important; }
    }
    </style>
    """, unsafe_allow_html=True)

    # Visual-only reference layer for all role pages. This follows the approved
    # command-centre design while retaining every existing page, field and query.
    st.markdown("""
    <style>
    :root {
        --pf-blue: #0a5bd6;
        --pf-blue-dark: #0648b8;
        --pf-blue-soft: #edf5ff;
        --pf-page: #f8fbff;
        --pf-card: #ffffff;
        --pf-line: #e5edf8;
        --pf-text: #0c1730;
        --pf-heading: #0c1730;
        --pf-copy: #41506a;
        --pf-muted: #71809a;
    }
    .pf-hero {
        position:relative !important;
        min-height: 122px;
        margin: 0 0 28px !important;
        padding: 28px 0 22px !important;
        overflow:hidden;
        background: linear-gradient(100deg, rgba(255,255,255,.88), rgba(245,249,255,.98)) !important;
        border-bottom: 1px solid rgba(229,237,248,.92) !important;
    }
    .pf-hero::before { display:none !important; }
    .pf-hero::after {
        content:""; position:absolute; right:2%; top:4px; width:290px; height:128px; opacity:.52; pointer-events:none;
        background:
            radial-gradient(circle at 70% 39%, rgba(47,117,247,.25) 0 10px, transparent 11px),
            radial-gradient(circle at 87% 63%, rgba(78,148,255,.17) 0 25px, transparent 26px),
            linear-gradient(146deg, transparent 28%, rgba(128,178,255,.15) 29% 30%, transparent 31% 43%, rgba(128,178,255,.12) 44% 45%, transparent 46%),
            linear-gradient(25deg, transparent 38%, rgba(93,153,255,.13) 39% 41%, transparent 42%);
        filter: blur(.1px);
    }
    .pf-hero h1 { position:relative; z-index:1; max-width:850px; font-size:clamp(2rem, 2.75vw, 2.75rem) !important; font-weight:820 !important; letter-spacing:-.042em !important; }
    .pf-hero p { position:relative; z-index:1; max-width:900px; font-size:.94rem !important; color:var(--pf-muted) !important; }

    /* Two-line compact KPI styling that mirrors the approved reference. */
    div[data-testid="stMetric"] {
        position:relative !important; min-height:142px !important; padding:24px 20px 18px 82px !important;
        overflow:hidden !important; border:1px solid #e6edf7 !important; border-radius:16px !important;
        background:#fff !important; box-shadow:0 4px 13px rgba(23,57,122,.045) !important;
    }
    div[data-testid="stMetric"]::before {
        content:"◌" !important; position:absolute !important; left:22px !important; top:29px !important;
        width:40px !important; height:40px !important; display:grid !important; place-items:center !important;
        border-radius:13px !important; color:#1e6eea !important; background:linear-gradient(135deg,#eaf3ff,#d9eaff) !important;
        font-size:24px !important; font-weight:700 !important; line-height:1 !important;
        box-shadow:0 6px 14px rgba(34,100,210,.12) !important;
    }
    div[data-testid="stHorizontalBlock"] > div:nth-child(3n) div[data-testid="stMetric"]::before { color:#ec9b00 !important; background:linear-gradient(135deg,#fff6d8,#ffefb7) !important; }
    div[data-testid="stHorizontalBlock"] > div:nth-child(4n) div[data-testid="stMetric"]::before { color:#10a86c !important; background:linear-gradient(135deg,#e7fbf1,#d2f6e4) !important; }
    div[data-testid="stMetric"] label { color:#5d6b85 !important; font-size:.79rem !important; font-weight:730 !important; line-height:1.3 !important; }
    div[data-testid="stMetric"] [data-testid="stMetricValue"] { margin-top:6px !important; color:var(--pf-text) !important; font-size:1.75rem !important; font-weight:820 !important; line-height:1.22 !important; }
    div[data-testid="stMetric"] [data-testid="stMetricDelta"] { margin-top:7px !important; font-size:.72rem !important; }

    /* Cards and modules form one consistent command-centre grid. */
    .pf-card, div[data-testid="stVerticalBlockBorderWrapper"], div[data-testid="stExpander"], div[data-testid="stDataFrame"] {
        border-color:#e5edf8 !important; border-radius:16px !important; box-shadow:0 4px 13px rgba(23,57,122,.04) !important;
    }
    [data-testid="stForm"] { border-color:#e5edf8 !important; border-radius:16px !important; box-shadow:0 4px 13px rgba(23,57,122,.035) !important; }
    div[data-testid="stExpander"] details > summary { min-height:56px !important; background:#fff !important; }
    [data-testid="stMarkdownContainer"] table, div[data-testid="stDataFrame"] { border-color:#e5edf8 !important; border-radius:14px !important; }
    [data-testid="stMarkdownContainer"] table th, div[data-testid="stDataFrame"] [role="columnheader"] { background:#f9fbff !important; }
    .stButton > button, .stDownloadButton > button, [data-testid="stFormSubmitButton"] > button { border-radius:11px !important; font-weight:750 !important; }
    .stButton > button[kind="primary"], .stDownloadButton > button[kind="primary"], [data-testid="stFormSubmitButton"] > button, button[data-testid="baseButton-primary"] { background:linear-gradient(135deg,#1369eb,#0854c9) !important; border-color:#0a5bd6 !important; box-shadow:0 8px 16px rgba(10,91,214,.18) !important; }
    .stButton > button[kind="secondary"], .stDownloadButton > button[kind="secondary"], button[data-testid="baseButton-secondary"] { border-color:#dfe8f5 !important; color:#2f67cc !important; background:#fff !important; }
    div[data-baseweb="input"] > div, div[data-baseweb="select"] > div, [data-testid="stTextArea"] textarea { border-color:#dce7f5 !important; border-radius:11px !important; }
    @media (max-width: 780px) {
        .pf-hero { min-height:auto; padding:22px 0 16px !important; }
        .pf-hero::after { display:none; }
        div[data-testid="stMetric"] { min-height:112px !important; padding:18px 14px 14px 66px !important; }
        div[data-testid="stMetric"]::before { left:14px !important; top:23px !important; width:34px !important; height:34px !important; font-size:20px !important; }
    }
    </style>
    """, unsafe_allow_html=True)


def role_header(title: str, subtitle: str) -> None:
    """Render the shared ProcureFlow workspace header.

    Kept in ``core.ui`` so role-specific modules can use the same header
    without importing the large workspace module (which would create a
    circular dependency).
    """
    inject_css()
    st.markdown(
        f"""
        <div class="pf-hero">
            <h1 style="margin:0;">{html.escape(str(title))}</h1>
            <p>{html.escape(str(subtitle))}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    flash = st.session_state.pop("pf_flash_success", None)
    if flash:
        st.success(str(flash))


def metric_row(metrics: list[tuple[str, Any, str | None]], cols: int = 4) -> None:
    """Render a responsive row of standard KPI metrics.

    This belongs in the shared UI module because Auditor and role workspaces
    both use it. Formatting is resolved at call time by ``format_kpi_value``.
    """
    if not metrics:
        return
    column_count = max(1, int(cols or 1))
    columns = st.columns(column_count)
    for index, metric in enumerate(metrics):
        label, value, help_text = metric
        columns[index % column_count].metric(
            str(label),
            format_kpi_value(value),
            help=help_text,
        )


def money(value: Any) -> str:
    try:
        return f"₦{float(value):,.2f}"
    except Exception:
        return "₦0.00"


def badge(status: str | None) -> str:
    status = status or "Unknown"
    display_status = {"Returned to Facility Manager": "Returned for Correction"}.get(status, status)
    fg, bg = STATUS_COLORS.get(status, ("#334155", "#f1f5f9"))
    return f'<span class="pf-badge" style="color:{fg}; background:{bg};">{html.escape(display_status)}</span>'


def dataframe(df: pd.DataFrame, hide_index: bool = True):
    # Presentation-only label cleanup. Keep DB values unchanged.
    if isinstance(df, pd.DataFrame) and not df.empty:
        view = df.copy()
        view = view.replace({
            "Facility Manager": "Utility Head / Facility Head",
            "Facility Manager Inbox": "Utility Head / Facility Head Inbox",
            "Returned to Facility Manager": "Returned for Correction",
        })
    else:
        view = df
    st.dataframe(view, use_container_width=True, hide_index=hide_index)


def empty_state(title: str, message: str, action: str | None = None):
    with st.container(border=True):
        st.subheader(title)
        st.caption(message)
        if action:
            st.info(action)


def workflow_progress(status: str, steps: list[str]):
    """Render workflow horizontally without tiny vertical text wrapping.

    Streamlit columns become unreadable when a workflow has many statuses.
    This compact horizontal rail keeps badges on one line and scrolls sideways
    when needed, so status names never stack letter-by-letter.
    """
    if not steps:
        return
    try:
        current = steps.index(status)
    except ValueError:
        current = -1
    parts = []
    for i, step in enumerate(steps):
        if i < current:
            cls = "done"
            symbol = "✓"
        elif i == current:
            cls = "current"
            symbol = "●"
        else:
            cls = "todo"
            symbol = "○"
        parts.append(f'<span class="pf-step {cls}"><span class="pf-step-dot">{symbol}</span>{html.escape(str(step))}</span>')
    st.markdown(
        """
        <style>
        .pf-workflow-rail {
            display:flex; gap:8px; align-items:center; overflow-x:auto; padding:8px 2px 12px;
            scrollbar-width: thin; white-space: nowrap; margin-bottom: 8px;
        }
        .pf-step {
            flex:0 0 auto; display:inline-flex; align-items:center; gap:6px; border-radius:999px;
            padding:7px 11px; font-size:12px; font-weight:700; border:1px solid #e5e7eb;
            line-height:1; white-space:nowrap; min-width:max-content;
        }
        .pf-step.done { color:#047857; background:#ecfdf5; border-color:#bbf7d0; }
        .pf-step.current { color:#1d4ed8; background:#eaf2ff; border-color:#cfe0ff; }
        .pf-step.todo { color:#6b7280; background:#ffffff; border-color:#e6ebf2; }
        .pf-step-dot {font-size:10px;}
        </style>
        <div class="pf-workflow-rail">%s</div>
        """ % "".join(parts),
        unsafe_allow_html=True,
    )


# ---------- KPI and interactive visualization helpers ----------

def compact_number(value: Any, decimals: int = 1) -> str:
    """Return compact human-readable numbers for dashboard cards: 1K, 2.5M, 1B."""
    try:
        num = float(str(value).replace("₦", "").replace(",", "").strip())
    except Exception:
        return str(value)
    sign = "-" if num < 0 else ""
    num = abs(num)
    units = [(1_000_000_000_000, "T"), (1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")]
    for threshold, suffix in units:
        if num >= threshold:
            val = num / threshold
            if val >= 100 or val.is_integer():
                body = f"{val:.0f}"
            else:
                body = f"{val:.{decimals}f}".rstrip("0").rstrip(".")
            return f"{sign}{body}{suffix}"
    if num.is_integer():
        return f"{sign}{num:.0f}"
    return f"{sign}{num:,.{decimals}f}".rstrip("0").rstrip(".")


def compact_money(value: Any) -> str:
    try:
        raw = str(value).replace("₦", "").replace(",", "").strip()
        return "₦" + compact_number(float(raw))
    except Exception:
        return "₦0"


def format_kpi_value(value: Any) -> str:
    """Format only KPI/metric-card values, leaving normal tables free to use full amounts."""
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("₦"):
            return compact_money(stripped)
        if stripped.endswith("%") or any(ch.isalpha() for ch in stripped.replace("₦", "")):
            return stripped
        try:
            return compact_number(float(stripped.replace(",", "")))
        except Exception:
            return stripped
    if isinstance(value, (int, float)):
        return compact_number(value)
    return str(value)


def interactive_chart(
    df: pd.DataFrame,
    title: str,
    x: str,
    y: str,
    key: str,
    default: str = "Bar",
    color: str | None = None,
    allow_pie: bool = True,
):
    """Reusable interactive chart block with selectable chart type."""
    st.markdown(f"#### {title}")
    if df is None or df.empty or x not in df.columns or y not in df.columns:
        st.info("No data available for this chart yet.")
        return
    chart_types = ["Bar", "Horizontal Bar", "Line", "Area"] + (["Pie", "Donut"] if allow_pie else []) + ["Table"]
    if default not in chart_types:
        default = "Bar"
    chosen = st.selectbox("Chart type", chart_types, index=chart_types.index(default), key=f"{key}_chart_type")
    data = df.copy()
    try:
        data[y] = pd.to_numeric(data[y], errors="coerce").fillna(0)
    except Exception:
        pass
    try:
        import plotly.express as px
        fig = None
        if chosen == "Bar":
            fig = px.bar(data, x=x, y=y, color=color if color in data.columns else None, text_auto=True)
        elif chosen == "Horizontal Bar":
            fig = px.bar(data, x=y, y=x, orientation="h", color=color if color in data.columns else None, text_auto=True)
        elif chosen == "Line":
            fig = px.line(data, x=x, y=y, markers=True, color=color if color in data.columns else None)
        elif chosen == "Area":
            fig = px.area(data, x=x, y=y, color=color if color in data.columns else None)
        elif chosen == "Pie":
            fig = px.pie(data, names=x, values=y)
        elif chosen == "Donut":
            fig = px.pie(data, names=x, values=y, hole=0.45)
        elif chosen == "Table":
            dataframe(data)
            return
        if fig is not None:
            fig.update_layout(margin=dict(l=12, r=12, t=10, b=12), height=360)
            st.plotly_chart(fig, use_container_width=True, config={"displaylogo": False, "responsive": True})
    except Exception:
        if chosen == "Line":
            st.line_chart(data.set_index(x)[y])
        elif chosen == "Area":
            st.area_chart(data.set_index(x)[y])
        elif chosen == "Table":
            dataframe(data)
        else:
            st.bar_chart(data.set_index(x)[y])
