// PowerShell Script Generator
// Generates monitoring scripts with embedded API keys for each account

function generateMonitorScript(apiKey, apiUrl) {
    // Remove trailing slash from API URL if present
    const cleanApiUrl = apiUrl.replace(/\/$/, '');
    
    return `# Adobe Usage Monitor - Auto-configured for your SubTracker account
# Generated: ${new Date().toISOString()}

# ============================================
# Configuration (DO NOT MODIFY)
# ============================================

$API_KEY = "${apiKey}"
$API_URL = "${cleanApiUrl}/api/track"
$CHECK_INTERVAL = 300  # Check every 5 minutes

# ============================================
# Adobe Process Monitoring
# ============================================

$ADOBE_PROCESSES = @(
    "Acrobat.exe",
    "AcroRd32.exe",
    "Illustrator.exe",
    "Photoshop.exe",
    "InDesign.exe",
    "AfterFX.exe",
    "Premiere Pro.exe",
    "Creative Cloud.exe"
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
        
        Write-Host "✓ Usage data sent successfully" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "✗ Failed to send usage data: $_" -ForegroundColor Red
        return $false
    }
}

function Get-RunningAdobeProcesses {
    $runningProcesses = @()
    
    foreach ($processName in $ADOBE_PROCESSES) {
        $process = Get-Process -Name $processName.Replace(".exe", "") -ErrorAction SilentlyContinue
        
        if ($process) {
            $runningProcesses += @{
                name = $processName
                count = ($process | Measure-Object).Count
            }
        }
    }
    
    return $runningProcesses
}

function Monitor-AdobeUsage {
    Write-Host "Starting Adobe Usage Monitor..." -ForegroundColor Cyan
    Write-Host "API URL: $API_URL" -ForegroundColor Gray
    Write-Host "Check Interval: $CHECK_INTERVAL seconds" -ForegroundColor Gray
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

