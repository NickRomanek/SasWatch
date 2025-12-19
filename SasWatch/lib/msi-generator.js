// MSI Generator for Activity Agent
// Generates a PowerShell bootstrapper installer that downloads the agent from GitHub
// and configures it with user settings. This can be packaged as MSI using WiX.

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Generates a PowerShell installer script with embedded configuration
 * @param {Object} config - Configuration object
 * @param {String} config.apiUrl - API URL
 * @param {String} config.apiKey - API Key
 * @param {Boolean} config.enableApplicationMonitoring - Enable app monitoring
 * @param {Boolean} config.enableWindowFocusMonitoring - Enable window focus monitoring
 * @param {Boolean} config.enableBrowserMonitoring - Enable browser monitoring
 * @param {Boolean} config.enableNetworkMonitoring - Enable network monitoring
 * @param {Number} config.checkIntervalSeconds - Check interval in seconds
 * @param {Boolean} config.hideGui - Hide GUI mode
 * @param {Boolean} config.startWithWindows - Start with Windows
 * @param {Boolean} config.silentInstall - Silent install mode
 * @returns {String} PowerShell installer script
 */
function generateInstallerScript(config) {
    const {
        apiUrl,
        apiKey,
        enableApplicationMonitoring = true,
        enableWindowFocusMonitoring = true,
        enableBrowserMonitoring = true,
        enableNetworkMonitoring = false,
        checkIntervalSeconds = 30,
        hideGui = false,
        startWithWindows = true,
        silentInstall = false
    } = config;

    // Clean API URL (remove trailing slash, ensure /api/track is appended)
    const cleanApiUrl = apiUrl.replace(/\/$/, '');
    const fullApiUrl = cleanApiUrl.endsWith('/api/track') ? cleanApiUrl : `${cleanApiUrl}/api/track`;

    // GitHub Releases URL for agent
    // Try latest release first, fall back to latest tag if needed
    const agentUrl = 'https://github.com/NickRomanek/SasWatch/releases/latest/download/SasWatchAgent.exe';

    // Convert JavaScript booleans to PowerShell booleans (as strings for direct insertion)
    const psSilentInstall = silentInstall ? '$true' : '$false';
    const psEnableApps = enableApplicationMonitoring ? '$true' : '$false';
    const psEnableBrowser = enableBrowserMonitoring ? '$true' : '$false';
    const psEnableWindowFocus = enableWindowFocusMonitoring ? '$true' : '$false';
    const psEnableNetwork = enableNetworkMonitoring ? '$true' : '$false';
    const psHideGui = hideGui ? '$true' : '$false';
    const psStartWithWindows = startWithWindows ? '$true' : '$false';

    return `# SasWatch Activity Agent Installer
# Generated: ${new Date().toISOString()}
# This installer downloads and configures the SasWatch Activity Agent

param(
    [switch]$Silent,
    [string]$AgentPath = ""  # Optional: path to local agent exe
)

$ErrorActionPreference = "Stop"

# Installation paths
$installDir = Join-Path $env:ProgramFiles "SasWatch"
$installPath = Join-Path $installDir "SasWatchAgent.exe"

# GitHub Releases URL for agent download
$agentDownloadUrl = "${agentUrl}"

# Use silent mode if specified or if config says so
$isSilent = $Silent.IsPresent -or ` + psSilentInstall + `

function Write-InstallLog {
    param($Message, $Level = "INFO")
    if (-not $isSilent) {
        Write-Host "[$Level] $Message" -ForegroundColor $(if ($Level -eq "ERROR") { "Red" } elseif ($Level -eq "WARN") { "Yellow" } else { "Green" })
    }
}

function Write-ErrorLog {
    param($Message)
    Write-InstallLog $Message "ERROR"
    if (-not $isSilent) {
        Write-Host "Press any key to exit..." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
    exit 1
}

# Check for administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-ErrorLog "This installer requires Administrator privileges. Please run as Administrator."
}

Write-InstallLog "=============================================="
Write-InstallLog "SasWatch Activity Agent Installer"
Write-InstallLog "=============================================="

# Step 1: Create installation directory
Write-InstallLog "Creating installation directory..."
try {
    if (-not (Test-Path $installDir)) {
        New-Item -Path $installDir -ItemType Directory -Force | Out-Null
    }
} catch {
    Write-ErrorLog "Failed to create installation directory: $_"
}

# Step 2: Get agent executable
$tempAgentPath = Join-Path $env:TEMP "SasWatchAgent.exe"

if ($AgentPath -and (Test-Path $AgentPath)) {
    # Use provided local agent
    Write-InstallLog "Using local agent from: $AgentPath"
    Copy-Item -Path $AgentPath -Destination $tempAgentPath -Force
} else {
    # Download agent from GitHub Releases
    Write-InstallLog "Downloading agent from GitHub Releases..."
    Write-InstallLog "URL: $agentDownloadUrl"
    try {
        $ProgressPreference = if ($isSilent) { 'SilentlyContinue' } else { 'Continue' }
        
        # First check if the release exists
        $response = Invoke-WebRequest -Uri $agentDownloadUrl -Method Head -UseBasicParsing -ErrorAction Stop
        
        # Download the agent
        Invoke-WebRequest -Uri $agentDownloadUrl -OutFile $tempAgentPath -UseBasicParsing -ErrorAction Stop
        
        # Verify it's actually an executable (not HTML error page)
        $fileHeader = [System.IO.File]::ReadAllBytes($tempAgentPath)[0..1]
        if ($fileHeader[0] -ne 0x4D -or $fileHeader[1] -ne 0x5A) {
            throw "Downloaded file is not a valid Windows executable. The agent may not be published yet."
        }
        
        Write-InstallLog "Agent downloaded successfully"
    } catch {
        Write-InstallLog "=============================================="  "ERROR"
        Write-InstallLog "Failed to download agent from GitHub Releases." "ERROR"
        Write-InstallLog "" "ERROR"
        Write-InstallLog "The agent executable has not been published yet." "ERROR"
        Write-InstallLog "Please either:" "ERROR"
        Write-InstallLog "  1. Ask your administrator to publish the agent" "ERROR"
        Write-InstallLog "  2. Build the agent locally and run:" "ERROR"
        Write-InstallLog "     .\\Install-SasWatchAgent.ps1 -AgentPath 'C:\\path\\to\\SasWatchAgent.exe'" "ERROR"
        Write-InstallLog "" "ERROR"
        Write-InstallLog "Error details: $_" "ERROR"
        Write-InstallLog "=============================================="  "ERROR"
        if (-not $isSilent) {
            Write-Host "Press any key to exit..." -ForegroundColor Yellow
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }
        exit 1
    }
}

# Step 3: Verify downloaded file
if (-not (Test-Path $tempAgentPath)) {
    Write-ErrorLog "Downloaded agent file not found"
}

# Step 4: Copy agent to installation directory
Write-InstallLog "Installing agent to: $installPath"
try {
    Copy-Item -Path $tempAgentPath -Destination $installPath -Force
    Write-InstallLog "Agent installed successfully"
} catch {
    Write-ErrorLog "Failed to install agent: $_"
}

# Step 5: Write configuration to Registry
Write-InstallLog "Configuring agent..."
try {
    $regPath = "HKLM:\\Software\\ActivityAgent"
    if (-not (Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }

    Set-ItemProperty -Path $regPath -Name "ApiUrl" -Value "${fullApiUrl}" -Type String
    Set-ItemProperty -Path $regPath -Name "ApiKey" -Value "${apiKey}" -Type String
    Set-ItemProperty -Path $regPath -Name "CheckInterval" -Value ${checkIntervalSeconds} -Type DWord
    Set-ItemProperty -Path $regPath -Name "EnableApps" -Value $(if (` + psEnableApps + `) { 1 } else { 0 }) -Type DWord
    Set-ItemProperty -Path $regPath -Name "EnableBrowser" -Value $(if (` + psEnableBrowser + `) { 1 } else { 0 }) -Type DWord
    Set-ItemProperty -Path $regPath -Name "EnableWindowFocus" -Value $(if (` + psEnableWindowFocus + `) { 1 } else { 0 }) -Type DWord
    Set-ItemProperty -Path $regPath -Name "EnableNetwork" -Value $(if (` + psEnableNetwork + `) { 1 } else { 0 }) -Type DWord
    Set-ItemProperty -Path $regPath -Name "HideGui" -Value $(if (` + psHideGui + `) { 1 } else { 0 }) -Type DWord

    Write-InstallLog "Configuration saved to registry"
} catch {
    Write-ErrorLog "Failed to write configuration: $_"
}

# Step 6: Create startup entry (if enabled)
if (` + psStartWithWindows + `) {
    Write-InstallLog "Creating startup entry..."
    try {
        $startupPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\SasWatch Agent.lnk"
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($startupPath)
        $shortcut.TargetPath = $installPath
        $shortcut.WorkingDirectory = $installDir
        $shortcut.Save()
        Write-InstallLog "Startup entry created"
    } catch {
        Write-InstallLog "Warning: Failed to create startup entry: $_" "WARN"
    }
}

# Step 7: Stop existing agent if running
Write-InstallLog "Checking for running agent instances..."
try {
    $existingProcesses = Get-Process -Name "SasWatchAgent" -ErrorAction SilentlyContinue
    if ($existingProcesses) {
        Write-InstallLog "Stopping existing agent instances..."
        $existingProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
} catch {
    Write-InstallLog "Warning: Could not check for existing processes: $_" "WARN"
}

# Step 8: Launch agent (unless silent mode)
if (-not $isSilent) {
    Write-InstallLog "Starting agent..."
    try {
        Start-Process -FilePath $installPath -WorkingDirectory $installDir
        Write-InstallLog "Agent started successfully"
    } catch {
        Write-InstallLog "Warning: Could not start agent automatically: $_" "WARN"
        Write-InstallLog "You can start it manually from: $installPath"
    }
} else {
    Write-InstallLog "Silent mode: Agent will start on next login or reboot"
}

# Cleanup
try {
    Remove-Item -Path $tempAgentPath -ErrorAction SilentlyContinue
} catch {
    # Ignore cleanup errors
}

Write-InstallLog "=============================================="
Write-InstallLog "Installation complete!"
if (-not $isSilent) {
    Write-InstallLog "The agent is now running in your system tray."
    Write-InstallLog "Look for the SasWatch icon in the notification area."
}
Write-InstallLog "=============================================="

if (-not $isSilent) {
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
`;

}

