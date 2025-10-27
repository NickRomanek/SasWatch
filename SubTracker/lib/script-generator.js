// PowerShell Script Generator
// Generates monitoring scripts with embedded API keys for each account

function generateMonitorScript(apiKey, apiUrl, nodeEnv = 'production') {
    // Remove trailing slash from API URL if present
    const cleanApiUrl = apiUrl.replace(/\/$/, '');

    // Use 5 seconds for development and testing, 5 minutes for production
    const checkInterval = (nodeEnv === 'development' || nodeEnv === 'testing') ? 5 : 300;
    const intervalDescription = (nodeEnv === 'development' || nodeEnv === 'testing') ? '5 seconds (TESTING MODE)' : '5 minutes';

    return `# Adobe Usage Monitor - Auto-configured for your SubTracker account
# Generated: ${new Date().toISOString()}
# Environment: ${nodeEnv.toUpperCase()}

# ============================================
# Configuration (DO NOT MODIFY)
# ============================================

$API_KEY = "${apiKey}"
$API_URL = "${cleanApiUrl}/api/track"
$CHECK_INTERVAL = ${checkInterval}  # Check every ${intervalDescription}
$LOG_FILE = "C:\\ProgramData\\AdobeMonitor\\monitor.log"

# Logging function
function Write-MonitorLog {
    param($Message, $Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    # Always output to console
    Write-Output $logMessage
    
    # Try to write to log file
    try {
        Add-Content -Path $LOG_FILE -Value $logMessage -ErrorAction SilentlyContinue
    }
    catch {
        # Silently continue if we can't write to log file
    }
}

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
        
        $response = Invoke-RestMethod -Uri $API_URL \`
            -Method POST \`
            -Headers $headers \`
            -Body $json \`
            -ErrorAction Stop
        
        Write-MonitorLog "Usage data sent successfully" "SUCCESS"
        return $true
    }
    catch {
        Write-MonitorLog "Failed to send usage data: $_" "ERROR"
        return $false
    }
}

# Add Windows API calls for detecting foreground window (only once)
if (-not ([System.Management.Automation.PSTypeName]'Window').Type) {
    Add-Type -TypeDefinition @'
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
'@ -ErrorAction SilentlyContinue
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
    Write-MonitorLog "Starting Adobe Usage Monitor..." "INFO"
    Write-MonitorLog "API URL: $API_URL" "INFO"
    Write-MonitorLog "Check Interval: $CHECK_INTERVAL seconds" "INFO"
    Write-MonitorLog "Tracking Mode: Active window only (ignores background processes)" "INFO"
    Write-MonitorLog "" "INFO"

    $lastReportedProcesses = @{}
    $cycleCount = 0
    
    while ($true) {
        $cycleCount++
        $currentTime = Get-Date
        Write-MonitorLog "Monitoring cycle #$cycleCount - Checking for active Adobe processes..." "DEBUG"
        $runningProcesses = Get-RunningAdobeProcesses
        
        if ($runningProcesses.Count -gt 0) {
            Write-MonitorLog "Found $($runningProcesses.Count) active Adobe process(es)" "INFO"
            foreach ($process in $runningProcesses) {
                Write-MonitorLog "Active Adobe process: $($process.name) (Count: $($process.count))" "DEBUG"
            }
        } else {
            Write-MonitorLog "No active Adobe processes found" "DEBUG"
        }
        
        foreach ($process in $runningProcesses) {
            $processName = $process.name
            
            # Check if this is a new process or hasn't been reported recently
            if (-not $lastReportedProcesses.ContainsKey($processName) -or 
                ($currentTime - $lastReportedProcesses[$processName]).TotalSeconds -gt $CHECK_INTERVAL) {
                
                Write-MonitorLog "Sending usage data for $processName..." "INFO"
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
                    Write-MonitorLog "Successfully reported: $processName (User: $env:USERNAME, Computer: $env:COMPUTERNAME)" "SUCCESS"
                } else {
                    Write-MonitorLog "Failed to report: $processName" "ERROR"
                }
            } else {
                Write-MonitorLog "Skipping $processName - already reported recently" "DEBUG"
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
            Write-MonitorLog "Cleaned up old entry: $key" "DEBUG"
        }
        
        Write-MonitorLog "Cycle #$cycleCount complete. Waiting $CHECK_INTERVAL seconds..." "DEBUG"
        Start-Sleep -Seconds $CHECK_INTERVAL
    }
}

# ============================================
# Main Execution
# ============================================

try {
    Write-MonitorLog "================================================" "INFO"
    Write-MonitorLog "Adobe Usage Monitor - SubTracker" "INFO"
    Write-MonitorLog "================================================" "INFO"
    Write-MonitorLog "" "INFO"
    
    # Test API connection
    Write-MonitorLog "Testing API connection..." "INFO"
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
        Write-MonitorLog "API connection successful!" "SUCCESS"
        Write-MonitorLog "" "INFO"
        Monitor-AdobeUsage
    }
    else {
        Write-MonitorLog "Failed to connect to API. Please check:" "ERROR"
        Write-MonitorLog "  1. Internet connection" "ERROR"
        Write-MonitorLog "  2. API URL: $API_URL" "ERROR"
        Write-MonitorLog "  3. API Key is valid" "ERROR"
        exit 1
    }
}
catch {
    Write-MonitorLog "Error: $_" "ERROR"
    Write-MonitorLog "Monitor stopped. Please contact support." "ERROR"
    exit 1
}
`;
}

