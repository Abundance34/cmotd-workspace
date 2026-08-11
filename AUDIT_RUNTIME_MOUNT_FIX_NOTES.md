# PostgreSQL Audit Runtime-Mount Fix

The compatibility audit previously treated the generated runtime encryption key at
`data/.procureflow_local_encryption.key` as a packaged secret even when `/app/data`
was a Docker bind mount. This caused one false audit failure in the running
container despite `.dockerignore` correctly excluding the key from the image.

The audit now distinguishes a mounted runtime data path from the packaged source
tree by reading Linux mount information. It still fails when:

- `.env` is actually present inside the packaged application image; or
- the encryption-key file exists in the unmounted/distributable source tree.

No application workflow, database schema, records, permissions, or UI behavior is
changed by this update.
