# Adobe Usage Monitor - PowerShell Script
# Monitors Adobe desktop application usage and reports to tracking API
# Deployable via Intune as a logon script

<#
.SYNOPSIS
    Monitors Adobe desktop application usage and reports to tracking API.

.DESCRIPTION
    This script continuously monitors for Adobe application processes and sends
    usage data to a configurable API endpoint. Designed for Intune deployment.

.PARAMETER Install
    Installs the monitor as a scheduled task that runs at user logon.

.PARAMETER Uninstall
    Removes the scheduled task and cleans up configuration.

.PARAMETER Monitor
    Runs the monitoring loop (default mode).

.PARAMETER ApiEndpoint
    Override the API endpoint URL (default: http://localhost:8080/usage/wrapper).

.PARAMETER CheckInterval
    Seconds between process checks (default: 10).

.EXAMPLE
    .\Monitor-AdobeUsage.ps1 -Install
    Installs the monitor to run at logon.

.EXAMPLE
    .\Monitor-AdobeUsage.ps1 -Monitor
    Runs the monitoring loop manually.

.EXAMPLE
    .\Monitor-AdobeUsage.ps1 -Install -ApiEndpoint "https://api.company.com/usage/wrapper"
    Installs with custom API endpoint.
#>

[CmdletBinding(DefaultParameterSetName='Monitor')]
param(
    [Parameter(ParameterSetName='Install')]
    [switch]$Install,
    
    [Parameter(ParameterSetName='Uninstall')]
    [switch]$Uninstall,
    
    [Parameter(ParameterSetName='Monitor')]
    [switch]$Monitor,
    
    [Parameter()]
    [string]$ApiEndpoint = "http://localhost:8080/usage/wrapper",
    
    [Parameter()]
    [int]$CheckInterval = 10
)

# Configuration
$script:MonitorDir = Join-Path $env:LOCALAPPDATA "AdobeMonitor"
$script:ClientIdFile = Join-Path $script:MonitorDir "client_id.txt"
$script:LogFile = Join-Path $script:MonitorDir "monitor.log"
$script:TaskName = "AdobeUsageMonitor"
$script:RegistryPath = "HKCU:\Software\AdobeMonitor"

# Adobe processes to monitor
$script:AdobeProcesses = @(
    "Acrobat",           # Adobe Acrobat DC
    "AcroRd32",          # Adobe Reader
    "Photoshop",         # Adobe Photoshop
    "Illustrator",       # Adobe Illustrator
    "InDesign",          # Adobe InDesign
    "Premiere Pro",      # Adobe Premiere Pro
    "AfterFX",           # Adobe After Effects
    "Lightroom",         # Adobe Lightroom
    "Adobe XD",          # Adobe XD
    "Animate",           # Adobe Animate
    "Audition",          # Adobe Audition
    "Bridge",            # Adobe Bridge
    "Dreamweaver",       # Adobe Dreamweaver
    "Character Animator", # Adobe Character Animator
    "Prelude",           # Adobe Prelude
    "SpeedGrade",        # Adobe SpeedGrade
    "Encoder",           # Adobe Media Encoder
    "Fuse"               # Adobe Fuse
)

# Tracking state for active processes
$script:ActiveProcesses = @{}

#region Helper Functions

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    try {
        # Ensure directory exists
        if (-not (Test-Path $script:MonitorDir)) {
            New-Item -ItemType Directory -Path $script:MonitorDir -Force | Out-Null
        }
        
        # Write to log file
        Add-Content -Path $script:LogFile -Value $logMessage -ErrorAction SilentlyContinue
        
        # Also write to console if running interactively
        if ($Host.Name -ne "ConsoleHost" -or [Environment]::UserInteractive) {
            switch ($Level) {
                "ERROR" { Write-Host $logMessage -ForegroundColor Red }
                "WARN"  { Write-Host $logMessage -ForegroundColor Yellow }
                "INFO"  { Write-Host $logMessage -ForegroundColor Cyan }
                default { Write-Host $logMessage }
            }
        }
    }
    catch {
        # Silently fail if logging doesn't work
    }
}

