@echo off
REM SasWatch Unified Startup Script
REM Usage: start.bat       - starts servers
REM        start.bat stop  - stops servers

if "%1"=="stop" (
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\stop-servers.ps1"
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start-servers.ps1"
)

