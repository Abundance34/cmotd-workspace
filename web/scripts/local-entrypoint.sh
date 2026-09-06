#!/bin/sh
set -eu

SECRETS_DIR="/run/procureflow-secrets"

if [ ! -s "$SECRETS_DIR/audit_key" ] || [ ! -s "$SECRETS_DIR/payee_key" ]; then
  echo "Local ProcureFlow secrets are missing. Start the stack with docker compose so the secrets service can initialize them." >&2
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://procureflow:procureflow_local_only@db:5432/procureflow}"
export PROCUREFLOW_AUDIT_SIGNING_KEY_V2="$(cat "$SECRETS_DIR/audit_key")"
export PROCUREFLOW_PAYEE_ENCRYPTION_KEY_V2="$(cat "$SECRETS_DIR/payee_key")"
export PROCUREFLOW_SESSION_TIMEOUT_MINUTES="${PROCUREFLOW_SESSION_TIMEOUT_MINUTES:-43200}"
export PROCUREFLOW_REMEMBER_ME_SESSION_DAYS="${PROCUREFLOW_REMEMBER_ME_SESSION_DAYS:-90}"
export PROCUREFLOW_LOGIN_LOCKOUT_ATTEMPTS="${PROCUREFLOW_LOGIN_LOCKOUT_ATTEMPTS:-5}"
export MIGRATION_PREVIEW="${MIGRATION_PREVIEW:-0}"
export PROCUREFLOW_PRODUCTION="${PROCUREFLOW_PRODUCTION:-0}"

printf '\nProcureFlow local stack\n'
printf '  App:      http://localhost:3000\n'
printf '  Database: local PostgreSQL container (not Neon)\n'
printf '  Audit key: generated inside Docker and persisted in a local named volume\n'
printf '  Payee key: generated inside Docker and persisted in a local named volume\n'
printf '  Login password: use `docker compose -f docker-compose.local.yml exec app cat /run/procureflow-secrets/local_user_password`\n\n'

exec npm run dev -- -H 0.0.0.0