function Get-OrCreateClientId {
    try {
        if (Test-Path $script:ClientIdFile) {
            $clientId = Get-Content $script:ClientIdFile -Raw -ErrorAction Stop
            $clientId = $clientId.Trim()
            if ($clientId) {
                return $clientId
            }
        }
        
        # Generate new client ID
        $newClientId = [guid]::NewGuid().ToString()
        
        # Ensure directory exists
        if (-not (Test-Path $script:MonitorDir)) {
            New-Item -ItemType Directory -Path $script:MonitorDir -Force | Out-Null
        }
        
        # Save client ID
        Set-Content -Path $script:ClientIdFile -Value $newClientId -ErrorAction Stop
        Write-Log "Generated new client ID: $newClientId"
        
        return $newClientId
    }
    catch {
        Write-Log "Failed to get/create client ID: $_" -Level "ERROR"
        return "temp_$([guid]::NewGuid().ToString())"
    }
}

function Get-Configuration {
    $config = @{
        ApiEndpoint = $ApiEndpoint
        CheckInterval = $CheckInterval
    }
    
    # Try to read from registry
    try {
        if (Test-Path $script:RegistryPath) {
            $regValues = Get-ItemProperty -Path $script:RegistryPath -ErrorAction SilentlyContinue
            
            if ($regValues.ApiEndpoint) {
                $config.ApiEndpoint = $regValues.ApiEndpoint
            }
            if ($regValues.CheckInterval) {
                $config.CheckInterval = [int]$regValues.CheckInterval
            }
        }
    }
    catch {
        Write-Log "Could not read registry configuration: $_" -Level "WARN"
    }
    
    return $config
}

function Send-UsageData {
    param(
        [string]$ProcessName,
        [string]$ProcessPath,
        [string]$ApiUrl,
        [string]$ClientId
    )
    
    try {
        $payload = @{
            event = "adobe_desktop_usage"
            url = $ProcessName
            tabId = $null
            clientId = $ClientId
            windowsUser = $env:USERNAME
            computerName = $env:COMPUTERNAME
            userDomain = $env:USERDOMAIN
            why = "process_monitor"
            when = (Get-Date).ToUniversalTime().ToString("o")
        } | ConvertTo-Json -Compress
        
        # Fire-and-forget HTTP POST with short timeout
        Invoke-RestMethod -Uri $ApiUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 2 -ErrorAction Stop | Out-Null
        
        Write-Log "Sent usage data for $ProcessName"
        return $true
    }
    catch {
        Write-Log "Failed to send usage data for $ProcessName : $_" -Level "WARN"
        return $false
    }
}

function Start-Monitoring {
    Write-Log "Starting Adobe usage monitoring..."
    
    $config = Get-Configuration
    $clientId = Get-OrCreateClientId
    
    Write-Log "API Endpoint: $($config.ApiEndpoint)"
    Write-Log "Check Interval: $($config.CheckInterval) seconds"
    Write-Log "Client ID: $clientId"
    Write-Log "Monitoring processes: $($script:AdobeProcesses -join ', ')"
    
    # Main monitoring loop
    while ($true) {
        try {
            # Get all running Adobe processes
            $runningProcesses = Get-Process -Name $script:AdobeProcesses -ErrorAction SilentlyContinue
            
            foreach ($process in $runningProcesses) {
                $processKey = "$($process.Name)_$($process.Id)"
                
                # Check if this is a new process we haven't tracked yet
                if (-not $script:ActiveProcesses.ContainsKey($processKey)) {
                    Write-Log "Detected new Adobe process: $($process.Name) (PID: $($process.Id))"
                    
                    # Mark as tracked
                    $script:ActiveProcesses[$processKey] = @{
                        Name = $process.Name
                        Id = $process.Id
                        StartTime = Get-Date
                        Reported = $false
                    }
                    
                    # Send usage data
                    $processPath = try { $process.Path } catch { $process.Name }
                    $sent = Send-UsageData -ProcessName "$($process.Name).exe" -ProcessPath $processPath -ApiUrl $config.ApiEndpoint -ClientId $clientId
                    
                    if ($sent) {
                        $script:ActiveProcesses[$processKey].Reported = $true
                    }
                }
            }
            
            # Clean up tracking for processes that have exited
            $currentProcessIds = $runningProcesses | ForEach-Object { "$($_.Name)_$($_.Id)" }
            $keysToRemove = $script:ActiveProcesses.Keys | Where-Object { $_ -notin $currentProcessIds }
            
            foreach ($key in $keysToRemove) {
                $processInfo = $script:ActiveProcesses[$key]
                Write-Log "Adobe process exited: $($processInfo.Name) (PID: $($processInfo.Id))"
                $script:ActiveProcesses.Remove($key)
            }
        }
        catch {
            Write-Log "Error in monitoring loop: $_" -Level "ERROR"
        }
        
        # Wait before next check
        Start-Sleep -Seconds $config.CheckInterval
    }
}

