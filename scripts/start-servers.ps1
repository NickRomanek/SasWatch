# SasWatch & Receiver Startup Script
# Kills existing processes and starts both servers

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SasWatch & Receiver Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to kill process on a specific port
function Stop-ProcessOnPort {
    param([int]$Port, [string]$Name)
    
    Write-Host "Checking port $Port ($Name)..." -ForegroundColor Yellow
    
    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($connections) {
            $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($processId in $pids) {
                if ($processId -gt 0) {
                    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                    if ($process) {
                        Write-Host "  Stopping process: $($process.Name) (PID: $processId)" -ForegroundColor Red
                        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                    }
                }
            }
            Start-Sleep -Milliseconds 500
            Write-Host "  Port $Port cleared!" -ForegroundColor Green
        } else {
            Write-Host "  Port $Port is free" -ForegroundColor Green
        }
    } catch {
        Write-Host "  Port $Port is free" -ForegroundColor Green
    }
}

# Stop existing processes
Stop-ProcessOnPort -Port 8080 -Name "Receiver"
Stop-ProcessOnPort -Port 3000 -Name "SasWatch"

Write-Host ""
Write-Host "Starting servers..." -ForegroundColor Cyan
Write-Host ""

# Get root directory (parent of scripts folder)
$rootDir = Split-Path $PSScriptRoot -Parent

# Resolve service paths
$receiverPath = Join-Path $rootDir "receiver"
$saswatchPath = Join-Path $rootDir "SasWatch"

# Start Receiver in new window (if present)
if (Test-Path $receiverPath) {
    Write-Host "Starting Receiver on port 8080..." -ForegroundColor Yellow
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$receiverPath'; Write-Host '=== RECEIVER SERVER ===' -ForegroundColor Green; node server.js"
    Start-Sleep -Seconds 2
} else {
    Write-Host "Receiver directory not found. Skipping Receiver server start." -ForegroundColor DarkYellow
}

# Start SasWatch in new window
if (Test-Path $saswatchPath) {
    Write-Host "Starting SasWatch on port 3000..." -ForegroundColor Yellow
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$saswatchPath'; Write-Host '=== SUBTRACKER SERVER ===' -ForegroundColor Cyan; node server.js"
    Start-Sleep -Seconds 2
} else {
    Write-Host "❌ SasWatch directory not found at '$saswatchPath'. Cannot start SasWatch server." -ForegroundColor Red
    Write-Host "Please verify the project structure and try again." -ForegroundColor Red
}


Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Servers Started!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Receiver:    http://localhost:8080" -ForegroundColor Yellow
Write-Host "SasWatch:  http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Opening SasWatch in browser..." -ForegroundColor Cyan
Start-Sleep -Seconds 2
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "Press any key to exit this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

