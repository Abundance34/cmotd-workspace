# ProcureFlow Final PostgreSQL Stabilization Release

This is the single cumulative build produced from the user's latest working folder. It supersedes the earlier individual hotfix archives.

## Upgrade the existing Docker installation without losing PostgreSQL data

The PostgreSQL records are stored in the Docker named volume, not inside this ZIP. Keep the same project-folder name so Docker Compose reuses that volume.

1. Stop only the application container:

```powershell
cd "C:\ProcureFlow_Login_Button_Restore_Fixed"
docker compose stop procureflow
```

2. Back up local configuration and mounted files:

```powershell
cd C:\
Copy-Item "C:\ProcureFlow_Login_Button_Restore_Fixed\.env" "$env:USERPROFILE\Downloads\ProcureFlow.env.backup"
Copy-Item "C:\ProcureFlow_Login_Button_Restore_Fixed\data" "$env:USERPROFILE\Downloads\ProcureFlow-data-backup" -Recurse -Force
Rename-Item "C:\ProcureFlow_Login_Button_Restore_Fixed" "ProcureFlow_Login_Button_Restore_Fixed_PreStabilization"
```

3. Extract the final ZIP to `C:\`. Ensure the resulting path is exactly:

```text
C:\ProcureFlow_Login_Button_Restore_Fixed
```

4. Restore `.env` and mounted data:

```powershell
Copy-Item "$env:USERPROFILE\Downloads\ProcureFlow.env.backup" "C:\ProcureFlow_Login_Button_Restore_Fixed\.env" -Force
Copy-Item "$env:USERPROFILE\Downloads\ProcureFlow-data-backup\*" "C:\ProcureFlow_Login_Button_Restore_Fixed\data" -Recurse -Force
```

5. Rebuild and start:

```powershell
cd "C:\ProcureFlow_Login_Button_Restore_Fixed"
docker compose build procureflow
docker compose up -d --force-recreate procureflow
docker compose ps
```

6. Run the live runtime verification:

```powershell
docker compose exec procureflow python scripts/verify_postgres_runtime.py --report data/backups/postgres_runtime_verification.json
```

Expected: `"status": "passed"`.

7. Complete `docs/FINAL_RUNTIME_ACCEPTANCE.md` and check the logs.

## Important

- Do not run `docker compose down -v`; `-v` deletes the PostgreSQL volume.
- Do not rerun the SQLite-to-PostgreSQL data migration when reusing the already verified PostgreSQL volume.
- The final ZIP intentionally contains no `.env` and no encryption/signing key.
- Startup automatically applies any missing numbered PostgreSQL migration, including `005_audit_immutability.sql`.
