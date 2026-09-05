import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ACTIVE_PAYEE_KEY_ENV = "PROCUREFLOW_PAYEE_ENCRYPTION_KEY_V2";

function base64UrlEncode(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function activePayeeEncryptionKey() {
  const configured = process.env[ACTIVE_PAYEE_KEY_ENV]?.trim();
  if (!configured || configured.length < 32) {
    throw new Error(
      `${ACTIVE_PAYEE_KEY_ENV} is not configured with a strong v2 key. Payee encryption writes remain locked.`,
    );
  }
  return configured;
}

export function payeeKeyMaterialV2(configured = activePayeeEncryptionKey()) {
  try {
    const decoded = base64UrlDecode(configured);
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to the same SHA-256 derivation used by the Python service.
  }
  return createHash("sha256").update(configured, "utf8").digest();
}

export function encryptPayeeValueV2(value: string, configured = activePayeeEncryptionKey()) {
  const key = payeeKeyMaterialV2(configured);
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);
  const iv = randomBytes(16);

  const cipher = createCipheriv("aes-128-cbc", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  const version = Buffer.from([0x80]);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));

  const signed = Buffer.concat([version, timestamp, iv, ciphertext]);
  const mac = createHmac("sha256", signingKey).update(signed).digest();
  return base64UrlEncode(Buffer.concat([signed, mac]));
}

export function decryptPayeeValueV2(token: string, configured = activePayeeEncryptionKey()) {
  const raw = base64UrlDecode(token);
  if (raw.length < 1 + 8 + 16 + 32 || raw[0] !== 0x80) {
    throw new Error("Invalid Fernet token");
  }

  const signed = raw.subarray(0, raw.length - 32);
  const suppliedMac = raw.subarray(raw.length - 32);
  const key = payeeKeyMaterialV2(configured);
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);
  const expectedMac = createHmac("sha256", signingKey).update(signed).digest();

  if (suppliedMac.length !== expectedMac.length || !timingSafeEqual(suppliedMac, expectedMac)) {
    throw new Error("Fernet signature mismatch");
  }

  const iv = raw.subarray(9, 25);
  const ciphertext = raw.subarray(25, raw.length - 32);
  const decipher = createDecipheriv("aes-128-cbc", encryptionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function verifyPayeeEncryptionKeyV2() {
  try {
    const configured = activePayeeEncryptionKey();
    const probe = "procureflow-v2-payee-self-test";
    return decryptPayeeValueV2(encryptPayeeValueV2(probe, configured), configured) === probe;
  } catch {
    return false;
  }
}
