import { createHash, createHmac, randomUUID } from "node:crypto";

const AUDIT_GENESIS_HASH = "PROCUREFLOW_AUDIT_GENESIS_V1";
const AUDIT_CHAIN_VERSION = "v1";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(stable(value));
}

function auditSigningKey() {
  const key = process.env.PROCUREFLOW_AUDIT_SIGNING_KEY?.trim();
  if (!key) {
    throw new Error("PROCUREFLOW_AUDIT_SIGNING_KEY is not configured. ProcureFlow write actions are disabled until the original audit signing key is migrated.");
  }
  return key;
}

type Tx = any;

type AuditInput = {
  action: string;
  entityType: string;
  entityId?: number | string | null;
  entityReference?: string | null;
  actorUserId?: number | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  beforeValues?: Record<string, unknown> | null;
  afterValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  reasonOrComment?: string | null;
  severity?: string;
  source?: string;
};

export async function appendAuditEvent(tx: Tx, input: AuditInput) {
  // Serialize writers so the tamper-evident hash chain never forks.
  await tx`SELECT pg_advisory_xact_lock(hashtext('procureflow:audit-chain'))`;

  const prior = await tx<{ record_hash: string }[]>`
    SELECT record_hash
    FROM audit_events
    ORDER BY id DESC
    LIMIT 1
  `;
  const previousHash = prior[0]?.record_hash || AUDIT_GENESIS_HASH;
  const occurredAt = new Date().toISOString();
  const correlationId = `PF-${randomUUID()}`;

  const payload = {
    occurred_at: occurredAt,
    correlation_id: correlationId,
    entity_type: input.entityType,
    entity_id: input.entityId == null ? null : String(input.entityId),
    entity_reference: input.entityReference ?? null,
    actor_user_id: input.actorUserId ?? null,
    actor_username: input.actorUsername ?? null,
    actor_role: input.actorRole ?? null,
    action: input.action,
    outcome: "Success",
    severity: input.severity || "Normal",
    source: input.source || "nextjs",
    before_values: input.beforeValues ?? null,
    after_values: input.afterValues ?? null,
    metadata: input.metadata ?? null,
    reason_or_comment: input.reasonOrComment ?? null,
  };

  const canonical = canonicalJson(payload);
  const recordHash = createHash("sha256").update(`${previousHash}\n${canonical}`, "utf8").digest("hex");
  const signature = createHmac("sha256", auditSigningKey()).update(recordHash, "utf8").digest("hex");

  await tx`
    INSERT INTO audit_events (
      occurred_at, correlation_id, entity_type, entity_id, entity_reference,
      actor_user_id, actor_username, actor_role, action, outcome, severity, source,
      before_values_redacted_json, after_values_redacted_json, metadata_redacted_json,
      reason_or_comment, canonical_payload_json, previous_event_hash, record_hash,
      record_signature, signature_key_version, created_at
    ) VALUES (
      ${occurredAt}, ${correlationId}, ${input.entityType}, ${input.entityId == null ? null : String(input.entityId)}, ${input.entityReference ?? null},
      ${input.actorUserId ?? null}, ${input.actorUsername ?? null}, ${input.actorRole ?? null}, ${input.action}, 'Success', ${input.severity || "Normal"}, ${input.source || "nextjs"},
      ${tx.json(input.beforeValues ?? null)}, ${tx.json(input.afterValues ?? null)}, ${tx.json(input.metadata ?? null)},
      ${input.reasonOrComment ?? null}, ${tx.json(JSON.parse(canonical))}, ${previousHash}, ${recordHash},
      ${signature}, ${AUDIT_CHAIN_VERSION}, ${occurredAt}
    )
  `;

  return { correlationId, recordHash };
}
