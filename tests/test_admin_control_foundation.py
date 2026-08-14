"""Release A Admin Control Centre static contract tests."""
from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (
        ROOT / relative
    ).read_text(
        encoding="utf-8",
        errors="ignore",
    )


def test_release_a_files_parse():
    for relative in (
        "app.py",
        "core/auth.py",
        "modules/role_workspaces.py",
        "services/admin_control_service.py",
    ):
        ast.parse(
            _read(relative),
            filename=relative,
        )


def test_release_a_postgres_migration_exists():
    source = _read(
        "migrations/postgresql/"
        "006_admin_control_foundation.sql"
    )

    assert (
        "CREATE TABLE IF NOT EXISTS "
        "admin_interventions"
    ) in source

    assert (
        "CREATE TABLE IF NOT EXISTS "
        "system_exceptions"
    ) in source

    assert (
        "procureflow_block_admin_intervention_mutation"
    ) in source


def test_admin_sidebar_contains_release_a_centres():
    source = _read("app.py")

    assert '"Action & Exception Centre"' in source
    assert '"Workflow Intervention Centre"' in source
    assert '"Security & Access Management"' in source


def test_final_active_admin_console_routes_release_a():
    source = _read(
        "modules/role_workspaces.py"
    )

    tree = ast.parse(source)

    matches = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "admin_console"
    ]

    assert matches

    active = matches[-1]

    active_source = (
        ast.get_source_segment(
            source,
            active,
        )
        or ""
    )

    assert (
        "admin_action_exception_centre()"
        in active_source
    )

    assert (
        "admin_workflow_intervention_centre()"
        in active_source
    )

    assert (
        "admin_security_access_management_page()"
        in active_source
    )

    # Existing sidebar item must now route in the final
    # active Admin Console too.
    assert (
        "database_viewer_page()"
        in active_source
    )


def test_admin_interventions_require_reason_and_audit():
    source = _read(
        "services/admin_control_service.py"
    )

    assert "def _require_reason(" in source
    assert "def record_admin_intervention(" in source
    assert "log_audit(" in source
    assert "create_activity_log(" in source

    assert (
        "Emergency Approve Request"
        in source
    )

    assert (
        "Admin cannot use an emergency approval"
        in source
    )


def test_admin_can_terminate_server_sessions():
    service = _read(
        "services/admin_control_service.py"
    )

    auth = _read(
        "core/auth.py"
    )

    assert (
        "Terminated by Admin"
        in service
    )

    assert (
        "# Admin-forced session termination validation."
        in auth
    )

    assert (
        "s.status"
        in auth
    )

    assert (
        "account_locked"
        in auth
    )


def test_postgres_admin_schema_is_migration_only():
    source = _read(
        "services/admin_control_service.py"
    )

    tree = ast.parse(source)

    matches = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "ensure_admin_control_schema"
    ]

    assert len(matches) == 1

    active_source = (
        ast.get_source_segment(
            source,
            matches[0],
        )
        or ""
    )

    postgres_guard = active_source.index(
        "if is_postgres():"
    )

    sqlite_runtime_ddl = active_source.index(
        "CREATE TABLE IF NOT EXISTS admin_interventions"
    )

    assert postgres_guard < sqlite_runtime_ddl

    assert (
        "006_admin_control_foundation.sql"
        in active_source
    )

    assert (
        "PostgreSQL schema is controlled exclusively "
        "by numbered migrations."
        in active_source
    )


def test_active_session_queries_are_postgres_timestamp_safe():
    auth = _read("core/auth.py")
    workspaces = _read("modules/role_workspaces.py")

    # PostgreSQL stores user_sessions.logout_at as TIMESTAMPTZ.
    # Comparing it with an empty string raises InvalidDatetimeFormat.
    assert "s.logout_at=''" not in auth
    assert "s.logout_at=''" not in workspaces

    assert "s.logout_at IS NULL" in auth
    assert "s.logout_at IS NULL" in workspaces

