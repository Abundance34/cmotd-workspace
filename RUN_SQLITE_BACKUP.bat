@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
    py -3 backup_sqlite.py
) else (
    python backup_sqlite.py
)

echo.
pause
