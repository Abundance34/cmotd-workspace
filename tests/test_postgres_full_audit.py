import os
import subprocess
import sys
from pathlib import Path

from scripts.audit_postgres_compatibility import _is_mounted_runtime_path, run_audit


ROOT = Path(__file__).resolve().parents[1]


def test_repository_wide_postgres_compatibility_audit_passes(
    tmp_path,
):
    sqlite_path = (
        tmp_path
        / "procureflow_workspace.db"
    )

    env = dict(
        os.environ
    )

    env.update(
        {
            "PROCUREFLOW_DATABASE_BACKEND": "sqlite",
            "PROCUREFLOW_PRODUCTION": "0",
            "PROCUREFLOW_SEED_DEFAULTS": "0",
            "PROCUREFLOW_DATA_DIR": str(
                tmp_path
            ),
        }
    )

    subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from core.db import init_db; "
                "init_db()"
            ),
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )

    assert sqlite_path.exists()

    report = run_audit(
        sqlite_path,
        ROOT / "postgres_schema_current.sql",
    )

    assert (
        report["status"]
        == "passed"
    ), report["findings"]

    assert (
        report["summary"]["sqlite_tables"]
        == 68
    )

    assert (
        report["summary"][
            "postgres_application_tables"
        ]
        == 68
    )

    assert (
        report["summary"][
            "sql_literals_scanned"
        ]
        >= 1400
    )

    assert (
        report["summary"][
            "direct_excel_writers_outside_shared_service"
        ]
        == []
    )


def test_runtime_mount_detection_recognises_nested_paths(monkeypatch, tmp_path):
    data_mount = tmp_path / "data"
    key_path = data_mount / ".procureflow_local_encryption.key"
    key_path.parent.mkdir(parents=True)
    key_path.write_text("runtime-only", encoding="utf-8")

    mountinfo = tmp_path / "mountinfo"
    mountinfo.write_text(
        f"123 45 0:99 / {data_mount} rw,relatime - ext4 /dev/root rw\n",
        encoding="utf-8",
    )

    original_exists = Path.exists
    original_read_text = Path.read_text

    def fake_exists(path):
        if str(path) == "/proc/self/mountinfo":
            return True
        return original_exists(path)

    def fake_read_text(path, *args, **kwargs):
        if str(path) == "/proc/self/mountinfo":
            return original_read_text(mountinfo, *args, **kwargs)
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "exists", fake_exists)
    monkeypatch.setattr(Path, "read_text", fake_read_text)

    assert _is_mounted_runtime_path(key_path)