function generateDeploymentInstructions(apiKey, apiUrl) {
    // Remove trailing slash from API URL if present
    const cleanApiUrl = apiUrl.replace(/\/$/, '');
    
    return `# SubTracker - Deployment Instructions

## 🚀 Quick Deployment Guide

### Your Account Details:
- **API URL:** ${cleanApiUrl}/api/track
- **API Key:** ${apiKey}
- **Script Generated:** ${new Date().toLocaleString()}

---

## 📋 Deployment Options

### Option 1: Microsoft Intune (Recommended)

1. **Create PowerShell Script Package:**
   - Go to Intune Portal → Devices → Scripts → Add → Windows 10 and later
   - Upload the \`Monitor-AdobeUsage.ps1\` script
   - Configuration:
     - Run this script using the logged on credentials: **No**
     - Enforce script signature check: **No**
     - Run script in 64 bit PowerShell Host: **Yes**

2. **Assign to Groups:**
   - Assign to your Adobe licensed users group
   - Set as "Required"

3. **Monitor:**
   - Check SubTracker dashboard for incoming data
   - Users will report usage within 5 minutes

### Option 2: Group Policy (GPO)

1. **Create Startup Script:**
   - Group Policy Management Console
   - Computer Configuration → Windows Settings → Scripts → Startup
   - Add script: \`Monitor-AdobeUsage.ps1\`

2. **Link GPO:**
   - Link to OU containing Adobe users

3. **Force Update:**
   \`\`\`
   gpupdate /force
   \`\`\`

### Option 3: Manual Deployment

1. **Copy script to each computer:**
   \`\`\`
   C:\\ProgramData\\AdobeMonitor\\Monitor-AdobeUsage.ps1
   \`\`\`

2. **Create Scheduled Task:**
   \`\`\`powershell
   $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File C:\\ProgramData\\AdobeMonitor\\Monitor-AdobeUsage.ps1"
   $trigger = New-ScheduledTaskTrigger -AtStartup
   Register-ScheduledTask -TaskName "Adobe Usage Monitor" -Action $action -Trigger $trigger -RunLevel Highest
   \`\`\`

---

## 🧪 Testing

### Test on One Computer First:

\`\`\`powershell
# Run the script manually
PowerShell.exe -ExecutionPolicy Bypass -File .\\Monitor-AdobeUsage.ps1

# Should see:
# ✓ API connection successful!
# Starting Adobe Usage Monitor...
\`\`\`

### Verify in Dashboard:

1. Log in to SubTracker
2. Go to Dashboard
3. Check for usage events from test computer
4. Should appear within 5 minutes

---

## ⚠️ Troubleshooting

### No Data Appearing:

1. **Check firewall:** Ensure outbound HTTPS to ${cleanApiUrl} is allowed
2. **Test API manually:**
   \`\`\`powershell
   Invoke-RestMethod -Uri "${cleanApiUrl}/api/track" -Method POST -Headers @{"X-API-Key"="${apiKey}"} -Body '{"test":"true"}' -ContentType "application/json"
   \`\`\`
3. **Check script is running:** Task Manager → Details → powershell.exe

### Script Not Starting:

1. Check execution policy: \`Get-ExecutionPolicy\`
2. Run as Administrator
3. Check Windows Event Viewer for errors

### API Key Issues:

If you regenerate your API key, you must:
1. Download new script from SubTracker
2. Redeploy to all computers
3. Old scripts will stop working immediately

---

## 📊 What Gets Tracked:

- Adobe Acrobat (Reader & Pro)
- Adobe Illustrator
- Adobe Photoshop
- Adobe InDesign
- Adobe After Effects
- Adobe Premiere Pro
- Creative Cloud app

**Frequency:** Every 5 minutes when running

**Data Sent:**
- Application name
- Windows username
- Computer name
- Timestamp
- User domain

**Not Tracked:**
- File names or content
- Passwords or credentials
- Personal information
- Browsing history

---

## 🔒 Security Notes:

- API key is embedded in script (keep secure)
- All data sent over HTTPS
- No personally identifiable information collected
- Can revoke access anytime by regenerating API key

---

## 📞 Support:

Having issues? Check your SubTracker dashboard for:
- Account settings
- API key status
- Usage statistics
- Connection logs
`;
}

module.exports = {
    generateMonitorScript,
    generateDeploymentInstructions
};

