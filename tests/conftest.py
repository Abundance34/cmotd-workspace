from __future__ import annotations

import os
from pathlib import Path

import pytest

# Database fixtures repeatedly seed the same development roles. This flag only
# reduces the PBKDF2 cost of those fixture seed hashes; production defaults and
# application password changes retain their full configured strength.
os.environ.setdefault("PROCUREFLOW_FAST_TEST_SEEDS", "1")
# Keep test encryption/audit operations isolated from the distributable data directory.
os.environ.setdefault("PROCUREFLOW_PAYEE_ENCRYPTION_KEY", "procureflow-test-only-payee-key")
os.environ.setdefault("PROCUREFLOW_AUDIT_SIGNING_KEY", "procureflow-test-only-audit-key")


@pytest.fixture(scope="session")
def seeded_database_template(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Create the full SQLite schema once and copy it for isolated E2E tests."""
    import core.db as db

    root = tmp_path_factory.mktemp("seeded-db-template")
    database = root / "procureflow-template.db"
    old_values = (db.DB_PATH, db.ATTACHMENT_DIR, db.BACKUP_DIR, db._DB_INIT_DONE)
    try:
        db.DB_PATH = database
        db.ATTACHMENT_DIR = root / "uploads"
        db.BACKUP_DIR = root / "backups"
        db._DB_INIT_DONE = False
        db.init_db()
    finally:
        db.DB_PATH, db.ATTACHMENT_DIR, db.BACKUP_DIR, db._DB_INIT_DONE = old_values
    return database

_LEGACY_DB_TEST_MODULES = {
    "test_audit_hardening.py",
    "test_db_migration.py",
    "test_logistics.py",
    "test_low_value_approval.py",
}


@pytest.fixture(autouse=True)
def isolate_legacy_database_tests(
    request: pytest.FixtureRequest,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    seeded_database_template: Path,
):
    """Keep legacy service tests from writing audit rows into the shipped DB."""
    if request.path.name not in _LEGACY_DB_TEST_MODULES:
        yield
        return

    import shutil
    import core.db as db

    database = tmp_path / "procureflow.db"
    uploads = tmp_path / "uploads"
    backups = tmp_path / "backups"
    shutil.copy2(seeded_database_template, database)
    monkeypatch.setattr(db, "DB_PATH", database)
    monkeypatch.setattr(db, "ATTACHMENT_DIR", uploads)
    monkeypatch.setattr(db, "BACKUP_DIR", backups)
    monkeypatch.setattr(db, "_DB_INIT_DONE", True)
    yield
