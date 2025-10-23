# Adobe Usage Monitor - Intune Deployment Script
# This script is designed to be deployed via Microsoft Intune as a Win32 app or PowerShell script

<#
.SYNOPSIS
    Deploys Adobe Usage Monitor for Intune-managed devices.

.DESCRIPTION
    This script installs the Adobe Usage Monitor on user devices via Intune.
    It copies the monitor script to a system location and configures it to run at logon.

.PARAMETER ApiEndpoint
    The API endpoint URL where usage data will be sent.
    Default: http://localhost:8080/usage/wrapper

.PARAMETER CheckInterval
    Seconds between process checks. Default: 10

.PARAMETER SystemWide
    If specified, installs for all users (requires admin rights).
    Otherwise, installs for current user only.

.EXAMPLE
    .\Deploy-AdobeMonitor.ps1 -ApiEndpoint "https://api.company.com/usage/wrapper"
    Deploys with custom API endpoint.

.EXAMPLE
    .\Deploy-AdobeMonitor.ps1 -SystemWide
    Deploys for all users (admin required).

.NOTES
    Exit Codes:
    0 = Success
    1 = Installation failed
    2 = Prerequisites not met
    3 = Already installed (use for Intune detection)
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ApiEndpoint = "http://localhost:8080/usage/wrapper",
    
    [Parameter()]
    [int]$CheckInterval = 10,
    
    [Parameter()]
    [switch]$SystemWide
)

# Configuration
$ScriptName = "Monitor-AdobeUsage.ps1"
$TaskName = "AdobeUsageMonitor"

# Determine installation path
if ($SystemWide) {
    $InstallPath = Join-Path $env:ProgramData "AdobeMonitor"
    $RequireAdmin = $true
}
else {
    $InstallPath = Join-Path $env:LOCALAPPDATA "AdobeMonitor"
    $RequireAdmin = $false
}

$MonitorScriptPath = Join-Path $InstallPath $ScriptName

#region Helper Functions

function Write-DeployLog {
    param([string]$Message, [string]$Level = "INFO")
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    switch ($Level) {
        "ERROR" { Write-Host $logMessage -ForegroundColor Red }
        "WARN"  { Write-Host $logMessage -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
        default { Write-Host $logMessage -ForegroundColor Cyan }
    }
}

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-MonitorInstalled {
    # Check if scheduled task exists
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        return $true
    }
    
    # Check if monitor script exists
    if (Test-Path $MonitorScriptPath) {
        return $true
    }
    
    return $false
}

#endregion

#region Main Deployment

Write-DeployLog "========================================" "INFO"
Write-DeployLog "Adobe Usage Monitor - Intune Deployment" "INFO"
Write-DeployLog "========================================" "INFO"
Write-DeployLog ""

# Check admin requirements
if ($RequireAdmin -and -not (Test-Administrator)) {
    Write-DeployLog "System-wide installation requires administrator privileges" "ERROR"
    Write-DeployLog "Run this script as administrator or remove -SystemWide parameter" "ERROR"
    exit 2
}

# Check if already installed
if (Test-MonitorInstalled) {
    Write-DeployLog "Adobe Usage Monitor is already installed" "WARN"
    Write-DeployLog "Task Name: $TaskName" "INFO"
    Write-DeployLog "Script Path: $MonitorScriptPath" "INFO"
    
    # For Intune, you might want to return success (0) or detection code (3)
    # Returning 0 for idempotency
    exit 0
}

try {
    # Create installation directory
    Write-DeployLog "Creating installation directory: $InstallPath" "INFO"
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }
    
    # Copy monitor script to installation location
    Write-DeployLog "Copying monitor script..." "INFO"
    $sourceScript = Join-Path $PSScriptRoot $ScriptName
    
    if (-not (Test-Path $sourceScript)) {
        Write-DeployLog "Monitor script not found: $sourceScript" "ERROR"
        Write-DeployLog "Ensure $ScriptName is in the same directory as this deployment script" "ERROR"
        exit 1
    }
    
    Copy-Item -Path $sourceScript -Destination $MonitorScriptPath -Force
    Write-DeployLog "Monitor script copied to: $MonitorScriptPath" "SUCCESS"
    
    # Run installation
    Write-DeployLog "Running monitor installation..." "INFO"
    Write-DeployLog "API Endpoint: $ApiEndpoint" "INFO"
    Write-DeployLog "Check Interval: $CheckInterval seconds" "INFO"
    
    $installArgs = @(
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$MonitorScriptPath`"",
        "-Install",
        "-ApiEndpoint", "`"$ApiEndpoint`"",
        "-CheckInterval", $CheckInterval
    )
    
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $installArgs -Wait -PassThru -NoNewWindow
    
    if ($process.ExitCode -eq 0) {
        Write-DeployLog "" 
        Write-DeployLog "========================================" "SUCCESS"
        Write-DeployLog "Deployment completed successfully!" "SUCCESS"
        Write-DeployLog "========================================" "SUCCESS"
        Write-DeployLog ""
        Write-DeployLog "Monitor is now running and will auto-start at logon" "INFO"
        Write-DeployLog "Log file: $InstallPath\monitor.log" "INFO"
        Write-DeployLog ""
        
        exit 0
    }
    else {
        Write-DeployLog "Installation failed with exit code: $($process.ExitCode)" "ERROR"
        exit 1
    }
}
catch {
    Write-DeployLog "Deployment failed: $_" "ERROR"
    Write-DeployLog $_.ScriptStackTrace "ERROR"
    exit 1
}

#endregion

