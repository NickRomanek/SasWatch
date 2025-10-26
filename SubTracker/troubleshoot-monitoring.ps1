# Troubleshooting Script for Adobe Usage Monitoring
# Run this in PowerShell as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Adobe Usage Monitor Troubleshooting" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
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
$scriptPath = "C:\ProgramData\AdobeMonitor\Monitor-AdobeUsage.ps1"
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
    $healthCheck = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method GET -TimeoutSec 5
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
        "X-API-Key" = "dca3ea2d-0953-4aa6-b39a-0b3facfff360"
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

    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/track" `
        -Method POST `
        -Headers $headers `
        -Body $testData `
        -TimeoutSec 5

    Write-Host "  [OK] Test event sent successfully!" -ForegroundColor Green
    Write-Host "    Response: $($response | ConvertTo-Json)" -ForegroundColor Cyan
    Write-Host "    Check your dashboard at: http://localhost:3000/dashboard" -ForegroundColor Yellow
} catch {
    Write-Host "  [ERROR] Failed to send test event" -ForegroundColor Red
    Write-Host "    Error: $_" -ForegroundColor Red
}

# 8. Check recent events in database
Write-Host "`n[8/8] Checking recent events in database..." -ForegroundColor Yellow
try {
    $recentEvents = Invoke-RestMethod -Uri "http://localhost:3000/api/usage/recent?limit=5" -Method GET

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
Write-Host "   3. Check dashboard: http://localhost:3000/dashboard" -ForegroundColor White
Write-Host "   4. Look for the test event sent by this script" -ForegroundColor White
Write-Host ""
