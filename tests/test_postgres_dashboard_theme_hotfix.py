from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_postgres_substr_compatibility_migration_exists():
    sql = (ROOT / "migrations" / "postgresql" / "004_sqlite_substr_date_compatibility.sql").read_text(encoding="utf-8")
    assert "FUNCTION public.substr(value DATE" in sql
    assert "TIMESTAMP WITHOUT TIME ZONE" in sql
    assert "TIMESTAMP WITH TIME ZONE" in sql
    assert "pg_catalog.substr(value::TEXT" in sql


def test_runtime_theme_is_authoritative_light_only():
    source = (ROOT / "core" / "ui.py").read_text(encoding="utf-8")
    assert "--pf-live-bg: #f7f9fc" in source
    assert "--pf-live-surface: #ffffff" in source
    assert "--pf-live-bg: var(--background-color" not in source
    assert '[data-testid="stApp"] div[data-testid="stMetric"]' in source
    assert '[data-testid="stApp"] .pf-hero' in source
