from pathlib import Path

from scripts.migrate_document_storage import destination_for, resolve_source_file


def test_legacy_windows_document_path_can_be_resolved_and_mapped(tmp_path: Path):
    source_root = tmp_path / "data"
    source_file = source_root / "attachments" / "receipts" / "proof.pdf"
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b"%PDF-1.4\nrepresentative")
    legacy = r"C:\ProcureFlow\data\attachments\receipts\proof.pdf"
    resolved = resolve_source_file(legacy, source_root)
    assert resolved == source_file.resolve()
    target = destination_for(resolved, source_root, tmp_path / "cloud", "receipt_records", "file_path")
    assert target == tmp_path / "cloud" / "attachments" / "receipts" / "proof.pdf"