/**
 * Generates a ZIP package containing the installer script
 * This can be used directly or packaged as MSI later
 * @param {Object} config - Configuration object (same as generateInstallerScript)
 * @returns {Promise<Buffer>} ZIP file buffer
 */
async function generateInstallerPackage(config) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        const chunks = [];

        archive.on('data', chunk => chunks.push(chunk));
        archive.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve(buffer);
        });
        archive.on('error', err => reject(err));

        // Generate installer script
        const installerScript = generateInstallerScript(config);
        archive.append(installerScript, { name: 'Install-SasWatchAgent.ps1' });

        // Add README
        const readme = `SasWatch Activity Agent Installer
=====================================

This package contains the installer script for the SasWatch Activity Agent.

INSTALLATION:
Option 1 (Recommended - Right-click method):
1. Right-click "Install-SasWatchAgent.ps1"
2. Select "Run with PowerShell" (as Administrator)
3. Follow the prompts

Option 2 (Command line):
1. Open PowerShell as Administrator
2. Run: powershell.exe -ExecutionPolicy Bypass -File "Install-SasWatchAgent.ps1"
3. Follow the prompts

SILENT INSTALLATION (for Intune/SCCM):
    powershell.exe -ExecutionPolicy Bypass -File "Install-SasWatchAgent.ps1" -Silent

TROUBLESHOOTING:
If you get an "execution policy" error:
- Run PowerShell as Administrator
- Use: powershell.exe -ExecutionPolicy Bypass -File "Install-SasWatchAgent.ps1"
- Or temporarily set policy: Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

The installer will:
- Download the latest agent from GitHub Releases
- Install to %ProgramFiles%\\SasWatch\\
- Configure with your API key and settings
- Create startup entry (if enabled)
- Launch the agent

For more information, visit: https://app.saswatch.com
`;
        archive.append(readme, { name: 'README.txt' });

        archive.finalize();
    });
}

module.exports = {
    generateInstallerScript,
    generateInstallerPackage
};

