# ============================================
# Adobe Usage Monitor - Intune Installer
# ============================================
# This script installs the Adobe Usage Monitor as a Windows Scheduled Task
# that runs continuously at system startup.
#
# Usage: PowerShell.exe -ExecutionPolicy Bypass -File Install-AdobeMonitor.ps1
# Run as: SYSTEM (Intune handles this automatically)
# ============================================

$ErrorActionPreference = "Stop"

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (-not $isAdmin) {
    Write-Warning "This script should be run as Administrator for best results."
    Write-Warning "Some operations may fail due to insufficient permissions."
    Write-Warning "To run as Administrator: Right-click PowerShell and select 'Run as Administrator'"
    Write-Warning ""
}

# Configuration
$INSTALL_DIR = "C:\ProgramData\AdobeMonitor"
$SCRIPT_NAME = "Monitor-AdobeUsage.ps1"
$TASK_NAME = "Adobe Usage Monitor - SubTracker"
$RUN_KEY_NAME = "AdobeUsageMonitor"
$LAUNCHER_NAME = "MonitorLauncher.vbs"
$LOG_FILE = "$INSTALL_DIR\install.log"
$STATUS_FILE = "$INSTALL_DIR\status.json"

# Logging function
function Write-Log {
    param($Message, $Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"

    # Always output to console
    Write-Output $logMessage

    # Try to write to log file, but don't fail if we can't
    try {
        # Create log directory if needed
        $logDir = Split-Path $LOG_FILE -Parent
        if (-not (Test-Path $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        Add-Content -Path $LOG_FILE -Value $logMessage -ErrorAction SilentlyContinue
    }
    catch {
        # Silently continue if we can't write to log file
        # This prevents the script from failing due to permission issues
    }
}

try {
    Write-Log "========================================" "INFO"
    Write-Log "Adobe Usage Monitor Installation Started" "INFO"
    Write-Log "========================================" "INFO"

    # Step 1: Get script location and check for generated script
    $scriptLocation = $PSScriptRoot
    $sourceScript = Join-Path $scriptLocation $SCRIPT_NAME

    Write-Log "Script location: $scriptLocation" "INFO"
    Write-Log "Source script: $sourceScript" "INFO"

    # Check if we have a generated script with API configuration
    $generatedScript = Join-Path $scriptLocation "Monitor-AdobeUsage-Generated.ps1"
    if (Test-Path $generatedScript) {
        $sourceScript = $generatedScript
        Write-Log "Using generated script with API configuration: $sourceScript" "INFO"
    } else {
        Write-Log "Generated script not found, using default: $sourceScript" "WARN"
    }

    # Verify source script exists
    if (-not (Test-Path $sourceScript)) {
        throw "Monitoring script not found at: $sourceScript"
    }
    Write-Log "Source script verified" "SUCCESS"

    # Step 2: Create installation directory
    Write-Log "Creating installation directory: $INSTALL_DIR" "INFO"
    if (-not (Test-Path $INSTALL_DIR)) {
        New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
        Write-Log "Directory created successfully" "SUCCESS"
    } else {
        Write-Log "Directory already exists" "INFO"
    }

    # Step 3: Copy monitoring script to installation directory
    $targetScript = Join-Path $INSTALL_DIR $SCRIPT_NAME
    Write-Log "Copying script to: $targetScript" "INFO"
    Copy-Item -Path $sourceScript -Destination $targetScript -Force
    Write-Log "Script copied successfully" "SUCCESS"

    # Step 4: Ensure directory permissions for standard users
    try {
        Write-Log "Setting directory permissions for Users group" "INFO"
        $acl = Get-Acl -Path $INSTALL_DIR
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Users","Modify","ContainerInherit, ObjectInherit","None","Allow")
        $acl.SetAccessRule($rule)
        Set-Acl -Path $INSTALL_DIR -AclObject $acl
        Write-Log "Directory permissions updated" "SUCCESS"
    } catch {
        Write-Log "Could not update directory permissions: $_" "WARN"
    }

    # Step 5: Create launcher script for user sessions
    $launcherPath = Join-Path $INSTALL_DIR $LAUNCHER_NAME
    Write-Log "Creating launcher script: $launcherPath" "INFO"

    $launcherContent = @"
Set objShell = CreateObject("Wscript.Shell")
objShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$targetScript""", 0, False
"@

    Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII
    Write-Log "Launcher script created" "SUCCESS"

    # Step 6: Configure Run key for all users
    $runKeyPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
    $launchCommand = "wscript.exe `"$launcherPath`""
    Write-Log "Registering startup entry in Run key" "INFO"
    Set-ItemProperty -Path $runKeyPath -Name $RUN_KEY_NAME -Value $launchCommand -Force
    Write-Log "Startup entry registered" "SUCCESS"

    # Step 7: Launch monitor for current session (if applicable)
    try {
        Write-Log "Launching monitor for current user session" "INFO"
        Start-Process -FilePath "wscript.exe" -ArgumentList "`"$launcherPath`"" -WindowStyle Hidden
        Write-Log "Monitor launched for current session" "SUCCESS"
    } catch {
        Write-Log "Could not launch monitor for current session: $_" "WARN"
    }

    # Step 8: Test API connectivity
    Write-Log "Testing API connectivity..." "INFO"
    try {
        # Read the API URL from the monitoring script to ensure consistency
        $monitoringScriptPath = Join-Path $INSTALL_DIR $SCRIPT_NAME
        if (Test-Path $monitoringScriptPath) {
            $scriptContent = Get-Content $monitoringScriptPath -Raw
            if ($scriptContent -match '\$API_URL = "([^"]+)"') {
                $apiUrl = $matches[1]
                Write-Log "Using API URL from monitoring script: $apiUrl" "INFO"
            } else {
                $apiUrl = "http://localhost:3000/api/track"  # Default fallback
                Write-Log "Could not detect API URL, using default: $apiUrl" "WARN"
            }
        } else {
            $apiUrl = "http://localhost:3000/api/track"  # Default fallback
            Write-Log "Monitoring script not found, using default: $apiUrl" "WARN"
        }

        # Get API key from monitoring script
        $apiKey = "test-api-key-12345"  # Default fallback
        if (Test-Path $monitoringScriptPath) {
            $scriptContent = Get-Content $monitoringScriptPath -Raw
            if ($scriptContent -match '\$API_KEY = "([^"]+)"') {
                $apiKey = $matches[1]
                Write-Log "Using API key from monitoring script" "INFO"
            } else {
                Write-Log "Could not detect API key, using default" "WARN"
            }
        }

        # Create a test script to check API connectivity
        $testScript = @"
# Test API connectivity
`$API_URL = "$apiUrl"
`$API_KEY = "$apiKey"
`$testData = @{
    event = "install_test"
    url = "system"
    clientId = [System.Guid]::NewGuid().ToString()
    windowsUser = "`$env:USERNAME"
    userDomain = "`$env:USERDOMAIN"
    computerName = "`$env:COMPUTERNAME"
    why = "installation_test"
    when = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Compress

try {
    `$headers = @{
        "Content-Type" = "application/json"
        "X-API-Key" = `$API_KEY
    }
    `$response = Invoke-RestMethod -Uri `$API_URL -Method POST -Body `$testData -Headers `$headers -TimeoutSec 10
    Write-Output "API_TEST_SUCCESS"
} catch {
    Write-Output "API_TEST_FAILED: `$_"
}
"@
        
        $testScriptPath = Join-Path $INSTALL_DIR "api-test.ps1"
        Set-Content -Path $testScriptPath -Value $testScript
        
        $apiTestResult = & powershell.exe -ExecutionPolicy Bypass -File $testScriptPath
        Remove-Item $testScriptPath -Force -ErrorAction SilentlyContinue
        
        if ($apiTestResult -like "API_TEST_SUCCESS*") {
            Write-Log "API connectivity test PASSED" "SUCCESS"
        } else {
            Write-Log "API connectivity test FAILED: $apiTestResult" "WARN"
        }
    } catch {
        Write-Log "Could not test API connectivity: $_" "WARN"
    }

    # Step 8: Create status file for troubleshooting
    $statusInfo = @{
        installed = $true
        installTime = (Get-Date).ToUniversalTime().ToString("o")
        runKeyName = $RUN_KEY_NAME
        runKeyPath = $runKeyPath
        launcherPath = $launcherPath
        scriptPath = $targetScript
        installDir = $INSTALL_DIR
        logFile = $LOG_FILE
        apiTestResult = if ($apiTestResult) { $apiTestResult } else { "Not tested" }
        systemInfo = @{
            computerName = $env:COMPUTERNAME
            username = $env:USERNAME
            userDomain = $env:USERDOMAIN
            osVersion = [System.Environment]::OSVersion.VersionString
        }
    } | ConvertTo-Json -Depth 3

    Set-Content -Path $STATUS_FILE -Value $statusInfo
    Write-Log "Status file created: $STATUS_FILE" "INFO"

    Write-Log "========================================" "INFO"
    Write-Log "Installation completed successfully!" "SUCCESS"
    Write-Log "Monitoring script: $targetScript" "INFO"
    Write-Log "Launcher script: $launcherPath" "INFO"
    Write-Log "Run key entry: HKLM\\...\\$RUN_KEY_NAME" "INFO"
    Write-Log "Status file: $STATUS_FILE" "INFO"
    Write-Log "Log file: $LOG_FILE" "INFO"
    Write-Log "========================================" "INFO"
    Write-Log "TROUBLESHOOTING INFO:" "INFO"
    Write-Log "- Check status file: $STATUS_FILE" "INFO"
    Write-Log "- Check log file: $LOG_FILE" "INFO"
    Write-Log "- API test result: $apiTestResult" "INFO"
    Write-Log "========================================" "INFO"

    exit 0

} catch {
    Write-Log "========================================" "ERROR"
    Write-Log "Installation FAILED!" "ERROR"
    Write-Log "Error: $_" "ERROR"
    Write-Log "========================================" "ERROR"
    exit 1
}