#endregion

#region Installation Functions

function Install-Monitor {
    Write-Host "Installing Adobe Usage Monitor..." -ForegroundColor Green
    
    try {
        # Create monitor directory
        if (-not (Test-Path $script:MonitorDir)) {
            New-Item -ItemType Directory -Path $script:MonitorDir -Force | Out-Null
            Write-Host "  Created monitor directory: $script:MonitorDir" -ForegroundColor Cyan
        }
        
        # Generate client ID
        $clientId = Get-OrCreateClientId
        Write-Host "  Client ID: $clientId" -ForegroundColor Cyan
        
        # Create registry configuration
        if (-not (Test-Path $script:RegistryPath)) {
            New-Item -Path $script:RegistryPath -Force | Out-Null
        }
        
        Set-ItemProperty -Path $script:RegistryPath -Name "ApiEndpoint" -Value $ApiEndpoint -Type String
        Set-ItemProperty -Path $script:RegistryPath -Name "CheckInterval" -Value $CheckInterval -Type DWord
        Write-Host "  Saved configuration to registry" -ForegroundColor Cyan
        
        # Create scheduled task
        $scriptPath = $MyInvocation.ScriptName
        if (-not $scriptPath) {
            $scriptPath = $PSCommandPath
        }
        
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Monitor"
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
        
        # Remove existing task if present
        $existingTask = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
        if ($existingTask) {
            Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false
            Write-Host "  Removed existing scheduled task" -ForegroundColor Yellow
        }
        
        # Register new task
        Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Monitors Adobe desktop application usage" | Out-Null
        Write-Host "  Created scheduled task: $script:TaskName" -ForegroundColor Cyan
        
        # Start the monitor immediately
        Write-Host "  Starting monitor now..." -ForegroundColor Cyan
        Start-Process -FilePath "powershell.exe" -ArgumentList @(
            "-WindowStyle", "Hidden",
            "-ExecutionPolicy", "Bypass",
            "-File", "`"$scriptPath`"",
            "-Monitor"
        ) -NoNewWindow
        Start-Sleep -Milliseconds 500  # Give it a moment to start
        Write-Host "  Monitor started in background" -ForegroundColor Cyan
        
        Write-Host ""
        Write-Host "Installation complete!" -ForegroundColor Green
        Write-Host "The monitor is now running and will auto-start at logon." -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Log file location: $script:LogFile" -ForegroundColor Gray
        
        return 0
    }
    catch {
        Write-Host "Installation failed: $_" -ForegroundColor Red
        Write-Log "Installation failed: $_" -Level "ERROR"
        return 1
    }
}

function Uninstall-Monitor {
    Write-Host "Uninstalling Adobe Usage Monitor..." -ForegroundColor Yellow
    
    try {
        # Remove scheduled task
        $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
        if ($task) {
            Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false
            Write-Host "  Removed scheduled task" -ForegroundColor Cyan
        }
        else {
            Write-Host "  No scheduled task found" -ForegroundColor Gray
        }
        
        # Remove registry configuration
        if (Test-Path $script:RegistryPath) {
            Remove-Item -Path $script:RegistryPath -Recurse -Force
            Write-Host "  Removed registry configuration" -ForegroundColor Cyan
        }
        
        # Ask about data directory
        Write-Host ""
        $response = Read-Host "Remove monitor directory and logs? (Y/N)"
        if ($response -eq 'Y' -or $response -eq 'y') {
            if (Test-Path $script:MonitorDir) {
                Remove-Item -Path $script:MonitorDir -Recurse -Force
                Write-Host "  Removed monitor directory" -ForegroundColor Cyan
            }
        }
        else {
            Write-Host "  Kept monitor directory: $script:MonitorDir" -ForegroundColor Gray
        }
        
        Write-Host ""
        Write-Host "Uninstallation complete!" -ForegroundColor Green
        
        return 0
    }
    catch {
        Write-Host "Uninstallation failed: $_" -ForegroundColor Red
        return 1
    }
}

#endregion

#region Main Execution

# Determine which mode to run
if ($Install) {
    exit (Install-Monitor)
}
elseif ($Uninstall) {
    exit (Uninstall-Monitor)
}
else {
    # Default: Run monitoring
    Start-Monitoring
}

#endregion

