# ============================================
# Adobe Usage Monitor - Intune Detection Script
# ============================================
# This script checks if the Adobe Usage Monitor is properly installed.
# Intune uses this to determine installation state.
#
# Exit Codes:
#   0 = Installed and operational
#   1 = Not installed or missing components
#
# Intune considers exit 0 as "detected/installed"
# ============================================

$ErrorActionPreference = "SilentlyContinue"

# Configuration
$INSTALL_DIR = "C:\ProgramData\AdobeMonitor"
$SCRIPT_NAME = "Monitor-AdobeUsage.ps1"
$TASK_NAME = "Adobe Usage Monitor - SubTracker"
$RUN_KEY_NAME = "AdobeUsageMonitor"

# Check #1: Verify monitoring script file exists
$scriptPath = Join-Path $INSTALL_DIR $SCRIPT_NAME

if (-not (Test-Path $scriptPath)) {
    # Script file doesn't exist - not installed
    exit 1
}

# Check #2: Verify run key entry exists
$runKeyPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
$runKeyValue = (Get-ItemProperty -Path $runKeyPath -Name $RUN_KEY_NAME -ErrorAction SilentlyContinue).$RUN_KEY_NAME

if (-not $runKeyValue) {
    # Run key entry missing
    exit 1
}

# All checks passed - app is properly installed
Write-Output "Adobe Usage Monitor is installed and configured correctly"
Write-Output "Script: $scriptPath"
Write-Output "Run key: HKLM\\...\\$RUN_KEY_NAME"
Write-Output "Launch command: $runKeyValue"

exit 0
