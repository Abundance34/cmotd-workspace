import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export type SecurityMigrationStatus = {
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

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function payeeKeyMaterial(configured: string) {
  try {
    const decoded = base64UrlDecode(configured);
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall back to the same SHA-256 key derivation used by the Python service.
  }
  return createHash("sha256").update(configured, "utf8").digest();
}

function decryptFernet(token: string, configuredKey: string) {
  const raw = base64UrlDecode(token);
  if (raw.length < 1 + 8 + 16 + 32 || raw[0] !== 0x80) throw new Error("Invalid Fernet token");

  const signed = raw.subarray(0, raw.length - 32);
  const suppliedMac = raw.subarray(raw.length - 32);
  const key = payeeKeyMaterial(configuredKey);
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);
  const expectedMac = createHmac("sha256", signingKey).update(signed).digest();
  if (!timingSafeEqual(suppliedMac, expectedMac)) throw new Error("Fernet signature mismatch");

  const iv = raw.subarray(9, 25);
  const ciphertext = raw.subarray(25, raw.length - 32);
  const decipher = createDecipheriv("aes-128-cbc", encryptionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export async function verifyAuditSigningKey() {
  const configured = process.env.PROCUREFLOW_AUDIT_SIGNING_KEY?.trim();
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
    WHERE source <> 'nextjs' OR source IS NULL
    ORDER BY id DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return true;

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

export async function verifyPayeeEncryptionKey() {
  const configured = process.env.PROCUREFLOW_PAYEE_ENCRYPTION_KEY?.trim();
  if (!configured) return false;

  const sql = db();
  const rows = await sql<{ value: string | null }[]>`
    SELECT COALESCE(payee_name_encrypted, account_name_encrypted, bank_name_encrypted, account_number_encrypted) AS value
    FROM payment_payee_details
    WHERE COALESCE(payee_name_encrypted, account_name_encrypted, bank_name_encrypted, account_number_encrypted) IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `;
  const value = rows[0]?.value;
  if (!value) return true;

  try {
    decryptFernet(value, configured);
    return true;
  } catch {
    return false;
  }
}

export async function getSecurityMigrationStatus(): Promise<SecurityMigrationStatus> {
  const auditKeyConfigured = Boolean(process.env.PROCUREFLOW_AUDIT_SIGNING_KEY?.trim());
  const payeeKeyConfigured = Boolean(process.env.PROCUREFLOW_PAYEE_ENCRYPTION_KEY?.trim());

  const [auditKeyVerified, payeeKeyVerified] = await Promise.all([
    verifyAuditSigningKey().catch(() => false),
    verifyPayeeEncryptionKey().catch(() => false),
  ]);

  return { auditKeyConfigured, auditKeyVerified, payeeKeyConfigured, payeeKeyVerified };
}
