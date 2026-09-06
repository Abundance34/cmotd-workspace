# ProcureFlow local Docker stack

This stack is intentionally isolated from Neon and Vercel. It starts:

- the Next.js ProcureFlow app on `http://localhost:3000`;
- a local PostgreSQL 16 database on host port `54329`;
- all numbered PostgreSQL migrations from `../migrations/postgresql`;
- a one-shot bootstrap service that creates local roles, permissions, users and the Facility-to-Procurement Manager link;
- a one-shot secrets service that generates the active v2 audit signing key, active v2 payee encryption key and a local login password inside a Docker named volume.

No `.env.local` file and no Neon credentials are required.

## Start

From the `web` directory:

```powershell
docker compose -f docker-compose.local.yml up --build
```

Open `http://localhost:3000`.

## Local accounts

Usernames:

- `admin`
- `facility`
- `manager`
- `approver`
- `finance`
- `logistics`
- `auditor`

All seven accounts share one randomly generated local-only password. Read it with:

```powershell
docker compose -f docker-compose.local.yml exec app cat /run/procureflow-secrets/local_user_password
```

## Runtime configuration

Inside the app container the stack supplies:

```text
DATABASE_URL=postgresql://procureflow:procureflow_local_only@db:5432/procureflow
PROCUREFLOW_AUDIT_SIGNING_KEY_V2=<generated inside Docker>
PROCUREFLOW_PAYEE_ENCRYPTION_KEY_V2=<generated inside Docker>
PROCUREFLOW_SESSION_TIMEOUT_MINUTES=43200
PROCUREFLOW_REMEMBER_ME_SESSION_DAYS=90
PROCUREFLOW_LOGIN_LOCKOUT_ATTEMPTS=5
PROCUREFLOW_PASSWORD_HISTORY_COUNT=5
PROCUREFLOW_PRODUCTION=0
MIGRATION_PREVIEW=0
```

The two cryptographic keys are never committed to Git. They are generated from OpenSSL random bytes and persisted in the `procureflow_local_secrets` Docker volume so encrypted local records remain usable after container restarts.

## Inspect local secrets when needed

```powershell
docker compose -f docker-compose.local.yml exec app sh -c 'printf "Audit: "; cat /run/procureflow-secrets/audit_key; printf "\nPayee: "; cat /run/procureflow-secrets/payee_key; printf "\n"'
```

These are local development keys only. Never copy them to production.

## Connect to local PostgreSQL from the host

```text
Host: localhost
Port: 54329
Database: procureflow
User: procureflow
Password: procureflow_local_only
```

Or open psql inside Docker:

```powershell
docker compose -f docker-compose.local.yml exec db psql -U procureflow -d procureflow
```

## Stop without deleting local data

```powershell
docker compose -f docker-compose.local.yml down
```

## Completely reset local database and generated keys

This destroys only the Docker-local ProcureFlow database and local development keys:

```powershell
docker compose -f docker-compose.local.yml down -v
```

The next `up --build` creates a fresh database, runs all migrations again and generates new local keys and a new local login password.
