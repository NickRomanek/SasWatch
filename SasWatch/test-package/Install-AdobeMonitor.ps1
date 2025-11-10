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
$STATUS_FILE = "$INSTALL_DIR\status.json"

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

    # Step 1: Get script location and check for generated script
    $scriptLocation = $PSScriptRoot
    $sourceScript = Join-Path $scriptLocation $SCRIPT_NAME

    Write-Log "Script location: $scriptLocation" "INFO"
    Write-Log "Source script: $sourceScript" "INFO"

    # Check if we have a generated script with API configuration
    $generatedScript = Join-Path $scriptLocation "Monitor-AdobeUsage-Generated.ps1"
    if (Test-Path $generatedScript) {
        $sourceScript = $generatedScript
        Write-Log "Using generated script with API configuration: $sourceScript" "INFO"
    } else {
        Write-Log "Generated script not found, using default: $sourceScript" "WARN"
    }

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
    try {
        Register-ScheduledTask `
            -TaskName $TASK_NAME `
            -Action $action `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Description "Monitors Adobe Creative Cloud usage and reports to SubTracker" `
            -ErrorAction Stop | Out-Null

        Write-Log "Scheduled task created successfully" "SUCCESS"
    } catch {
        Write-Log "Failed to create scheduled task: $_" "ERROR"
        throw "Scheduled task creation failed: $_"
    }

    # Step 6: Start the monitoring task
    Write-Log "Starting monitoring task" "INFO"
    Start-ScheduledTask -TaskName $TASK_NAME

    # Wait a moment and verify it started
    Start-Sleep -Seconds 3
    $taskInfo = Get-ScheduledTaskInfo -TaskName $TASK_NAME
    $task = Get-ScheduledTask -TaskName $TASK_NAME

    if ($taskInfo.LastTaskResult -eq 267009) {
        Write-Log "Task is currently running" "SUCCESS"
    } else {
        Write-Log "Task started (Result code: $($taskInfo.LastTaskResult))" "SUCCESS"
    }

    # Step 7: Test API connectivity
    Write-Log "Testing API connectivity..." "INFO"
    try {
        # Create a test script to check API connectivity
        $testScript = @"
# Test API connectivity
`$API_URL = "https://abowdyv2-production.up.railway.app/api/track"
`$testData = @{
    event = "install_test"
    url = "system"
    clientId = [System.Guid]::NewGuid().ToString()
    windowsUser = "`$env:USERNAME"
    userDomain = "`$env:USERDOMAIN"
    computerName = "`$env:COMPUTERNAME"
    why = "installation_test"
    when = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Compress

try {
    `$response = Invoke-RestMethod -Uri `$API_URL -Method POST -Body `$testData -ContentType "application/json" -TimeoutSec 10
    Write-Output "API_TEST_SUCCESS"
} catch {
    Write-Output "API_TEST_FAILED: `$_"
}
"@
        
        $testScriptPath = Join-Path $INSTALL_DIR "api-test.ps1"
        Set-Content -Path $testScriptPath -Value $testScript
        
        $apiTestResult = & powershell.exe -ExecutionPolicy Bypass -File $testScriptPath
        Remove-Item $testScriptPath -Force -ErrorAction SilentlyContinue
        
        if ($apiTestResult -like "API_TEST_SUCCESS*") {
            Write-Log "API connectivity test PASSED" "SUCCESS"
        } else {
            Write-Log "API connectivity test FAILED: $apiTestResult" "WARN"
        }
    } catch {
        Write-Log "Could not test API connectivity: $_" "WARN"
    }

    # Step 8: Create status file for troubleshooting
    $statusInfo = @{
        installed = $true
        installTime = (Get-Date).ToUniversalTime().ToString("o")
        taskName = $TASK_NAME
        taskState = $task.State
        taskLastResult = $taskInfo.LastTaskResult
        scriptPath = $targetScript
        installDir = $INSTALL_DIR
        logFile = $LOG_FILE
        apiTestResult = if ($apiTestResult) { $apiTestResult } else { "Not tested" }
        systemInfo = @{
            computerName = $env:COMPUTERNAME
            username = $env:USERNAME
            userDomain = $env:USERDOMAIN
            osVersion = [System.Environment]::OSVersion.VersionString
        }
    } | ConvertTo-Json -Depth 3

    Set-Content -Path $STATUS_FILE -Value $statusInfo
    Write-Log "Status file created: $STATUS_FILE" "INFO"

    Write-Log "========================================" "INFO"
    Write-Log "Installation completed successfully!" "SUCCESS"
    Write-Log "Monitoring script: $targetScript" "INFO"
    Write-Log "Scheduled task: $TASK_NAME" "INFO"
    Write-Log "Status file: $STATUS_FILE" "INFO"
    Write-Log "Log file: $LOG_FILE" "INFO"
    Write-Log "========================================" "INFO"
    Write-Log "TROUBLESHOOTING INFO:" "INFO"
    Write-Log "- Check status file: $STATUS_FILE" "INFO"
    Write-Log "- Check log file: $LOG_FILE" "INFO"
    Write-Log "- Task state: $($task.State)" "INFO"
    Write-Log "- Task last result: $($taskInfo.LastTaskResult)" "INFO"
    Write-Log "- API test result: $apiTestResult" "INFO"
    Write-Log "========================================" "INFO"

    exit 0

} catch {
    Write-Log "========================================" "ERROR"
    Write-Log "Installation FAILED!" "ERROR"
    Write-Log "Error: $_" "ERROR"
    Write-Log "========================================" "ERROR"
    exit 1
}
