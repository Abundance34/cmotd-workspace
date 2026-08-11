"""PostgreSQL schema migration runner used by Cloud SQL deployments."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from core.db_backend import get_postgres_connection, postgres_health_check

BASE_DIR = Path(__file__).resolve().parents[1]
MIGRATION_DIR = BASE_DIR / "migrations" / "postgresql"


class MigrationChecksumError(RuntimeError):
    pass


def _migration_files() -> list[Path]:
    return sorted(path for path in MIGRATION_DIR.glob("*.sql") if path.is_file())


def apply_postgres_migrations(*, through: str | None = None) -> list[str]:
    """Apply checked-in PostgreSQL migrations exactly once.

    A checksum is stored for each migration. Editing an already-applied file is
    treated as an error rather than silently changing production history.
    """
    applied_now: list[str] = []
    conn = get_postgres_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                checksum TEXT NOT NULL
            )
            """
        )
        conn.commit()
        existing_rows = conn.execute("SELECT version, checksum FROM schema_migrations").fetchall()
        existing = {str(row["version"]): str(row["checksum"]) for row in existing_rows}
        conn.commit()
        for path in _migration_files():
            version = path.name
            if through and version > through:
                break
            content = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()
            if version in existing:
                if existing[version] != checksum:
                    raise MigrationChecksumError(
                        f"PostgreSQL migration {version} has changed after it was applied. "
                        "Restore the original migration and create a new numbered migration."
                    )
                continue
            # A prior SELECT starts a transaction on psycopg. End it before the
            # migration's explicit BEGIN/COMMIT block.
            conn.commit()
            conn.executescript(content)
            conn.execute(
                "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
                (version, checksum),
            )
            conn.commit()
            applied_now.append(version)
        return applied_now
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


def initialize_postgres_database() -> None:
    health = postgres_health_check()
    if not health.ok:
        raise RuntimeError(f"PostgreSQL health check failed: {health.message}")
    apply_postgres_migrations()

    production = os.environ.get("PROCUREFLOW_PRODUCTION", "0").strip() == "1"
    seed_requested = os.environ.get("PROCUREFLOW_SEED_DEFAULTS", "0" if production else "1").strip() == "1"
    if seed_requested:
        # Reuse the established role, permission, category, department and demo
        # user seeds. Their INSERT OR IGNORE statements are translated by the
        # compatibility backend to PostgreSQL ON CONFLICT DO NOTHING.
        from core.db import seed_defaults, seed_enterprise_defaults, seed_phase2_defaults

        seed_defaults()
        seed_enterprise_defaults()
        seed_phase2_defaults()


def postgres_migration_status() -> list[dict[str, str]]:
    conn = get_postgres_connection()
    try:
        rows = conn.execute(
            "SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version"
        ).fetchall()
        conn.commit()
        return [dict(row) for row in rows]
    finally:
        conn.close()
