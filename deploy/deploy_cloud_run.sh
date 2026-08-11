#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${1:-deploy/cloudrun.env}"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing $CONFIG_FILE. Copy deploy/cloudrun.env.example and fill it in." >&2
  exit 2
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

required=(PROJECT_ID REGION SERVICE_NAME ARTIFACT_REPOSITORY IMAGE_NAME INSTANCE_CONNECTION_NAME DB_NAME DB_USER FILE_BUCKET SERVICE_ACCOUNT DB_PASSWORD_SECRET SESSION_COOKIE_SECRET PAYEE_ENCRYPTION_SECRET AUDIT_SIGNING_SECRET)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" || "${!name}" == your-* ]]; then
    echo "Set $name in $CONFIG_FILE before deployment." >&2
    exit 2
  fi
done

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/${IMAGE_NAME}:$(date -u +%Y%m%dT%H%M%SZ)"

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud builds submit --tag "$IMAGE" .

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  --set-env-vars "PROCUREFLOW_PRODUCTION=1,PROCUREFLOW_DATABASE_BACKEND=postgresql,INSTANCE_CONNECTION_NAME=${INSTANCE_CONNECTION_NAME},PROCUREFLOW_DB_NAME=${DB_NAME},PROCUREFLOW_DB_USER=${DB_USER},PROCUREFLOW_DB_POOL_MIN=1,PROCUREFLOW_DB_POOL_MAX=8,PROCUREFLOW_DB_CONNECT_TIMEOUT_SECONDS=10,PROCUREFLOW_DB_STATEMENT_TIMEOUT_MS=30000,PROCUREFLOW_SEED_DEFAULTS=0,PROCUREFLOW_DATA_DIR=/mnt/procureflow,PROCUREFLOW_UPLOAD_DIR=/mnt/procureflow/attachments,PROCUREFLOW_BACKUP_DIR=/mnt/procureflow/backups" \
  --set-secrets "PROCUREFLOW_DB_PASSWORD=${DB_PASSWORD_SECRET}:latest,PROCUREFLOW_SESSION_COOKIE_SECRET=${SESSION_COOKIE_SECRET}:latest,PROCUREFLOW_PAYEE_ENCRYPTION_KEY=${PAYEE_ENCRYPTION_SECRET}:latest,PROCUREFLOW_AUDIT_SIGNING_KEY=${AUDIT_SIGNING_SECRET}:latest" \
  --add-volume "name=procureflow-files,type=cloud-storage,bucket=${FILE_BUCKET}" \
  --add-volume-mount "volume=procureflow-files,mount-path=/mnt/procureflow" \
  --memory 2Gi \
  --cpu 2 \
  --concurrency 40 \
  --timeout 300

echo "Deployed $SERVICE_NAME with image $IMAGE"
