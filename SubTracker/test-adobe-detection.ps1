# Simple Adobe Monitoring Test Script
$API_KEY = "ecd5a626-18e8-493d-bd7c-185b040c6a57"
$API_URL = "https://abowdy-production.up.railway.app/api/track"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adobe Usage Monitor - Manual Test" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check for Adobe processes
Write-Host "Checking for Adobe processes..." -ForegroundColor Yellow
$adobeProcesses = Get-Process | Where-Object {$_.ProcessName -like "*Adobe*" -or $_.ProcessName -like "*Acrobat*" -or $_.ProcessName -like "*AcroRd*"}

if ($adobeProcesses) {
    Write-Host "✓ Found Adobe processes:" -ForegroundColor Green
    foreach ($proc in $adobeProcesses) {
        Write-Host "  - $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor White
    }
    
    # Send test data
    Write-Host ""
    Write-Host "Sending test usage data..." -ForegroundColor Yellow
    
    $testData = @{
        event = "manual_test"
        url = "test"
        clientId = [System.Guid]::NewGuid().ToString()
        windowsUser = $env:USERNAME
        userDomain = $env:USERDOMAIN
        computerName = $env:COMPUTERNAME
        why = "manual_testing"
        when = (Get-Date).ToUniversalTime().ToString("o")
    }
    
    try {
        $headers = @{
            "X-API-Key" = $API_KEY
            "Content-Type" = "application/json"
        }
        
        $json = $testData | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri $API_URL -Method POST -Headers $headers -Body $json -TimeoutSec 10
        
        Write-Host "✓ Test data sent successfully!" -ForegroundColor Green
        Write-Host "Response: $response" -ForegroundColor Gray
    }
    catch {
        Write-Host "✗ Failed to send test data: $_" -ForegroundColor Red
    }
}
else {
    Write-Host "✗ No Adobe processes found" -ForegroundColor Red
    Write-Host "Please open Adobe Acrobat or another Adobe application and try again." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Test completed!" -ForegroundColor Cyan