# PostgreSQL Migration Hotfix

## Problem corrected

The `002_e2e_workflow_enhancements.sql` migration attempted to create the receipt OCR index with a non-existent `receipt_records.verification_status` column. Receipt verification already uses the established `receipt_records.status` field. PostgreSQL therefore raised `psycopg.errors.UndefinedColumn` and rolled back migration 002.

## Changes

- Updated `idx_receipts_ocr_status` to index `ocr_status`, `status`, `discrepancy_status`, and `created_at`.
- Applied the same correction to the SQLite compatibility schema in `core/db.py`.
- Added a regression assertion preventing the invalid column reference from returning.

## Existing failed migration state

Migration 002 runs inside a transaction, so the reported failure rolled back its schema changes and it was not recorded as applied. The existing PostgreSQL volume can be reused. Rebuild the ProcureFlow image and rerun the migration command.
