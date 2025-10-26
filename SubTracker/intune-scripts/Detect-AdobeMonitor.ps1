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

# Check #1: Verify scheduled task exists
$task = Get-ScheduledTask -TaskName $TASK_NAME

if (-not $task) {
    # Task doesn't exist - not installed
    exit 1
}

# Check #2: Verify monitoring script file exists
$scriptPath = Join-Path $INSTALL_DIR $SCRIPT_NAME

if (-not (Test-Path $scriptPath)) {
    # Script file doesn't exist - not installed
    exit 1
}

# Check #3: Verify task is properly configured
# Make sure it's set to run as SYSTEM
if ($task.Principal.UserId -ne "SYSTEM") {
    # Task not running as SYSTEM - incorrect installation
    exit 1
}

# All checks passed - app is properly installed
Write-Output "Adobe Usage Monitor is installed and configured correctly"
Write-Output "Task: $TASK_NAME"
Write-Output "Script: $scriptPath"
Write-Output "Principal: $($task.Principal.UserId)"
Write-Output "State: $($task.State)"

exit 0
