# ============================================
# Adobe Usage Monitor - Intune Uninstaller
# ============================================
# This script removes the Adobe Usage Monitor scheduled task and
# optionally cleans up files.
#
# Usage: PowerShell.exe -ExecutionPolicy Bypass -File Uninstall-AdobeMonitor.ps1
# Run as: SYSTEM (Intune handles this automatically)
# ============================================

$ErrorActionPreference = "Stop"

# Configuration
$INSTALL_DIR = "C:\ProgramData\AdobeMonitor"
$TASK_NAME = "Adobe Usage Monitor - SubTracker"
$LOG_FILE = "$INSTALL_DIR\uninstall.log"
$REMOVE_FILES = $true  # Set to $false to keep logs/tracking data

# Logging function
function Write-Log {
    param($Message, $Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"

    # Create log directory if needed
    $logDir = Split-Path $LOG_FILE -Parent
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    Add-Content -Path $LOG_FILE -Value $logMessage
    Write-Output $logMessage
}

try {
    Write-Log "========================================" "INFO"
    Write-Log "Adobe Usage Monitor Uninstallation Started" "INFO"
    Write-Log "========================================" "INFO"

    # Step 1: Stop monitoring task if running
    Write-Log "Checking for running monitoring task" "INFO"
    $runningTask = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue

    if ($runningTask) {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $TASK_NAME

        # If task is running, stop it
        if ($taskInfo.LastTaskResult -eq 267009 -or $runningTask.State -eq "Running") {
            Write-Log "Stopping running monitoring task" "INFO"
            Stop-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Write-Log "Task stopped" "SUCCESS"
        } else {
            Write-Log "Task is not currently running" "INFO"
        }
    } else {
        Write-Log "No scheduled task found" "INFO"
    }

    # Step 2: Remove scheduled task
    Write-Log "Removing scheduled task: $TASK_NAME" "INFO"
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue

    if ($task) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
        Write-Log "Scheduled task removed successfully" "SUCCESS"
    } else {
        Write-Log "Scheduled task not found (may already be removed)" "WARN"
    }

    # Step 3: Remove files and directories (optional)
    if ($REMOVE_FILES) {
        if (Test-Path $INSTALL_DIR) {
            Write-Log "Removing installation directory: $INSTALL_DIR" "INFO"

            # Save final log message before deleting
            $finalLogPath = "$env:TEMP\AdobeMonitor-Uninstall-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
            Copy-Item -Path $LOG_FILE -Destination $finalLogPath -ErrorAction SilentlyContinue

            # Remove the directory
            Remove-Item -Path $INSTALL_DIR -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output "Installation directory removed"
            Write-Output "Final log saved to: $finalLogPath"
        } else {
            Write-Log "Installation directory not found" "WARN"
        }
    } else {
        Write-Log "File removal skipped (REMOVE_FILES = $false)" "INFO"
        Write-Log "Files remain at: $INSTALL_DIR" "INFO"
    }

    Write-Log "========================================" "INFO"
    Write-Log "Uninstallation completed successfully!" "SUCCESS"
    Write-Log "========================================" "INFO"

    exit 0

} catch {
    Write-Log "========================================" "ERROR"
    Write-Log "Uninstallation FAILED!" "ERROR"
    Write-Log "Error: $_" "ERROR"
    Write-Log "========================================" "ERROR"
    exit 1
}
