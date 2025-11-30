# Simple Adobe Monitoring Test Script
# Uses environment variables for secure API key storage

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adobe Usage Monitor - Manual Test" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Secure API Key and URL Detection
# ============================================
$API_KEY = $null
$API_URL = $null

# Try environment variables (most secure)
if ($env:SASWATCH_API_KEY) {
    $API_KEY = $env:SASWATCH_API_KEY
} elseif ($env:API_KEY) {
    $API_KEY = $env:API_KEY
}

if ($env:SASWATCH_API_URL) {
    $API_URL = $env:SASWATCH_API_URL
} elseif ($env:API_URL) {
    $API_URL = $env:API_URL
}

# Validate required configuration
if (-not $API_KEY) {
    Write-Host "✗ ERROR: API key not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please set one of the following environment variables:" -ForegroundColor Yellow
    Write-Host "  `$env:SASWATCH_API_KEY = 'your-api-key-here'" -ForegroundColor White
    Write-Host "  OR" -ForegroundColor Gray
    Write-Host "  `$env:API_KEY = 'your-api-key-here'" -ForegroundColor White
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Cyan
    Write-Host "  `$env:SASWATCH_API_KEY = 'your-api-key-here'" -ForegroundColor Gray
    Write-Host "  `$env:SASWATCH_API_URL = 'https://abowdy-production.up.railway.app'  # Optional" -ForegroundColor Gray
    exit 1
}

# Default API URL if not provided
if (-not $API_URL) {
    $API_URL = "https://abowdy-production.up.railway.app"
}

# Ensure API URL doesn't have /api/track suffix
$API_URL = $API_URL -replace '/api/track.*$', ''

Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  API URL: $API_URL" -ForegroundColor Gray
Write-Host "  API Key: $($API_KEY.Substring(0, [Math]::Min(8, $API_KEY.Length)))..." -ForegroundColor Gray
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
        $trackUrl = "$API_URL/api/track"
        $response = Invoke-RestMethod -Uri $trackUrl -Method POST -Headers $headers -Body $json -TimeoutSec 10
        
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