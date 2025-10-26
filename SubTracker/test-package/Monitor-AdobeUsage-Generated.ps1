# Adobe Usage Monitor - Auto-configured for your SubTracker account
# Generated: 2025-10-26T20:03:50.974Z
# Environment: TESTING

# ============================================
# Configuration (DO NOT MODIFY)
# ============================================

$API_KEY = "test-api-key-12345"
$API_URL = "http://localhost:3000/api/track"
$CHECK_INTERVAL = 5  # Check every 5 seconds (TESTING MODE)

# ============================================
# Adobe Process Monitoring
# ============================================

# Only track actual creative applications (not background services)
$ADOBE_PROCESSES = @(
    "Acrobat.exe",
    "AcroRd32.exe",
    "Illustrator.exe",
    "Photoshop.exe",
    "InDesign.exe",
    "AfterFX.exe",
    "Premiere Pro.exe"
)

function Send-UsageData {
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Data
    )
    
    try {
        $headers = @{
            "X-API-Key" = $API_KEY
            "Content-Type" = "application/json"
        }
        
        $json = $Data | ConvertTo-Json -Compress
        
        $response = Invoke-RestMethod -Uri $API_URL `
            -Method POST `
            -Headers $headers `
            -Body $json `
            -ErrorAction Stop
        
        Write-Host "✓ Usage data sent successfully" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "✗ Failed to send usage data: $_" -ForegroundColor Red
        return $false
    }
}

# Add Windows API calls for detecting foreground window (only once)
if (-not ([System.Management.Automation.PSTypeName]'Window').Type) {
    Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Window {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();

            [DllImport("user32.dll")]
            public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

            [DllImport("user32.dll", CharSet = CharSet.Unicode)]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
        }
"@ -ErrorAction SilentlyContinue
}

function Get-ActiveWindowProcess {
    # Get the currently active/foreground window
    try {
        $hwnd = [Window]::GetForegroundWindow()
        $processId = 0
        [Window]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null

        if ($processId -gt 0) {
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            return $process
        }
    }
    catch {
        # Silently handle any errors
    }

    return $null
}

function Get-RunningAdobeProcesses {
    $runningProcesses = @()
    $activeProcess = Get-ActiveWindowProcess

    foreach ($processName in $ADOBE_PROCESSES) {
        $processes = Get-Process -Name $processName.Replace(".exe", "") -ErrorAction SilentlyContinue

        if ($processes) {
            # Check if any of these processes is the active window
            $isActive = $false
            foreach ($proc in $processes) {
                if ($activeProcess -and $proc.Id -eq $activeProcess.Id) {
                    $isActive = $true
                    break
                }
            }

            # Only include if it's the active window
            if ($isActive) {
                $runningProcesses += @{
                    name = $processName
                    count = ($processes | Measure-Object).Count
                    isActive = $true
                }
            }
        }
    }

    return $runningProcesses
}

function Monitor-AdobeUsage {
    Write-Host "Starting Adobe Usage Monitor..." -ForegroundColor Cyan
    Write-Host "API URL: $API_URL" -ForegroundColor Gray
    Write-Host "Check Interval: $CHECK_INTERVAL seconds" -ForegroundColor Gray
    Write-Host "Tracking Mode: Active window only (ignores background processes)" -ForegroundColor Gray
    Write-Host ""

    $lastReportedProcesses = @{}
    
    while ($true) {
        $currentTime = Get-Date
        $runningProcesses = Get-RunningAdobeProcesses
        
        foreach ($process in $runningProcesses) {
            $processName = $process.name
            
            # Check if this is a new process or hasn't been reported recently
            if (-not $lastReportedProcesses.ContainsKey($processName) -or 
                ($currentTime - $lastReportedProcesses[$processName]).TotalSeconds -gt $CHECK_INTERVAL) {
                
                $usageData = @{
                    event = "adobe_desktop_usage"
                    url = $processName
                    clientId = [System.Guid]::NewGuid().ToString()
                    windowsUser = $env:USERNAME
                    userDomain = $env:USERDOMAIN
                    computerName = $env:COMPUTERNAME
                    why = "process_monitor"
                    when = (Get-Date).ToUniversalTime().ToString("o")
                }
                
                if (Send-UsageData -Data $usageData) {
                    $lastReportedProcesses[$processName] = $currentTime
                    Write-Host "Reported: $processName (User: $env:USERNAME, Computer: $env:COMPUTERNAME)" -ForegroundColor Yellow
                }
            }
        }
        
        # Clean up old entries
        $keysToRemove = @()
        foreach ($key in $lastReportedProcesses.Keys) {
            if (($currentTime - $lastReportedProcesses[$key]).TotalSeconds -gt ($CHECK_INTERVAL * 2)) {
                $keysToRemove += $key
            }
        }
        
        foreach ($key in $keysToRemove) {
            $lastReportedProcesses.Remove($key)
        }
        
        Start-Sleep -Seconds $CHECK_INTERVAL
    }
}

# ============================================
# Main Execution
# ============================================

try {
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "  Adobe Usage Monitor - SubTracker" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Test API connection
    Write-Host "Testing API connection..." -ForegroundColor Yellow
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
    
    if (Send-UsageData -Data $testData) {
        Write-Host "✓ API connection successful!" -ForegroundColor Green
        Write-Host ""
        Monitor-AdobeUsage
    }
    else {
        Write-Host "✗ Failed to connect to API. Please check:" -ForegroundColor Red
        Write-Host "  1. Internet connection" -ForegroundColor Yellow
        Write-Host "  2. API URL: $API_URL" -ForegroundColor Yellow
        Write-Host "  3. API Key is valid" -ForegroundColor Yellow
        exit 1
    }
}
catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    Write-Host "Monitor stopped. Please contact support." -ForegroundColor Yellow
    exit 1
}
