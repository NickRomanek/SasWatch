# PowerShell Monitoring Script Upgrade Plan

**Created:** 2025-01-24
**Status:** Ready for Implementation
**Priority:** High

---

## Executive Summary

This document outlines a comprehensive upgrade to the Adobe usage monitoring PowerShell script to support:
- **Once-per-day tracking** per user per application
- **Silent production deployment** with dev/prod auto-detection
- **Enterprise-grade logging** and error handling
- **Resilient operation** with retry logic and mutex protection
- **Intune Win32 app deployment** ready

---

## Table of Contents

1. [Requirements & Goals](#requirements--goals)
2. [Architecture Overview](#architecture-overview)
3. [Implementation Phases](#implementation-phases)
4. [File Structure](#file-structure)
5. [Code Changes Required](#code-changes-required)
6. [Testing Strategy](#testing-strategy)
7. [Deployment Guide](#deployment-guide)
8. [Benefits & Solutions](#benefits--solutions)
9. [Next Steps Checklist](#next-steps-checklist)

---

## Requirements & Goals

### Confirmed Requirements

✅ **Daily Tracking Logic**
- Reset at midnight (12:00 AM local time)
- One event per user per app per day
- Two users on same PC = Two events

✅ **Persistence**
- File-based storage: `C:\ProgramData\AdobeMonitor\tracking\`
- JSON format for easy debugging
- Auto-cleanup of old tracking files (7 days)

✅ **Execution Model**
- Continuous loop checking every 5 minutes
- Only report once per day per user per app
- If already reported today, skip until tomorrow

✅ **Dev vs Production Mode**
- Auto-detect based on API URL
- Localhost/127.0.0.1 = Development (console output)
- Railway URL = Production (file logging only)

✅ **Retry Logic**
- Initial API test retries every 30 minutes indefinitely
- Script waits for connection before starting monitoring
- Runtime errors don't crash the script

✅ **Instance Management**
- Mutex prevents multiple instances
- Graceful exit if already running

✅ **Deployment**
- Intune Win32 App (not PowerShell Scripts)
- Run as SYSTEM account
- Scheduled Task auto-created

---

## Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────┐
│  Script Starts (SYSTEM account)                 │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Detect Mode (Dev/Prod based on API URL)        │
│  - localhost = Dev (console)                    │
│  - Railway = Prod (file logs)                   │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Check Mutex (prevent duplicate instances)      │
│  Exit if another instance running               │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Initialize Logging & Tracking System           │
│  - Create directories                           │
│  - Load today's tracking file                   │
│  - Clean old files                              │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Initial API Connection Test                    │
│  Retry every 30 min until success               │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
        ┌─────────────────┐
        │  Monitoring Loop │
        │  Every 5 minutes │
        └────────┬─────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │ Get Active Adobe Processes │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────────────┐
    │ For Each Process:                  │
    │  - Check if user+app reported today│
    │  - If NO: Send event, mark reported│
    │  - If YES: Skip (wait until tomorrow)│
    └────────────┬───────────────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │ Check if day changed       │
    │ (midnight rollover)        │
    │ Switch to new tracking file│
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │ Sleep 5 minutes            │
    │ Loop back                  │
    └────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Tracking Logic Changes

**File:** `SubTracker/lib/script-generator.js`

#### 1.1 Add Daily Tracking Functions

**Add these PowerShell functions to the generated script:**

```powershell
function Get-TodayTrackingFile {
    $trackingDir = "C:\ProgramData\AdobeMonitor\tracking"
    if (-not (Test-Path $trackingDir)) {
        New-Item -ItemType Directory -Path $trackingDir -Force | Out-Null
    }

    $today = (Get-Date).ToString("yyyy-MM-dd")
    return Join-Path $trackingDir "tracking-$today.json"
}

function Get-TodayTracking {
    $trackingFile = Get-TodayTrackingFile

    if (Test-Path $trackingFile) {
        try {
            $content = Get-Content $trackingFile -Raw | ConvertFrom-Json
            return $content
        }
        catch {
            # Corrupted file, start fresh
            return @{
                date = (Get-Date).ToString("yyyy-MM-dd")
                reported = @()
            }
        }
    }
    else {
        return @{
            date = (Get-Date).ToString("yyyy-MM-dd")
            reported = @()
        }
    }
}

function Test-AlreadyReportedToday {
    param(
        [string]$Username,
        [string]$AppName
    )

    $tracking = Get-TodayTracking
    $key = "${Username}_${AppName}"

    foreach ($item in $tracking.reported) {
        if ("$($item.user)_$($item.app)" -eq $key) {
            return $true
        }
    }

    return $false
}

function Add-ReportedToday {
    param(
        [string]$Username,
        [string]$AppName,
        [string]$ComputerName
    )

    $trackingFile = Get-TodayTrackingFile
    $tracking = Get-TodayTracking

    $newEntry = @{
        user = $Username
        app = $AppName
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        computer = $ComputerName
    }

    $tracking.reported += $newEntry

    try {
        $tracking | ConvertTo-Json -Depth 10 | Set-Content $trackingFile -Force
    }
    catch {
        Write-Log "Warning: Failed to update tracking file: $_" "Warning"
    }
}

function Remove-OldTrackingFiles {
    $trackingDir = "C:\ProgramData\AdobeMonitor\tracking"
    if (Test-Path $trackingDir) {
        $cutoffDate = (Get-Date).AddDays(-7)
        Get-ChildItem $trackingDir -Filter "tracking-*.json" | Where-Object {
            $_.LastWriteTime -lt $cutoffDate
        } | Remove-Item -Force
    }
}
```

#### 1.2 Modify Monitor-AdobeUsage Function

**Replace the monitoring loop logic:**

```powershell
function Monitor-AdobeUsage {
    Write-Log "Starting Adobe Usage Monitor..." "Info"
    Write-Log "API URL: $API_URL" "Info"
    Write-Log "Check Interval: $CHECK_INTERVAL seconds" "Info"
    Write-Log "Tracking Mode: Active window only (ignores background processes)" "Info"
    Write-Log "Reporting: Once per user per app per day" "Info"

    # Clean up old tracking files at startup
    Remove-OldTrackingFiles

    $currentDate = (Get-Date).Date

    while ($true) {
        try {
            # Check if day changed (midnight rollover)
            $today = (Get-Date).Date
            if ($today -ne $currentDate) {
                Write-Log "Day changed - switching to new tracking file" "Info"
                $currentDate = $today
                Remove-OldTrackingFiles
            }

            $runningProcesses = Get-RunningAdobeProcesses

            foreach ($process in $runningProcesses) {
                $processName = $process.name
                $username = $env:USERNAME

                # Check if already reported today for this user+app combo
                if (Test-AlreadyReportedToday -Username $username -AppName $processName) {
                    Write-Log "Already reported today: $processName for user $username - skipping" "Debug"
                    continue
                }

                # Not reported yet - send event
                $usageData = @{
                    event = "adobe_desktop_usage"
                    url = $processName
                    clientId = [System.Guid]::NewGuid().ToString()
                    windowsUser = $username
                    userDomain = $env:USERDOMAIN
                    computerName = $env:COMPUTERNAME
                    why = "process_monitor"
                    when = (Get-Date).ToUniversalTime().ToString("o")
                }

                if (Send-UsageData -Data $usageData) {
                    Add-ReportedToday -Username $username -AppName $processName -ComputerName $env:COMPUTERNAME
                    Write-Log "Reported: $processName (User: $username, Computer: $env:COMPUTERNAME)" "Success"
                }
            }

            Start-Sleep -Seconds $CHECK_INTERVAL
        }
        catch {
            Write-Log "Error in monitoring loop: $_" "Error"
            Start-Sleep -Seconds 300  # Wait 5 minutes on error before retrying
        }
    }
}
```

---

### Phase 2: Dev vs Production Mode

#### 2.1 Mode Detection Function

```powershell
function Get-DeploymentMode {
    if ($API_URL -match "localhost|127\.0\.0\.1|0\.0\.0\.0") {
        return "Development"
    }
    else {
        return "Production"
    }
}
```

#### 2.2 Logging System

```powershell
# Global variable set at script start
$script:DeploymentMode = Get-DeploymentMode

function Initialize-Logging {
    $logDir = "C:\ProgramData\AdobeMonitor\logs"

    if ($script:DeploymentMode -eq "Production") {
        if (-not (Test-Path $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        # Clean logs older than 30 days
        $cutoffDate = (Get-Date).AddDays(-30)
        Get-ChildItem $logDir -Filter "monitor-*.log" | Where-Object {
            $_.LastWriteTime -lt $cutoffDate
        } | Remove-Item -Force
    }

    Write-Log "==================================================" "Info"
    Write-Log "  Adobe Usage Monitor - Abowdy" "Info"
    Write-Log "==================================================" "Info"
    Write-Log "Deployment Mode: $script:DeploymentMode" "Info"
    Write-Log "API URL: $API_URL" "Info"
    Write-Log "" "Info"
}

function Get-LogFilePath {
    $today = (Get-Date).ToString("yyyy-MM-dd")
    return "C:\ProgramData\AdobeMonitor\logs\monitor-$today.log"
}

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "Info"  # Info, Success, Warning, Error, Debug
    )

    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logMessage = "[$timestamp] [$Level] $Message"

    if ($script:DeploymentMode -eq "Development") {
        # Console output with colors
        $color = switch ($Level) {
            "Success" { "Green" }
            "Warning" { "Yellow" }
            "Error" { "Red" }
            "Debug" { "Gray" }
            default { "White" }
        }
        Write-Host $logMessage -ForegroundColor $color
    }
    else {
        # File output
        try {
            $logFile = Get-LogFilePath
            Add-Content -Path $logFile -Value $logMessage -Force
        }
        catch {
            # Silently fail if can't write to log
        }
    }
}
```

**Replace all existing `Write-Host` calls with `Write-Log` calls:**

```powershell
# OLD:
Write-Host "✓ Usage data sent successfully" -ForegroundColor Green

# NEW:
Write-Log "✓ Usage data sent successfully" "Success"
```

---

### Phase 3: Retry Logic & Resilience

#### 3.1 Enhanced Initial API Test

```powershell
function Test-APIConnection {
    $testData = @{
        event = "monitor_started"
        url = "system"
        clientId = [System.Guid]::NewGuid().ToString()
        windowsUser = $env:USERNAME
        userDomain = $env:USERDOMAIN
        computerName = $env:COMPUTERNAME
        why = "initialization"
        when = (Get-Date).ToUniversalTime().ToString("o")
    }

    return Send-UsageData -Data $testData
}

function Wait-ForAPIConnection {
    Write-Log "Testing API connection..." "Info"

    $attempt = 0
    while ($true) {
        $attempt++

        if (Test-APIConnection) {
            Write-Log "✓ API connection successful!" "Success"
            return $true
        }
        else {
            $waitMinutes = 30
            Write-Log "✗ API connection failed (attempt $attempt). Retrying in $waitMinutes minutes..." "Warning"
            Write-Log "  This could be due to: network offline, DNS issues, or firewall blocking" "Warning"

            # Wait 30 minutes (1800 seconds)
            Start-Sleep -Seconds 1800
        }
    }
}
```

#### 3.2 Update Main Execution

```powershell
try {
    # Initialize
    $script:DeploymentMode = Get-DeploymentMode
    Initialize-Logging

    # Check mutex
    $mutexName = "Global\AdobeUsageMonitor_$($API_KEY.GetHashCode())"
    $mutex = New-Object System.Threading.Mutex($false, $mutexName, [ref]$false)

    if (-not $mutex.WaitOne(0)) {
        Write-Log "Another instance is already running. Exiting." "Warning"
        exit 0
    }

    try {
        # Wait for API connection (retries indefinitely)
        Wait-ForAPIConnection

        # Start monitoring
        Monitor-AdobeUsage
    }
    finally {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}
catch {
    Write-Log "✗ Critical Error: $_" "Error"
    Write-Log "Stack Trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}
```

---

### Phase 4: Instance Management

#### 4.1 Mutex Implementation

Already included in Phase 3.2 above. Key points:

- Mutex name based on API key hash (unique per deployment)
- Global scope works across user sessions
- Properly disposed in finally block
- Graceful exit if another instance running

---

### Phase 5: Deployment Packaging

#### 5.1 Installation Script for Intune

**Create new file:** `SubTracker/scripts/Install-AdobeMonitor.ps1`

```powershell
# Intune Win32 App Installation Script
# This script is run by Intune to deploy the Adobe Usage Monitor

param(
    [string]$ScriptPath = "Monitor-AdobeUsage.ps1"
)

$ErrorActionPreference = "Stop"

try {
    # Create directory structure
    $installDir = "C:\ProgramData\AdobeMonitor"
    $logsDir = Join-Path $installDir "logs"
    $trackingDir = Join-Path $installDir "tracking"

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    New-Item -ItemType Directory -Path $trackingDir -Force | Out-Null

    # Copy monitoring script
    $sourceScript = Join-Path $PSScriptRoot $ScriptPath
    $destScript = Join-Path $installDir "Monitor-AdobeUsage.ps1"
    Copy-Item -Path $sourceScript -Destination $destScript -Force

    # Create Scheduled Task
    $action = New-ScheduledTaskAction `
        -Execute "PowerShell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$destScript`""

    $trigger = New-ScheduledTaskTrigger -AtStartup

    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 5)

    Register-ScheduledTask `
        -TaskName "Adobe Usage Monitor" `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Force | Out-Null

    # Start the task immediately
    Start-ScheduledTask -TaskName "Adobe Usage Monitor"

    Write-Output "Installation completed successfully"
    exit 0
}
catch {
    Write-Error "Installation failed: $_"
    exit 1
}
```

#### 5.2 Uninstallation Script

**Create new file:** `SubTracker/scripts/Uninstall-AdobeMonitor.ps1`

```powershell
# Intune Win32 App Uninstallation Script

$ErrorActionPreference = "Stop"

try {
    # Stop and remove scheduled task
    Unregister-ScheduledTask -TaskName "Adobe Usage Monitor" -Confirm:$false -ErrorAction SilentlyContinue

    # Remove installation directory
    Remove-Item -Path "C:\ProgramData\AdobeMonitor" -Recurse -Force -ErrorAction SilentlyContinue

    Write-Output "Uninstallation completed successfully"
    exit 0
}
catch {
    Write-Error "Uninstallation failed: $_"
    exit 1
}
```

#### 5.3 Detection Script

**Create new file:** `SubTracker/scripts/Detect-AdobeMonitor.ps1`

```powershell
# Intune Win32 App Detection Script
# Returns 0 if installed correctly, 1 if not

$scriptPath = "C:\ProgramData\AdobeMonitor\Monitor-AdobeUsage.ps1"
$taskName = "Adobe Usage Monitor"

# Check if script exists
if (-not (Test-Path $scriptPath)) {
    Write-Output "Script not found"
    exit 1
}

# Check if scheduled task exists
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Output "Scheduled task not found"
    exit 1
}

# Check if task is enabled
if ($task.State -eq "Disabled") {
    Write-Output "Scheduled task is disabled"
    exit 1
}

Write-Output "Adobe Usage Monitor is installed and configured"
exit 0
```

---

## File Structure

### After Implementation

```
C:\ProgramData\AdobeMonitor\
├── Monitor-AdobeUsage.ps1          # Main monitoring script
├── logs\                           # Production logs only
│   ├── monitor-2025-01-24.log      # Today's log
│   ├── monitor-2025-01-23.log      # Yesterday
│   └── ... (kept for 30 days)
└── tracking\                       # Daily tracking files
    ├── tracking-2025-01-24.json    # Today's tracking
    ├── tracking-2025-01-23.json    # Yesterday
    └── ... (kept for 7 days)
```

### Tracking File Format

```json
{
  "date": "2025-01-24",
  "reported": [
    {
      "user": "nroma",
      "app": "Acrobat.exe",
      "timestamp": "2025-01-24T09:15:22.1234567Z",
      "computer": "DESKTOP-GR0KE59"
    },
    {
      "user": "jdoe",
      "app": "Acrobat.exe",
      "timestamp": "2025-01-24T10:30:45.7654321Z",
      "computer": "DESKTOP-GR0KE59"
    },
    {
      "user": "nroma",
      "app": "Photoshop.exe",
      "timestamp": "2025-01-24T14:22:11.9876543Z",
      "computer": "DESKTOP-GR0KE59"
    }
  ]
}
```

### Log File Format (Production Only)

```
[2025-01-24 08:00:15] [Info] ==================================================
[2025-01-24 08:00:15] [Info]   Adobe Usage Monitor - Abowdy
[2025-01-24 08:00:15] [Info] ==================================================
[2025-01-24 08:00:15] [Info] Deployment Mode: Production
[2025-01-24 08:00:15] [Info] API URL: https://abowdy-production.up.railway.app/api/track
[2025-01-24 08:00:15] [Info]
[2025-01-24 08:00:15] [Info] Testing API connection...
[2025-01-24 08:00:16] [Success] ✓ API connection successful!
[2025-01-24 08:00:16] [Info] Starting Adobe Usage Monitor...
[2025-01-24 08:00:16] [Info] API URL: https://abowdy-production.up.railway.app/api/track
[2025-01-24 08:00:16] [Info] Check Interval: 300 seconds
[2025-01-24 08:00:16] [Info] Tracking Mode: Active window only (ignores background processes)
[2025-01-24 08:00:16] [Info] Reporting: Once per user per app per day
[2025-01-24 09:15:22] [Success] Reported: Acrobat.exe (User: nroma, Computer: DESKTOP-GR0KE59)
[2025-01-24 09:20:22] [Debug] Already reported today: Acrobat.exe for user nroma - skipping
```

---

## Code Changes Required

### Summary of Files to Modify

1. **`SubTracker/lib/script-generator.js`** - Main script generator
   - Add all new PowerShell functions
   - Replace monitoring loop logic
   - Update main execution block

2. **Create new files:**
   - `SubTracker/scripts/Install-AdobeMonitor.ps1`
   - `SubTracker/scripts/Uninstall-AdobeMonitor.ps1`
   - `SubTracker/scripts/Detect-AdobeMonitor.ps1`

3. **Update deployment instructions:**
   - Modify `generateDeploymentInstructions()` in `script-generator.js`
   - Add Intune Win32 app packaging guide

### Detailed Changes to script-generator.js

**Structure of the new `generateMonitorScript()` function:**

```javascript
function generateMonitorScript(apiKey, apiUrl, nodeEnv = 'production') {
    const cleanApiUrl = apiUrl.replace(/\/$/, '');
    const checkInterval = nodeEnv === 'development' ? 5 : 300;
    const intervalDescription = nodeEnv === 'development' ? '5 seconds (TESTING MODE)' : '5 minutes';

    return `# Adobe Usage Monitor - Auto-configured for your Abowdy account
# Generated: ${new Date().toISOString()}
# Environment: ${nodeEnv.toUpperCase()}

# ============================================
# Configuration (DO NOT MODIFY)
# ============================================

$API_KEY = "${apiKey}"
$API_URL = "${cleanApiUrl}/api/track"
$CHECK_INTERVAL = ${checkInterval}  # Check every ${intervalDescription}

# ============================================
# Deployment Mode Detection
# ============================================

${generateModeDetectionCode()}

# ============================================
# Logging System
# ============================================

${generateLoggingCode()}

# ============================================
# Daily Tracking System
# ============================================

${generateTrackingCode()}

# ============================================
# Adobe Process Monitoring
# ============================================

${generateAdobeProcessesCode()}

# ============================================
# API Communication
# ============================================

${generateAPICommunicationCode()}

# ============================================
# Main Monitoring Loop
# ============================================

${generateMonitoringLoopCode()}

# ============================================
# Main Execution
# ============================================

${generateMainExecutionCode()}
`;
}

// Helper functions to generate each section
function generateModeDetectionCode() { /* ... */ }
function generateLoggingCode() { /* ... */ }
function generateTrackingCode() { /* ... */ }
// etc...
```

---

## Testing Strategy

### Local Development Testing

**Test Scenario 1: Dev Mode Console Output**

1. Download script from localhost:3000
2. Run manually in PowerShell
3. Verify console output appears
4. Open Acrobat
5. See immediate console feedback
6. Verify event in dashboard

**Test Scenario 2: Once-Per-Day Logic**

1. Run script with Acrobat open
2. Verify first event sent
3. Keep Acrobat open, wait 5 minutes
4. Verify NO second event sent
5. Check tracking file created
6. Verify user+app combo recorded

**Test Scenario 3: Multiple Users**

1. Run as User A, open Acrobat
2. Verify event sent for User A
3. Switch to User B, open Acrobat
4. Verify event sent for User B
5. Check tracking file has both entries

**Test Scenario 4: Multiple Apps**

1. Open Acrobat - verify event
2. Open Photoshop - verify event
3. Wait 5 minutes
4. Both still open - verify NO new events
5. Tracking file should have 2 entries

**Test Scenario 5: Midnight Rollover**

1. Change system clock to 11:58 PM
2. Open Acrobat - verify event sent
3. Change system clock to 12:02 AM
4. Verify new tracking file created
5. Open Acrobat again - verify NEW event sent

**Test Scenario 6: Mutex**

1. Start script in PowerShell window 1
2. Try to start script in PowerShell window 2
3. Verify second instance exits with mutex message
4. Kill first instance
5. Start second instance - should work

### Production Testing

**Test Scenario 1: Silent Operation**

1. Deploy to test machine with Railway URL
2. Verify no console window appears
3. Check Task Manager for PowerShell process
4. Verify log file created in `C:\ProgramData\AdobeMonitor\logs\`
5. Tail log file to see activity

**Test Scenario 2: Offline Retry**

1. Deploy script
2. Disconnect network
3. Verify script retries every 30 minutes (check log)
4. Reconnect network
5. Verify script connects and starts monitoring

**Test Scenario 3: Script Restart**

1. Script running with Acrobat already reported
2. Kill PowerShell process
3. Restart script (via scheduled task)
4. Verify it reads existing tracking file
5. Open Acrobat - should NOT send event (already reported)

### Intune Deployment Testing

**Test Scenario 1: Win32 App Deployment**

1. Package app with IntuneWinAppUtil
2. Upload to Intune
3. Assign to test device group
4. Monitor Intune deployment status
5. Verify installation success
6. Check device for:
   - Files in `C:\ProgramData\AdobeMonitor\`
   - Scheduled task created
   - Task is running
7. Verify events in dashboard

**Test Scenario 2: Detection Rule**

1. Deploy to test device
2. Verify detection script returns success
3. Uninstall from device
4. Verify detection script returns failure
5. Intune should show "Not Installed"

---

## Deployment Guide

### Intune Win32 App Packaging

#### Step 1: Prepare Package Folder

```
AdobeMonitor-Package\
├── Monitor-AdobeUsage.ps1      # Download from Railway web app
├── Install-AdobeMonitor.ps1    # From scripts folder
└── Uninstall-AdobeMonitor.ps1  # From scripts folder
```

#### Step 2: Create IntuneWin Package

```powershell
# Download Microsoft Win32 Content Prep Tool
# https://github.com/Microsoft/Microsoft-Win32-Content-Prep-Tool

.\IntuneWinAppUtil.exe `
    -c "C:\Path\To\AdobeMonitor-Package" `
    -s "Install-AdobeMonitor.ps1" `
    -o "C:\Path\To\Output" `
    -q
```

#### Step 3: Upload to Intune

1. Go to Intune Portal → Apps → Windows → Add
2. Select "Windows app (Win32)"
3. Upload the `.intunewin` file
4. Configure:

**App Information:**
- Name: Adobe Usage Monitor - Abowdy
- Description: Monitors Adobe application usage and reports to Abowdy dashboard
- Publisher: Your Organization

**Program:**
- Install command:
  ```
  powershell.exe -ExecutionPolicy Bypass -File Install-AdobeMonitor.ps1
  ```
- Uninstall command:
  ```
  powershell.exe -ExecutionPolicy Bypass -File Uninstall-AdobeMonitor.ps1
  ```
- Install behavior: System

**Requirements:**
- Operating system: Windows 10 1607+ (64-bit)
- Minimum disk space: 10 MB

**Detection Rules:**
- Rule type: Use custom detection script
- Script file: `Detect-AdobeMonitor.ps1`
- Run script as 32-bit: No

**Return Codes:**
- 0 = Success
- 1 = Failed

#### Step 4: Assignments

- Assign to: Adobe licensed users security group
- Deployment type: Required
- End user notifications: Hide all toast notifications

#### Step 5: Monitor Deployment

1. Intune Portal → Apps → Adobe Usage Monitor → Device install status
2. Check for failures
3. Review device logs if issues occur

---

## Benefits & Solutions

### Benefits of This Approach

✅ **Reduced API Load**
- Only 1 event per user per app per day (vs. every 5 minutes)
- 96% reduction in API calls for active users
- Lower bandwidth consumption

✅ **Better Data Quality**
- Clear "user used app on this day" metric
- No duplicate events cluttering dashboard
- Easier to answer: "How many days this month did User X use Acrobat?"

✅ **Enterprise IT Friendly**
- Standard ProgramData location
- File-based logs viewable by admins
- Standard Scheduled Task (familiar to IT)
- Silent operation in production

✅ **Developer Friendly**
- Console output during development
- Easy to debug locally
- Test with localhost API

✅ **Resilient & Reliable**
- Handles network outages gracefully
- Retries indefinitely until connected
- Survives script restarts (tracking persists)
- Prevents duplicate instances

✅ **Low Maintenance**
- Auto-cleanup of old files
- Self-healing on errors
- No manual intervention needed

### Potential Concerns & Solutions

| Concern | Solution |
|---------|----------|
| **File permissions in ProgramData** | Script runs as SYSTEM, has full access |
| **Defender might flag file writes** | ProgramData is standard location, less suspicious. Can add exclusion if needed |
| **User logs in after midnight before check** | Script checks date on every loop iteration, auto-switches files |
| **Multiple users on Terminal Server** | Tracking uses username in key, handles this correctly |
| **Script crashes mid-day** | Reads existing tracking file on restart, knows what's reported |
| **Tracking file corruption** | Try/catch with fallback to fresh file if JSON parse fails |
| **Disk space from logs** | Auto-cleanup: tracking files 7 days, logs 30 days |
| **How to debug production issues?** | Check log files in `C:\ProgramData\AdobeMonitor\logs\` |

---

## Next Steps Checklist

### Implementation (Day 1)

- [ ] **1. Backup Current Script Generator**
  ```bash
  cp SubTracker/lib/script-generator.js SubTracker/lib/script-generator.js.backup
  ```

- [ ] **2. Create Helper Functions**
  - [ ] Add `generateModeDetectionCode()` function
  - [ ] Add `generateLoggingCode()` function
  - [ ] Add `generateTrackingCode()` function
  - [ ] Add `generateAPICommunicationCode()` function
  - [ ] Add `generateMonitoringLoopCode()` function
  - [ ] Add `generateMainExecutionCode()` function

- [ ] **3. Update Main Generator**
  - [ ] Modify `generateMonitorScript()` to use new helper functions
  - [ ] Test script generation with localhost API
  - [ ] Verify generated script structure

- [ ] **4. Create Deployment Scripts**
  - [ ] Create `SubTracker/scripts/Install-AdobeMonitor.ps1`
  - [ ] Create `SubTracker/scripts/Uninstall-AdobeMonitor.ps1`
  - [ ] Create `SubTracker/scripts/Detect-AdobeMonitor.ps1`

- [ ] **5. Update Deployment Instructions**
  - [ ] Modify `generateDeploymentInstructions()`
  - [ ] Add Win32 app packaging section
  - [ ] Add troubleshooting for new features

### Testing (Day 2-3)

- [ ] **6. Local Development Tests**
  - [ ] Test dev mode console output
  - [ ] Test once-per-day logic
  - [ ] Test multiple users (if possible)
  - [ ] Test multiple apps
  - [ ] Test midnight rollover (change clock)
  - [ ] Test mutex (run twice)

- [ ] **7. Production-Like Tests**
  - [ ] Deploy to test VM with Railway URL
  - [ ] Verify silent operation (no console)
  - [ ] Check log files created
  - [ ] Verify tracking files working
  - [ ] Test offline retry (disconnect network)
  - [ ] Test script restart mid-day

- [ ] **8. Fix Issues Found**
  - [ ] Debug any errors
  - [ ] Adjust logging levels if needed
  - [ ] Tune retry intervals if needed

### Deployment (Day 4-5)

- [ ] **9. Commit Changes**
  - [ ] Review all code changes
  - [ ] Commit to git with detailed message
  - [ ] Push to GitHub

- [ ] **10. Deploy to Railway**
  - [ ] Push changes to Railway
  - [ ] Verify Railway deployment successful
  - [ ] Download new script from production
  - [ ] Test production script locally

- [ ] **11. Create Intune Package**
  - [ ] Create package folder
  - [ ] Download production script
  - [ ] Copy install/uninstall scripts
  - [ ] Create .intunewin package
  - [ ] Upload to Intune
  - [ ] Configure app settings

- [ ] **12. Pilot Deployment**
  - [ ] Create pilot user group (5-10 users)
  - [ ] Assign app to pilot group
  - [ ] Monitor deployment status
  - [ ] Verify events in dashboard
  - [ ] Check for issues

- [ ] **13. Full Rollout**
  - [ ] Verify pilot success (48 hours)
  - [ ] Assign to all Adobe licensed users
  - ] Monitor deployment
  - [ ] Respond to any issues

### Monitoring (Ongoing)

- [ ] **14. Dashboard Monitoring**
  - [ ] Daily check for expected event volume
  - [ ] Watch for anomalies
  - [ ] Verify all users reporting

- [ ] **15. Log Review**
  - [ ] Sample check log files on devices
  - [ ] Look for repeated errors
  - [ ] Identify network issues

- [ ] **16. Optimization**
  - [ ] Adjust check interval if needed
  - [ ] Tune retry timings if needed
  - [ ] Add more apps to monitor if requested

---

## Additional Resources

### Useful PowerShell Commands for Debugging

**Check if script is running:**
```powershell
Get-Process -Name powershell | Where-Object { $_.CommandLine -like "*Monitor-AdobeUsage*" }
```

**View scheduled task status:**
```powershell
Get-ScheduledTask -TaskName "Adobe Usage Monitor" | Format-List *
```

**Manually start scheduled task:**
```powershell
Start-ScheduledTask -TaskName "Adobe Usage Monitor"
```

**Manually stop scheduled task:**
```powershell
Stop-ScheduledTask -TaskName "Adobe Usage Monitor"
```

**View recent log entries (last 50 lines):**
```powershell
Get-Content "C:\ProgramData\AdobeMonitor\logs\monitor-$(Get-Date -Format 'yyyy-MM-dd').log" -Tail 50
```

**View today's tracking file:**
```powershell
Get-Content "C:\ProgramData\AdobeMonitor\tracking\tracking-$(Get-Date -Format 'yyyy-MM-dd').json" | ConvertFrom-Json | Format-List
```

**Check mutex status (if script won't start):**
```powershell
# Mutex will be released when script exits
# If stuck, find and kill the PowerShell process
Get-Process powershell | Where-Object { $_.CommandLine -like "*Monitor-AdobeUsage*" } | Stop-Process -Force
```

### Intune Resources

- [Win32 Content Prep Tool](https://github.com/Microsoft/Microsoft-Win32-Content-Prep-Tool)
- [Intune Win32 App Management](https://docs.microsoft.com/en-us/mem/intune/apps/apps-win32-app-management)
- [Custom Detection Scripts](https://docs.microsoft.com/en-us/mem/intune/apps/apps-win32-prepare#detection-rules)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-24 | Initial plan created |

---

## Questions or Issues?

If you encounter any issues during implementation:

1. Check the detailed code examples in each phase
2. Review the testing scenarios
3. Check log files for error messages
4. Verify file permissions in ProgramData
5. Test with dev mode (localhost) first

---

**End of Document**
