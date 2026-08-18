"""Secure document-upload helpers used by existing ProcureFlow screens."""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any

from core.db import ATTACHMENT_DIR

MAX_UPLOAD_MB = int(os.environ.get("PROCUREFLOW_MAX_UPLOAD_MB", "15"))
ENABLE_AV = os.environ.get("PROCUREFLOW_ENABLE_AV_SCAN", "0") == "1"
MAX_ZIP_MEMBERS = int(os.environ.get("PROCUREFLOW_MAX_ZIP_MEMBERS", "2000"))
MAX_ZIP_UNCOMPRESSED_MB = int(os.environ.get("PROCUREFLOW_MAX_ZIP_UNCOMPRESSED_MB", "100"))

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".xlsx",
    ".xls",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".zip",
}

class DocumentSecurityError(ValueError):
    pass


def _safe_filename(name: str) -> str:
    base = Path(name or "upload").name
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    return base or "upload"


def _looks_like_allowed_content(
    data: bytes,
    suffix: str,
) -> bool:
    suffix = suffix.lower()

    if suffix == ".pdf":
        return data.startswith(
            b"%PDF-"
        )

    if suffix in {
        ".jpg",
        ".jpeg",
    }:
        return data.startswith(
            b"\xff\xd8\xff"
        )

    if suffix == ".png":
        return data.startswith(
            b"\x89PNG\r\n\x1a\n"
        )

    if suffix == ".webp":
        return (
            len(data) >= 12
            and data[:4] == b"RIFF"
            and data[8:12] == b"WEBP"
        )

    if suffix == ".bmp":
        return data.startswith(
            b"BM"
        )

    if suffix == ".gif":
        return data.startswith(
            (
                b"GIF87a",
                b"GIF89a",
            )
        )

    if suffix in {
        ".tif",
        ".tiff",
    }:
        return data.startswith(
            (
                b"II*\x00",
                b"MM\x00*",
            )
        )

    # Legacy Microsoft Excel BIFF files use the OLE Compound
    # File Binary container.
    if suffix == ".xls":
        return data.startswith(
            b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
        )

    if suffix in {
        ".docx",
        ".xlsx",
        ".zip",
    }:
        return data.startswith(
            (
                b"PK\x03\x04",
                b"PK\x05\x06",
            )
        )

    return False


def _validate_zip(
    data: bytes,
) -> None:
    try:
        from io import BytesIO

        with zipfile.ZipFile(
            BytesIO(data)
        ) as archive:
            infos = archive.infolist()

            if len(
                infos
            ) > MAX_ZIP_MEMBERS:
                raise DocumentSecurityError(
                    "The uploaded archive contains too many files."
                )

            total = 0

            for info in infos:
                target = Path(
                    info.filename
                )

                if (
                    target.is_absolute()
                    or ".." in target.parts
                ):
                    raise DocumentSecurityError(
                        "The uploaded archive contains an unsafe file path."
                    )

                # Do not accept password-protected/encrypted archives.
                if int(
                    info.flag_bits
                    or 0
                ) & 0x1:
                    raise DocumentSecurityError(
                        "Encrypted ZIP members are not permitted."
                    )

                total += max(
                    0,
                    int(
                        info.file_size
                        or 0
                    ),
                )

                if (
                    total
                    > MAX_ZIP_UNCOMPRESSED_MB
                    * 1024
                    * 1024
                ):
                    raise DocumentSecurityError(
                        "The uploaded archive expands beyond "
                        "the allowed safe size."
                    )

    except zipfile.BadZipFile as exc:
        raise DocumentSecurityError(
            "The uploaded Office/archive file is invalid."
        ) from exc


def _scan_if_enabled(path: Path) -> None:
    if not ENABLE_AV:
        return
    scanner = shutil.which("clamscan") or shutil.which("clamdscan")
    if not scanner:
        raise DocumentSecurityError("Antivirus scanning is enabled but no scanner is configured.")
    result = subprocess.run([scanner, "--no-summary", str(path)], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        path.unlink(missing_ok=True)
        raise DocumentSecurityError("The uploaded file did not pass malware scanning.")


def validate_upload_bytes(
    name: str,
    data: bytes,
) -> tuple[str, str]:
    """Validate an upload without persisting it.

    This is shared by normal attachment uploads and the
    multi-format procurement importer so they enforce the same
    security policy.
    """
    clean_name = _safe_filename(
        name
        or "upload"
    )

    suffix = Path(
        clean_name
    ).suffix.lower()

    if suffix not in ALLOWED_EXTENSIONS:
        raise DocumentSecurityError(
            "This file type is not permitted."
        )

    if not data:
        raise DocumentSecurityError(
            "The uploaded file is empty."
        )

    if (
        len(data)
        > MAX_UPLOAD_MB
        * 1024
        * 1024
    ):
        raise DocumentSecurityError(
            f"The file exceeds the "
            f"{MAX_UPLOAD_MB} MB upload limit."
        )

    if not _looks_like_allowed_content(
        data,
        suffix,
    ):
        raise DocumentSecurityError(
            "The file content does not match "
            "its permitted file type."
        )

    if suffix in {
        ".docx",
        ".xlsx",
        ".zip",
    }:
        _validate_zip(
            data
        )

    return (
        clean_name,
        suffix,
    )


def validate_zip_archive_bytes(
    data: bytes,
) -> None:
    """Validate ZIP structure without applying the top-level
    uploaded-file byte-size limit.

    Used for already-packaged local import archives. Uploaded ZIPs
    still pass validate_upload_bytes() before persistence.
    """
    if not data:
        raise DocumentSecurityError(
            "The archive is empty."
        )

    if not _looks_like_allowed_content(
        data,
        ".zip",
    ):
        raise DocumentSecurityError(
            "The archive content is invalid."
        )

    _validate_zip(
        data
    )


def scan_saved_upload(
    path: str | Path,
) -> None:
    """Apply the configured antivirus policy to a persisted file."""
    _scan_if_enabled(
        Path(path)
    )


def secure_save_upload(
    uploaded_file: Any,
    subfolder: str,
) -> tuple[str | None, str | None]:
    if not uploaded_file:
        return None, None

    data = uploaded_file.getvalue()

    name, _suffix = validate_upload_bytes(
        getattr(
            uploaded_file,
            "name",
            "upload",
        ),
        data,
    )

    file_hash = hashlib.sha256(
        data
    ).hexdigest()

    folder = (
        ATTACHMENT_DIR
        / re.sub(
            r"[^A-Za-z0-9_-]+",
            "_",
            subfolder
            or "uploads",
        )
    )

    folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = (
        folder
        / f"{file_hash[:16]}_{name}"
    )

    if not path.exists():
        path.write_bytes(
            data
        )

        try:
            os.chmod(
                path,
                0o600,
            )
        except Exception:
            pass

        _scan_if_enabled(
            path
        )

    return (
        str(path),
        file_hash,
    )
