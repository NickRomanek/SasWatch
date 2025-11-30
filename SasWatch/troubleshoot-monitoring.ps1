# Troubleshooting Script for Adobe Usage Monitoring
# Run this in PowerShell as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Adobe Usage Monitor Troubleshooting" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Secure API Key and URL Detection
# ============================================
# Priority: 1. Environment variable, 2. Monitoring script, 3. Error
$API_KEY = $null
$API_URL = $null

# Try environment variable first (most secure)
if ($env:SASWATCH_API_KEY) {
    $API_KEY = $env:SASWATCH_API_KEY
    Write-Host "[CONFIG] Using API key from environment variable" -ForegroundColor Green
} elseif ($env:API_KEY) {
    $API_KEY = $env:API_KEY
    Write-Host "[CONFIG] Using API key from API_KEY environment variable" -ForegroundColor Green
}

# Try environment variable for API URL
if ($env:SASWATCH_API_URL) {
    $API_URL = $env:SASWATCH_API_URL
} elseif ($env:API_URL) {
    $API_URL = $env:API_URL
}

# Fallback: Try to read from installed monitoring script
$scriptPath = "C:\ProgramData\AdobeMonitor\Monitor-AdobeUsage.ps1"
if (-not $API_KEY -and (Test-Path $scriptPath)) {
    try {
        $scriptContent = Get-Content $scriptPath -Raw -ErrorAction SilentlyContinue
        if ($scriptContent -match '\$API_KEY\s*=\s*"([^"]+)"') {
            $API_KEY = $matches[1]
            Write-Host "[CONFIG] Using API key from monitoring script" -ForegroundColor Yellow
        }
        if (-not $API_URL -and $scriptContent -match '\$API_URL\s*=\s*"([^"]+)"') {
            $apiUrlMatch = $matches[1]
            # Extract base URL (remove /api/track if present)
            $API_URL = $apiUrlMatch -replace '/api/track.*$', ''
        }
    } catch {
        # Silently continue if we can't read the script
    }
}

# Default API URL if not found
if (-not $API_URL) {
    $API_URL = "http://localhost:3000"
}

# Validate API key is present
if (-not $API_KEY) {
    Write-Host "[ERROR] API key not found!" -ForegroundColor Red
    Write-Host "  Please set one of the following:" -ForegroundColor Yellow
    Write-Host "    1. Environment variable: `$env:SASWATCH_API_KEY" -ForegroundColor White
    Write-Host "    2. Environment variable: `$env:API_KEY" -ForegroundColor White
    Write-Host "    3. Install monitoring script at: $scriptPath" -ForegroundColor White
    Write-Host ""
    Write-Host "  Example:" -ForegroundColor Cyan
    Write-Host "    `$env:SASWATCH_API_KEY = 'your-api-key-here'" -ForegroundColor Gray
    Write-Host "    `$env:SASWATCH_API_URL = 'https://your-api-url.com'  # Optional" -ForegroundColor Gray
    exit 1
}

Write-Host "[CONFIG] API URL: $API_URL" -ForegroundColor Cyan
Write-Host ""

# 1. Check if monitoring task exists and is running
Write-Host "[1/8] Checking scheduled task..." -ForegroundColor Yellow
$task = Get-ScheduledTask -TaskName "Adobe Usage Monitor - SubTracker" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "  [OK] Task exists" -ForegroundColor Green
    Write-Host "  Status: $($task.State)" -ForegroundColor Cyan

    $taskInfo = Get-ScheduledTaskInfo -TaskName "Adobe Usage Monitor - SubTracker"
    Write-Host "  Last Run: $($taskInfo.LastRunTime)" -ForegroundColor Cyan
    Write-Host "  Last Result: $($taskInfo.LastTaskResult)" -ForegroundColor Cyan

    if ($taskInfo.LastTaskResult -ne 0 -and $taskInfo.LastTaskResult -ne 267009) {
        Write-Host "  [ERROR] Task failed with error code: $($taskInfo.LastTaskResult)" -ForegroundColor Red
    }
} else {
    Write-Host "  [ERROR] Task not found - monitoring is NOT installed" -ForegroundColor Red
}

# 2. Check if monitoring script file exists
Write-Host "`n[2/8] Checking monitoring script..." -ForegroundColor Yellow
if (Test-Path $scriptPath) {
    Write-Host "  [OK] Script exists at: $scriptPath" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] Script not found at: $scriptPath" -ForegroundColor Red
}

# 3. Check if PowerShell monitoring process is running
Write-Host "`n[3/8] Checking for monitoring PowerShell process..." -ForegroundColor Yellow
$monitoringProcesses = Get-WmiObject Win32_Process -Filter "name = 'powershell.exe'" |
    Where-Object {$_.CommandLine -like "*Monitor-AdobeUsage*"}

if ($monitoringProcesses) {
    Write-Host "  [OK] Monitoring process is RUNNING" -ForegroundColor Green
    $monitoringProcesses | ForEach-Object {
        Write-Host "    PID: $($_.ProcessId), Started: $($_.CreationDate)" -ForegroundColor Cyan
    }
} else {
    Write-Host "  [ERROR] Monitoring process is NOT running" -ForegroundColor Red
}

# 4. Check what Adobe processes are currently running
Write-Host "`n[4/8] Checking for Adobe processes..." -ForegroundColor Yellow
$adobeProcessNames = @("Acrobat", "AcroRd32", "Photoshop", "Illustrator", "InDesign", "AfterFX", "Premiere Pro")
$foundAdobe = $false

foreach ($processName in $adobeProcessNames) {
    $proc = Get-Process -Name $processName -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "  [OK] Found: $processName.exe (PID: $($proc.Id))" -ForegroundColor Green
        $foundAdobe = $true
    }
}

