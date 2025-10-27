# Real-time Monitor Log Viewer
# This script shows the monitoring activity in real-time

$LOG_FILE = "C:\ProgramData\AdobeMonitor\monitor.log"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Adobe Monitor - Real-time Log Viewer" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $LOG_FILE) {
    Write-Host "Monitoring log file: $LOG_FILE" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
    Write-Host ""
    
    # Show existing log content
    Write-Host "Existing log content:" -ForegroundColor Gray
    Get-Content $LOG_FILE -Tail 20 | ForEach-Object { Write-Host $_ }
    Write-Host ""
    
    # Monitor for new log entries
    Write-Host "Waiting for new log entries..." -ForegroundColor Yellow
    Get-Content $LOG_FILE -Wait -Tail 0 | ForEach-Object { 
        $timestamp = Get-Date -Format "HH:mm:ss"
        Write-Host "[$timestamp] $_" -ForegroundColor White
    }
} else {
    Write-Host "Log file not found: $LOG_FILE" -ForegroundColor Red
    Write-Host "The monitoring script may not be running yet." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To start monitoring:" -ForegroundColor Cyan
    Write-Host "1. Download a fresh testing package" -ForegroundColor White
    Write-Host "2. Run the installer" -ForegroundColor White
    Write-Host "3. Run this script again" -ForegroundColor White
}
