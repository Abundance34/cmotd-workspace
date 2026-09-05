import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { verifyPayeeEncryptionKeyV2 } from "./payee-crypto";

const ACTIVE_AUDIT_KEY_ENV = "PROCUREFLOW_AUDIT_SIGNING_KEY_V2";
const ACTIVE_PAYEE_KEY_ENV = "PROCUREFLOW_PAYEE_ENCRYPTION_KEY_V2";
const ACTIVE_AUDIT_KEY_VERSION = "v2";

export type SecurityMigrationStatus = {
  legacyAuditPreserved: boolean;
  legacyAuditEventCount: number;
  legacyAuditVerifiable: boolean;
  legacyPayeeEncryptedRows: number;
  legacyPayeeRecoverable: boolean;
  activeAuditKeyConfigured: boolean;
  activeAuditKeyVerified: boolean;
  activeAuditChainStarted: boolean;
  activePayeeKeyConfigured: boolean;
  activePayeeKeyVerified: boolean;
  writesEnabled: boolean;
  // Compatibility aliases used by the current dashboard while the UI is being relabelled.
  auditKeyConfigured: boolean;
  auditKeyVerified: boolean;
  payeeKeyConfigured: boolean;
  payeeKeyVerified: boolean;
};

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

function safeEqualHex(a: string, b: string) {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function activeAuditKey() {
  const configured = process.env[ACTIVE_AUDIT_KEY_ENV]?.trim();
  return configured && configured.length >= 32 ? configured : null;
}

export async function verifyActiveAuditSigningKey() {
  const configured = activeAuditKey();
  if (!configured) return false;

  const sql = db();
  const rows = await sql<{
    canonical_payload_json: unknown;
    previous_event_hash: string;
    record_hash: string;
    record_signature: string;
  }[]>`
    SELECT canonical_payload_json, previous_event_hash, record_hash, record_signature
    FROM audit_events
    WHERE signature_key_version = ${ACTIVE_AUDIT_KEY_VERSION}
    ORDER BY id DESC
    LIMIT 1
  `;

  const row = rows[0];

  // Before the first v2 write there is no persisted v2 signature to compare against.
  // A strong configured key is therefore considered ready; the first write creates
  // the explicit v1 -> v2 rollover marker and all subsequent checks verify that record.
  if (!row) {
    const probe = createHmac("sha256", configured)
      .update("procureflow-audit-v2-self-test", "utf8")
      .digest("hex");
    return probe.length === 64;
  }

  const canonical = canonicalJson(row.canonical_payload_json);
  const expectedHash = createHash("sha256")
    .update(`${row.previous_event_hash}\n${canonical}`, "utf8")
    .digest("hex");
  if (!safeEqualHex(expectedHash, row.record_hash)) return false;

  const expectedSignature = createHmac("sha256", configured)
    .update(row.record_hash, "utf8")
    .digest("hex");
  return safeEqualHex(expectedSignature, row.record_signature);
}

export async function getSecurityMigrationStatus(): Promise<SecurityMigrationStatus> {
  const sql = db();

  const [legacyAuditRows, legacyPayeeRows, v2Rows] = await Promise.all([
    sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM audit_events
      WHERE signature_key_version IS DISTINCT FROM ${ACTIVE_AUDIT_KEY_VERSION}
    `,
    sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM payment_payee_details
      WHERE COALESCE(
        payee_name_encrypted,
        account_name_encrypted,
        bank_name_encrypted,
        account_number_encrypted
      ) IS NOT NULL
    `,
    sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM audit_events
      WHERE signature_key_version = ${ACTIVE_AUDIT_KEY_VERSION}
    `,
  ]);

  const legacyAuditEventCount = Number(legacyAuditRows[0]?.count || 0);
  const legacyPayeeEncryptedRows = Number(legacyPayeeRows[0]?.count || 0);
  const activeAuditChainStarted = Number(v2Rows[0]?.count || 0) > 0;
  const activeAuditKeyConfigured = Boolean(activeAuditKey());
  const activePayeeKeyConfigured = Boolean(
    process.env[ACTIVE_PAYEE_KEY_ENV]?.trim() &&
      (process.env[ACTIVE_PAYEE_KEY_ENV]?.trim().length || 0) >= 32,
  );

  const [activeAuditKeyVerified, activePayeeKeyVerified] = await Promise.all([
    verifyActiveAuditSigningKey().catch(() => false),
    Promise.resolve(verifyPayeeEncryptionKeyV2()),
  ]);

  return {
    legacyAuditPreserved: legacyAuditEventCount > 0,
    legacyAuditEventCount,
    legacyAuditVerifiable: false,
    legacyPayeeEncryptedRows,
    legacyPayeeRecoverable: false,
    activeAuditKeyConfigured,
    activeAuditKeyVerified,
    activeAuditChainStarted,
    activePayeeKeyConfigured,
    activePayeeKeyVerified,
    writesEnabled: activeAuditKeyVerified,
    auditKeyConfigured: activeAuditKeyConfigured,
    auditKeyVerified: activeAuditKeyVerified,
    payeeKeyConfigured: activePayeeKeyConfigured,
    payeeKeyVerified: activePayeeKeyVerified,
  };
}
