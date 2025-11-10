# SasWatch & Receiver Stop Script
# Stops both servers

Write-Host "========================================" -ForegroundColor Red
Write-Host "  Stopping SasWatch & Receiver" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""

# Function to kill process on a specific port
function Stop-ProcessOnPort {
    param([int]$Port, [string]$Name)
    
    Write-Host "Stopping $Name on port $Port..." -ForegroundColor Yellow
    
    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($connections) {
            $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
            $stopped = $false
            foreach ($processId in $pids) {
                if ($processId -gt 0) {
                    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                    if ($process) {
                        Write-Host "  Stopping: $($process.Name) (PID: $processId)" -ForegroundColor Red
                        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                        $stopped = $true
                    }
                }
            }
            if ($stopped) {
                Start-Sleep -Milliseconds 500
                Write-Host "  $Name stopped!" -ForegroundColor Green
            } else {
                Write-Host "  No process found on port $Port" -ForegroundColor Gray
            }
        } else {
            Write-Host "  No process running on port $Port" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  No process running on port $Port" -ForegroundColor Gray
    }
}

# Stop both servers
Stop-ProcessOnPort -Port 8080 -Name "Receiver"
Stop-ProcessOnPort -Port 3000 -Name "SasWatch"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All servers stopped!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

