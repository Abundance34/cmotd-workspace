# ProcureFlow Next.js migration

This directory is the isolated Next.js/Vercel replacement for the production Streamlit application. It was created from production baseline `1d63f6a141964d58cd0b4156d3dd646971dccd6c` and intentionally lives beside the Python application until cutover is complete.

## What this first migration commit preserves

- Existing CMOTD wordmark and login artwork.
- The production role names and visible labels.
- Every role-specific sidebar section from `app.py`.
- Core approval/payment/read-only role boundaries from `core/permissions.py`.
- Core request workflow statuses and routing from `core/workflow.py`.
- Compatibility with existing Argon2id, PBKDF2-SHA256 and legacy SHA256 password hashes.
- Compatibility with the existing `users` and `user_sessions` PostgreSQL tables.

## Local development

```bash
cd web
npm install
npm run dev
```

Set `DATABASE_URL` to a migrated PostgreSQL database before testing real login. The `/preview` route is available automatically on Vercel Preview deployments and can also be enabled locally with `MIGRATION_PREVIEW=1`.

## Vercel

When importing the repository into Vercel, set the project Root Directory to `web`. Deploy the `migration/nextjs-vercel` branch as Preview until feature parity and database migration are verified. Do not point the production domain at this app yet.

## Cutover rule

Cloud Run and Cloud SQL remain the production rollback path until Next.js passes role-by-role E2E testing and the PostgreSQL migration is reconciled.

<!-- Production deployment trigger: 2026-09-05 -->
