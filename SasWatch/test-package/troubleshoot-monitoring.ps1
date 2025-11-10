# ============================================
# Adobe Usage Monitor - Troubleshooting Script
# ============================================
# This script helps diagnose monitoring issues after Intune installation
#
# Usage: PowerShell.exe -ExecutionPolicy Bypass -File troubleshoot-monitoring.ps1
# ============================================

$ErrorActionPreference = "Continue"

# Configuration
$INSTALL_DIR = "C:\ProgramData\AdobeMonitor"
$TASK_NAME = "Adobe Usage Monitor - SubTracker"
$STATUS_FILE = "$INSTALL_DIR\status.json"
$LOG_FILE = "$INSTALL_DIR\install.log"
$MONITOR_LOG = "$INSTALL_DIR\monitor.log"

function Write-ColorOutput {
    param($Message, $Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

function Test-API-Connectivity {
    param($ApiUrl)
    
    Write-ColorOutput "Testing API connectivity to: $ApiUrl" "Yellow"
    
    try {
        $testData = @{
            event = "troubleshoot_test"
            url = "system"
            clientId = [System.Guid]::NewGuid().ToString()
            windowsUser = $env:USERNAME
            userDomain = $env:USERDOMAIN
            computerName = $env:COMPUTERNAME
            why = "troubleshooting"
            when = (Get-Date).ToUniversalTime().ToString("o")
        } | ConvertTo-Json -Compress

        $response = Invoke-RestMethod -Uri $ApiUrl -Method POST -Body $testData -ContentType "application/json" -TimeoutSec 10
        Write-ColorOutput "✓ API connectivity test PASSED" "Green"
        return $true
    }
    catch {
        Write-ColorOutput "✗ API connectivity test FAILED: $_" "Red"
        return $false
    }
}

function Get-Task-Status {
    try {
        $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
        if ($task) {
            $taskInfo = Get-ScheduledTaskInfo -TaskName $TASK_NAME
            return @{
                Exists = $true
                State = $task.State
                LastResult = $taskInfo.LastTaskResult
                LastRunTime = $taskInfo.LastRunTime
                NextRunTime = $taskInfo.NextRunTime
            }
        } else {
            return @{ Exists = $false }
        }
    }
    catch {
        return @{ Exists = $false; Error = $_ }
    }
}

function Show-File-Contents {
    param($FilePath, $Description)
    
    if (Test-Path $FilePath) {
        Write-ColorOutput "`n--- $Description ---" "Cyan"
        Write-ColorOutput "File: $FilePath" "Gray"
        Write-ColorOutput "Size: $((Get-Item $FilePath).Length) bytes" "Gray"
        Write-ColorOutput "Modified: $((Get-Item $FilePath).LastWriteTime)" "Gray"
        Write-ColorOutput "Contents:" "Gray"
        Write-ColorOutput "----------------------------------------" "Gray"
        
        try {
            $content = Get-Content $FilePath -Raw -ErrorAction Stop
            Write-Host $content
        }
        catch {
            Write-ColorOutput "Error reading file: $_" "Red"
        }
        Write-ColorOutput "----------------------------------------" "Gray"
    } else {
        Write-ColorOutput "`n--- $Description ---" "Cyan"
        Write-ColorOutput "File not found: $FilePath" "Red"
    }
}

# Main troubleshooting
Write-ColorOutput "================================================" "Cyan"
Write-ColorOutput "  Adobe Usage Monitor - Troubleshooting Tool" "Cyan"
Write-ColorOutput "================================================" "Cyan"
Write-ColorOutput ""

# System Information
Write-ColorOutput "SYSTEM INFORMATION:" "Yellow"
Write-ColorOutput "Computer Name: $env:COMPUTERNAME" "White"
Write-ColorOutput "Username: $env:USERNAME" "White"
Write-ColorOutput "User Domain: $env:USERDOMAIN" "White"
Write-ColorOutput "OS Version: $([System.Environment]::OSVersion.VersionString)" "White"
Write-ColorOutput "PowerShell Version: $($PSVersionTable.PSVersion)" "White"
Write-ColorOutput ""

# Check installation directory
Write-ColorOutput "INSTALLATION CHECK:" "Yellow"
if (Test-Path $INSTALL_DIR) {
    Write-ColorOutput "✓ Installation directory exists: $INSTALL_DIR" "Green"
    
    $files = Get-ChildItem $INSTALL_DIR -File
    Write-ColorOutput "Files in installation directory:" "White"
    foreach ($file in $files) {
        Write-ColorOutput "  - $($file.Name) ($($file.Length) bytes)" "Gray"
    }
} else {
    Write-ColorOutput "✗ Installation directory missing: $INSTALL_DIR" "Red"
}
Write-ColorOutput ""

# Check scheduled task
Write-ColorOutput "SCHEDULED TASK CHECK:" "Yellow"
$taskStatus = Get-Task-Status
if ($taskStatus.Exists) {
    Write-ColorOutput "✓ Scheduled task exists: $TASK_NAME" "Green"
    Write-ColorOutput "  State: $($taskStatus.State)" "White"
    Write-ColorOutput "  Last Result: $($taskStatus.LastResult)" "White"
    Write-ColorOutput "  Last Run: $($taskStatus.LastRunTime)" "White"
    Write-ColorOutput "  Next Run: $($taskStatus.NextRunTime)" "White"
    
    if ($taskStatus.State -eq "Running") {
        Write-ColorOutput "✓ Task is currently running" "Green"
    } elseif ($taskStatus.State -eq "Ready") {
        Write-ColorOutput "⚠ Task is ready but not running" "Yellow"
    } else {
        Write-ColorOutput "⚠ Task state: $($taskStatus.State)" "Yellow"
    }
} else {
    Write-ColorOutput "✗ Scheduled task not found: $TASK_NAME" "Red"
    if ($taskStatus.Error) {
        Write-ColorOutput "  Error: $($taskStatus.Error)" "Red"
    }
}
Write-ColorOutput ""

# Check for running Adobe processes
Write-ColorOutput "ADOBE PROCESS CHECK:" "Yellow"
$adobeProcesses = @("Acrobat", "AcroRd32", "Illustrator", "Photoshop", "InDesign", "AfterFX", "Premiere Pro")
$runningAdobe = @()

foreach ($processName in $adobeProcesses) {
    $processes = Get-Process -Name $processName -ErrorAction SilentlyContinue
    if ($processes) {
        $runningAdobe += $processName
        Write-ColorOutput "✓ $processName is running (PID: $($processes[0].Id))" "Green"
    }
}

if ($runningAdobe.Count -eq 0) {
    Write-ColorOutput "⚠ No Adobe processes currently running" "Yellow"
    Write-ColorOutput "  Start an Adobe application to test monitoring" "Gray"
} else {
    Write-ColorOutput "✓ Found $($runningAdobe.Count) Adobe process(es) running" "Green"
}
Write-ColorOutput ""

# Test API connectivity
Write-ColorOutput "API CONNECTIVITY TEST:" "Yellow"
$apiUrl = "http://localhost:3000/api/track"
$apiTestResult = Test-API-Connectivity $apiUrl
Write-ColorOutput ""

# Show status file if it exists
Show-File-Contents $STATUS_FILE "INSTALLATION STATUS FILE"

# Show install log if it exists
Show-File-Contents $LOG_FILE "INSTALLATION LOG"

# Show monitor log if it exists
Show-File-Contents $MONITOR_LOG "MONITOR LOG"

# Recommendations
Write-ColorOutput "RECOMMENDATIONS:" "Yellow"
if (-not $taskStatus.Exists) {
    Write-ColorOutput "• Reinstall the monitoring package" "White"
}
if ($taskStatus.Exists -and $taskStatus.State -ne "Running") {
    Write-ColorOutput "• Restart the scheduled task: Start-ScheduledTask -TaskName '$TASK_NAME'" "White"
}
if (-not $apiTestResult) {
    Write-ColorOutput "• Check internet connectivity and firewall settings" "White"
    Write-ColorOutput "• Verify the API URL is accessible: $apiUrl" "White"
}
if ($runningAdobe.Count -eq 0) {
    Write-ColorOutput "• Start an Adobe application to test monitoring" "White"
}
if (-not (Test-Path $STATUS_FILE)) {
    Write-ColorOutput "• Check installation logs for errors" "White"
}

Write-ColorOutput ""
Write-ColorOutput "================================================" "Cyan"
Write-ColorOutput "Troubleshooting complete!" "Cyan"
Write-ColorOutput "================================================" "Cyan"
