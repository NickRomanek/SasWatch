# Simple Log Watcher - Run from anywhere
$LOG_FILE = "C:\ProgramData\AdobeMonitor\monitor.log"

if (Test-Path $LOG_FILE) {
    Write-Host "Adobe Monitor Log Viewer" -ForegroundColor Cyan
    Write-Host "Log file: $LOG_FILE" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
    Write-Host ""
    
    # Show recent entries
    Get-Content $LOG_FILE -Tail 10 | ForEach-Object { Write-Host $_ }
    Write-Host ""
    Write-Host "Waiting for new entries..." -ForegroundColor Yellow
    
    # Watch for new entries
    Get-Content $LOG_FILE -Wait -Tail 0
} else {
    Write-Host "Log file not found: $LOG_FILE" -ForegroundColor Red
    Write-Host "Run the installer first to create the monitoring script." -ForegroundColor Yellow
}
