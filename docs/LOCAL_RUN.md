# Local Run Instructions

## Option 1 — Existing SQLite development mode

This is retained for local development and recovery only. Production cutover must use PostgreSQL.

### Windows

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Set these values in `.env`:

```text
PROCUREFLOW_PRODUCTION=0
PROCUREFLOW_DATABASE_BACKEND=sqlite
PROCUREFLOW_SQLITE_PATH=data/procureflow_workspace.db
PROCUREFLOW_SEED_DEFAULTS=1
```

Then run:

```powershell
python migrate_existing_db.py
streamlit run app.py
```

### Linux/macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python migrate_existing_db.py
streamlit run app.py --server.address=0.0.0.0 --server.port=8501
```

## Option 2 — Local PostgreSQL with Docker Compose

Create a local `.env` file first. Supply unique development-only values and never commit the file:

```text
PROCUREFLOW_DB_PASSWORD=<strong-local-database-password>
PROCUREFLOW_SESSION_COOKIE_SECRET=<random-session-secret>
PROCUREFLOW_PAYEE_ENCRYPTION_KEY=<random-payee-encryption-key>
PROCUREFLOW_AUDIT_SIGNING_KEY=<random-audit-signing-key>
```

Then start the stack:

```bash
docker compose up --build
```

Open `http://localhost:8501`. Docker Compose refuses to start when any required secret is missing; no password or cryptographic key is hardcoded in the repository.

Health checks:

```bash
docker compose exec procureflow python scripts/database_healthcheck.py
docker compose exec postgres pg_isready -U procureflow -d procureflow
```

## Tests

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q
python -m compileall -q app.py core modules repositories services scripts workers
```

The `PYTEST_DISABLE_PLUGIN_AUTOLOAD` prefix avoids unrelated globally installed pytest tracing plugins from interfering with SQLite fixture teardown. It is not required in a clean virtual environment.
