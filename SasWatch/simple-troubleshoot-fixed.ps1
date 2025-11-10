# Simple Troubleshooting Script
Write-Host "Adobe Usage Monitor - Troubleshooting" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Check installation directory
$INSTALL_DIR = "C:\ProgramData\AdobeMonitor"
if (Test-Path $INSTALL_DIR) {
    Write-Host "Installation directory exists: $INSTALL_DIR" -ForegroundColor Green
    Get-ChildItem $INSTALL_DIR | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
} else {
    Write-Host "Installation directory missing" -ForegroundColor Red
}

# Check scheduled task
$TASK_NAME = "Adobe Usage Monitor - SubTracker"
$task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Scheduled task exists: $TASK_NAME" -ForegroundColor Green
    Write-Host "  State: $($task.State)" -ForegroundColor White
} else {
    Write-Host "Scheduled task not found: $TASK_NAME" -ForegroundColor Red
}

# Test API connectivity
Write-Host ""
Write-Host "Testing API connectivity..." -ForegroundColor Yellow
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

    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/track" -Method POST -Body $testData -ContentType "application/json" -TimeoutSec 10
    Write-Host "API connectivity test PASSED" -ForegroundColor Green
} catch {
    Write-Host "API connectivity test FAILED: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "Troubleshooting complete!" -ForegroundColor Cyan
