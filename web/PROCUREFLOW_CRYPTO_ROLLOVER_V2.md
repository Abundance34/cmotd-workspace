# ProcureFlow cryptographic rollover v2

Approved migration decision: the Next.js/Vercel/Neon application must not depend on GCP at runtime.

## Legacy v1 evidence

- Historical `audit_events` remain immutable in Neon.
- Their stored hashes and signatures are preserved exactly as migrated.
- The original GCP Secret Manager audit key is unavailable, so historical v1 signatures are retained but cannot be independently re-verified after GCP exit.
- The first v2 audit write creates an explicit `Cryptographic Audit Rollover` event whose `previous_event_hash` points to the final legacy audit hash. No legacy event is re-signed or rewritten.
- Historical encrypted `payment_payee_details` rows remain untouched. Their masked values remain usable, but the full plaintext cannot be recovered without the unavailable legacy encryption key.

## Active v2 keys

Vercel holds two new independent secrets:

- `PROCUREFLOW_AUDIT_SIGNING_KEY_V2`
- `PROCUREFLOW_PAYEE_ENCRYPTION_KEY_V2`

The old environment variables are not valid substitutes for these v2 keys.

Facility write actions remain locked until `PROCUREFLOW_AUDIT_SIGNING_KEY_V2` is configured with a strong value and passes the active-chain verification check.

All newly entered or re-verified payee details must use the v2 payee encryption helper and must never overwrite legacy ciphertext merely to make it decryptable.

## Audit continuity

The v2 chain uses `signature_key_version = 'v2'`. The first v2 event records:

- rollover from v1 to v2;
- legacy signing key status as unavailable after GCP exit;
- legacy-history policy as preserved and not re-signed;
- the legacy tail hash used as the continuity link.

This preserves evidentiary continuity without making a false claim that the unavailable v1 signing key was recovered.
