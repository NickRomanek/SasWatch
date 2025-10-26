# ============================================
# Adobe Usage Monitor - Intune Installer
# ============================================
# This script installs the Adobe Usage Monitor as a Windows Scheduled Task
# that runs continuously at system startup.
#
# Usage: PowerShell.exe -ExecutionPolicy Bypass -File Install-AdobeMonitor.ps1
# Run as: SYSTEM (Intune handles this automatically)
# ============================================

$ErrorActionPreference = "Stop"

# Configuration
$INSTALL_DIR = "C:\ProgramData\AdobeMonitor"
$SCRIPT_NAME = "Monitor-AdobeUsage.ps1"
$TASK_NAME = "Adobe Usage Monitor - SubTracker"
$LOG_FILE = "$INSTALL_DIR\install.log"

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
    Write-Log "Adobe Usage Monitor Installation Started" "INFO"
    Write-Log "========================================" "INFO"

    # Step 1: Get script location
    $scriptLocation = $PSScriptRoot
    $sourceScript = Join-Path $scriptLocation $SCRIPT_NAME

    Write-Log "Script location: $scriptLocation" "INFO"
    Write-Log "Source script: $sourceScript" "INFO"

    # Verify source script exists
    if (-not (Test-Path $sourceScript)) {
        throw "Monitoring script not found at: $sourceScript"
    }
    Write-Log "Source script verified" "SUCCESS"

    # Step 2: Create installation directory
    Write-Log "Creating installation directory: $INSTALL_DIR" "INFO"
    if (-not (Test-Path $INSTALL_DIR)) {
        New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
        Write-Log "Directory created successfully" "SUCCESS"
    } else {
        Write-Log "Directory already exists" "INFO"
    }

    # Step 3: Copy monitoring script to installation directory
    $targetScript = Join-Path $INSTALL_DIR $SCRIPT_NAME
    Write-Log "Copying script to: $targetScript" "INFO"
    Copy-Item -Path $sourceScript -Destination $targetScript -Force
    Write-Log "Script copied successfully" "SUCCESS"

    # Step 4: Remove existing scheduled task if it exists
    $existingTask = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($existingTask) {
        Write-Log "Removing existing scheduled task" "WARN"
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
        Write-Log "Existing task removed" "SUCCESS"
    }

    # Step 5: Create scheduled task
    Write-Log "Creating scheduled task: $TASK_NAME" "INFO"

    # Task action - Run PowerShell with monitoring script
    $action = New-ScheduledTaskAction `
        -Execute "PowerShell.exe" `
        -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$targetScript`""

    # Task trigger - At startup
    $trigger = New-ScheduledTaskTrigger -AtStartup

    # Task principal - Run as SYSTEM
    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest

    # Task settings
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -DontStopOnIdleEnd `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)

    # Register the task
    Register-ScheduledTask `
        -TaskName $TASK_NAME `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description "Monitors Adobe Creative Cloud usage and reports to SubTracker" `
        -ErrorAction Stop | Out-Null

    Write-Log "Scheduled task created successfully" "SUCCESS"

    # Step 6: Start the monitoring task
    Write-Log "Starting monitoring task" "INFO"
    Start-ScheduledTask -TaskName $TASK_NAME

    # Wait a moment and verify it started
    Start-Sleep -Seconds 2
    $taskInfo = Get-ScheduledTaskInfo -TaskName $TASK_NAME

    if ($taskInfo.LastTaskResult -eq 267009) {
        Write-Log "Task is currently running" "SUCCESS"
    } else {
        Write-Log "Task started (Result code: $($taskInfo.LastTaskResult))" "SUCCESS"
    }

    Write-Log "========================================" "INFO"
    Write-Log "Installation completed successfully!" "SUCCESS"
    Write-Log "Monitoring script: $targetScript" "INFO"
    Write-Log "Scheduled task: $TASK_NAME" "INFO"
    Write-Log "========================================" "INFO"

    exit 0

} catch {
    Write-Log "========================================" "ERROR"
    Write-Log "Installation FAILED!" "ERROR"
    Write-Log "Error: $_" "ERROR"
    Write-Log "========================================" "ERROR"
    exit 1
}
