# Adobe Usage Monitor - Uninstall Script
# Removes the Adobe Usage Monitor from the system

<#
.SYNOPSIS
    Uninstalls Adobe Usage Monitor.

.DESCRIPTION
    This script removes the Adobe Usage Monitor scheduled task, configuration,
    and optionally the monitor directory and logs.

.PARAMETER RemoveData
    If specified, removes all monitor data including logs and client ID.
    Otherwise, only removes the scheduled task and registry configuration.

.PARAMETER Silent
    If specified, runs without prompts (auto-removes data if -RemoveData is set).

.EXAMPLE
    .\Uninstall-AdobeMonitor.ps1
    Uninstalls and prompts about data removal.

.EXAMPLE
    .\Uninstall-AdobeMonitor.ps1 -RemoveData -Silent
    Uninstalls and removes all data without prompts.

.NOTES
    Exit Codes:
    0 = Success
    1 = Uninstallation failed
    2 = Nothing to uninstall
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$RemoveData,
    
    [Parameter()]
    [switch]$Silent
)

# Configuration
$TaskName = "AdobeUsageMonitor"
$RegistryPath = "HKCU:\Software\AdobeMonitor"
$MonitorDir = Join-Path $env:LOCALAPPDATA "AdobeMonitor"
$SystemMonitorDir = Join-Path $env:ProgramData "AdobeMonitor"

#region Helper Functions

function Write-UninstallLog {
    param([string]$Message, [string]$Level = "INFO")
    
    if (-not $Silent) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $logMessage = "[$timestamp] [$Level] $Message"
        
        switch ($Level) {
            "ERROR" { Write-Host $logMessage -ForegroundColor Red }
            "WARN"  { Write-Host $logMessage -ForegroundColor Yellow }
            "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
            default { Write-Host $logMessage -ForegroundColor Cyan }
        }
    }
}

function Stop-MonitorProcess {
    # Find and stop any running monitor processes
    $processes = Get-Process -Name "powershell" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*Monitor-AdobeUsage.ps1*"
    }
    
    if ($processes) {
        Write-UninstallLog "Stopping running monitor processes..." "INFO"
        $processes | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Write-UninstallLog "Monitor processes stopped" "SUCCESS"
    }
}

#endregion

#region Main Uninstallation

Write-UninstallLog "========================================" "INFO"
Write-UninstallLog "Adobe Usage Monitor - Uninstall" "INFO"
Write-UninstallLog "========================================" "INFO"
Write-UninstallLog ""

$foundItems = $false

try {
    # Stop running monitor processes
    Stop-MonitorProcess
    
    # Remove scheduled task
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-UninstallLog "Removing scheduled task: $TaskName" "INFO"
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-UninstallLog "Scheduled task removed" "SUCCESS"
        $foundItems = $true
    }
    else {
        Write-UninstallLog "No scheduled task found" "WARN"
    }
    
    # Remove registry configuration
    if (Test-Path $RegistryPath) {
        Write-UninstallLog "Removing registry configuration" "INFO"
        Remove-Item -Path $RegistryPath -Recurse -Force
        Write-UninstallLog "Registry configuration removed" "SUCCESS"
        $foundItems = $true
    }
    else {
        Write-UninstallLog "No registry configuration found" "WARN"
    }
    
    # Handle data directory
    $shouldRemoveData = $RemoveData
    
    if (-not $Silent -and -not $RemoveData) {
        if ((Test-Path $MonitorDir) -or (Test-Path $SystemMonitorDir)) {
            Write-UninstallLog ""
            $response = Read-Host "Remove monitor directory and logs? (Y/N)"
            $shouldRemoveData = ($response -eq 'Y' -or $response -eq 'y')
        }
    }
    
    if ($shouldRemoveData) {
        # Remove user-level monitor directory
        if (Test-Path $MonitorDir) {
            Write-UninstallLog "Removing monitor directory: $MonitorDir" "INFO"
            Remove-Item -Path $MonitorDir -Recurse -Force
            Write-UninstallLog "Monitor directory removed" "SUCCESS"
            $foundItems = $true
        }
        
        # Remove system-level monitor directory (if exists)
        if (Test-Path $SystemMonitorDir) {
            Write-UninstallLog "Removing system monitor directory: $SystemMonitorDir" "INFO"
            Remove-Item -Path $SystemMonitorDir -Recurse -Force
            Write-UninstallLog "System monitor directory removed" "SUCCESS"
            $foundItems = $true
        }
    }
    else {
        if (Test-Path $MonitorDir) {
            Write-UninstallLog "Monitor directory preserved: $MonitorDir" "INFO"
        }
    }
    
    Write-UninstallLog ""
    
    if ($foundItems) {
        Write-UninstallLog "========================================" "SUCCESS"
        Write-UninstallLog "Uninstallation completed successfully!" "SUCCESS"
        Write-UninstallLog "========================================" "SUCCESS"
        exit 0
    }
    else {
        Write-UninstallLog "========================================" "WARN"
        Write-UninstallLog "Nothing to uninstall" "WARN"
        Write-UninstallLog "========================================" "WARN"
        exit 2
    }
}
catch {
    Write-UninstallLog "Uninstallation failed: $_" "ERROR"
    Write-UninstallLog $_.ScriptStackTrace "ERROR"
    exit 1
}

#endregion