if (-not $foundAdobe) {
    Write-Host "  [WARN] No Adobe processes running" -ForegroundColor Yellow
    Write-Host "    (This is OK if you have not opened Adobe apps yet)" -ForegroundColor Gray
}

# 5. Check which process is the active/foreground window
Write-Host "`n[5/8] Checking active window..." -ForegroundColor Yellow
try {
    if (-not ([System.Management.Automation.PSTypeName]'WindowChecker').Type) {
        Add-Type -TypeDefinition @"
            using System;
            using System.Runtime.InteropServices;
            using System.Text;
            public class WindowChecker {
                [DllImport("user32.dll")]
                public static extern IntPtr GetForegroundWindow();
                [DllImport("user32.dll")]
                public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
            }
"@ -ErrorAction SilentlyContinue
    }

    $hwnd = [WindowChecker]::GetForegroundWindow()
    $processId = 0
    [WindowChecker]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null

    if ($processId -gt 0) {
        $activeProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($activeProcess) {
            Write-Host "  Active window: $($activeProcess.Name).exe" -ForegroundColor Cyan

            if ($adobeProcessNames -contains $activeProcess.Name) {
                Write-Host "  [OK] Adobe app is ACTIVE (should be tracked!)" -ForegroundColor Green
            } else {
                Write-Host "  [WARN] Adobe app is NOT active (will not be tracked)" -ForegroundColor Yellow
            }
        }
    }
} catch {
    Write-Host "  Could not determine active window" -ForegroundColor Gray
}

# 6. Test API connectivity
Write-Host "`n[6/8] Testing API connection..." -ForegroundColor Yellow
try {
    $healthCheckUrl = "$API_URL/api/health"
    $healthCheck = Invoke-RestMethod -Uri $healthCheckUrl -Method GET -TimeoutSec 5
    Write-Host "  [OK] SubTracker API is responding" -ForegroundColor Green
    Write-Host "    Status: $($healthCheck.status)" -ForegroundColor Cyan
} catch {
    Write-Host "  [ERROR] Cannot connect to SubTracker API" -ForegroundColor Red
    Write-Host "    Error: $_" -ForegroundColor Red
}

# 7. Test sending a manual event
Write-Host "`n[7/8] Sending test event to API..." -ForegroundColor Yellow
try {
    $headers = @{
        "X-API-Key" = $API_KEY
        "Content-Type" = "application/json"
    }

    $testData = @{
        event = "troubleshoot_test_event"
        url = "Acrobat.exe"
        clientId = "troubleshoot-$(Get-Random)"
        windowsUser = $env:USERNAME
        computerName = $env:COMPUTERNAME
        why = "troubleshooting_script"
        when = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json

    $trackUrl = "$API_URL/api/track"
    $response = Invoke-RestMethod -Uri $trackUrl `
        -Method POST `
        -Headers $headers `
        -Body $testData `
        -TimeoutSec 5

    Write-Host "  [OK] Test event sent successfully!" -ForegroundColor Green
    Write-Host "    Response: $($response | ConvertTo-Json)" -ForegroundColor Cyan
    Write-Host "    Check your dashboard at: $API_URL/dashboard" -ForegroundColor Yellow
} catch {
    Write-Host "  [ERROR] Failed to send test event" -ForegroundColor Red
    Write-Host "    Error: $_" -ForegroundColor Red
}

# 8. Check recent events in database
Write-Host "`n[8/8] Checking recent events in database..." -ForegroundColor Yellow
try {
    $recentEventsUrl = "$API_URL/api/usage/recent?limit=5"
    $recentEvents = Invoke-RestMethod -Uri $recentEventsUrl -Method GET

    $totalEvents = 0
    if ($recentEvents.adobe) { $totalEvents += $recentEvents.adobe.Count }
    if ($recentEvents.wrapper) { $totalEvents += $recentEvents.wrapper.Count }

    Write-Host "  Recent events found: $totalEvents" -ForegroundColor Cyan

    if ($totalEvents -gt 0) {
        Write-Host "`n  Last 3 events:" -ForegroundColor Cyan
        $allEvents = @()
        if ($recentEvents.adobe) { $allEvents += $recentEvents.adobe }
        if ($recentEvents.wrapper) { $allEvents += $recentEvents.wrapper }

        $allEvents | Select-Object -First 3 | ForEach-Object {
            Write-Host "    - $($_.event) from $($_.windowsUser) at $($_.when)" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "  Could not retrieve recent events" -ForegroundColor Gray
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Summary & Recommendations" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not $task) {
    Write-Host "`n[ERROR] Monitoring task is not installed" -ForegroundColor Red
    Write-Host "   FIX: Run Install-AdobeMonitor.ps1" -ForegroundColor Yellow
}

if (-not $monitoringProcesses) {
    Write-Host "`n[ERROR] Monitoring script is not running" -ForegroundColor Red
    Write-Host "   FIX: Start the scheduled task or restart your computer" -ForegroundColor Yellow
}

if (-not $foundAdobe) {
    Write-Host "`n[WARN] No Adobe apps are currently running" -ForegroundColor Yellow
    Write-Host "   ACTION: Open Adobe Acrobat/Photoshop and make it the active window" -ForegroundColor Yellow
}

Write-Host "`n[OK] Next steps:" -ForegroundColor Green
Write-Host "   1. Make sure an Adobe app is running AND is the active window" -ForegroundColor White
Write-Host "   2. Wait 5-10 seconds" -ForegroundColor White
Write-Host "   3. Check dashboard: $API_URL/dashboard" -ForegroundColor White
Write-Host "   4. Look for the test event sent by this script" -ForegroundColor White
Write-Host ""
