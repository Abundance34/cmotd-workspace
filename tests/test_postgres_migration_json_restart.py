from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.migrate_sqlite_to_postgres import normalize_value


def test_jsonb_normalization_returns_plain_python_value():
    value = normalize_value('{"table":"purchase_requests","operation":"INSERT"}', "jsonb")
    assert value == {"table": "purchase_requests", "operation": "INSERT"}
    assert value.__class__.__module__ == "builtins"


def test_jsonb_invalid_legacy_text_is_preserved_as_json_string():
    assert normalize_value("not-json", "jsonb") == "not-json"


def test_relationship_migration_does_not_cascade_delete_payee_history():
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "postgresql" / "003_relationship_constraints.sql").read_text(encoding="utf-8")
    assert "fk_payee_versions_payee" not in sql
    assert "immutable audit history" in sql


def test_relationship_constraints_only_apply_after_success():
    source = (Path(__file__).resolve().parents[1] / "scripts" / "migrate_sqlite_to_postgres.py").read_text(encoding="utf-8")
    assert 'if report["status"] == "success":' in source
    assert "reset_deferred_relationship_migration(destination)" in source
