# SasWatch Activity Agent

A Windows desktop application for comprehensive activity monitoring. Runs in the system tray and tracks applications, browser URLs, and usage to help optimize SaaS license utilization.

## 🎯 Features

- **System Tray Icon** - Runs quietly in the background with tray icon
- **Modern GUI** - Dark-themed status window with real-time stats
- **Application Monitoring** - Tracks running applications
- **Browser URL Tracking** - Monitors Chrome, Edge, Firefox URLs
- **Window Focus Tracking** - Detects active window changes
- **Real-time Sync** - Socket.IO connection to SasWatch backend
- **Offline Support** - Events queued when connection is lost
- **Single Executable** - Self-contained .exe for easy deployment

## 🚀 Quick Start

### Prerequisites

- Windows 10/11
- .NET 8 SDK (for building)
- SasWatch account with API key

### Build

```bash
cd ActivityAgent/src/ActivityAgent.Service
dotnet build
```

### Configure

Run PowerShell as Administrator:

```powershell
# Create registry key
New-Item -Path "HKLM:\Software\ActivityAgent" -Force

# Set your SasWatch API URL and Key
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "ApiUrl" -Value "https://app.saswatch.com/api/track"
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "ApiKey" -Value "your-api-key-here"

# Optional settings
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "CheckInterval" -Value 30
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "EnableApps" -Value 1
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "EnableBrowser" -Value 1
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "EnableWindowFocus" -Value 1
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "EnableNetwork" -Value 0
```

Or use the helper script:

```powershell
.\setup-local-config.ps1 -ApiUrl "https://app.saswatch.com/api/track" -ApiKey "your-api-key"
```

### Run

```bash
cd src/ActivityAgent.Service
dotnet run
```

The agent will:
1. Show a window with status information
2. Add an icon to the system tray
3. Start monitoring and sending events to SasWatch

## 📦 Building for Distribution

### Create Single Executable

```bash
cd ActivityAgent/src/ActivityAgent.Service
dotnet publish -c Release
```

Output: `bin/Release/net8.0-windows/win-x64/publish/SasWatchAgent.exe`

This creates a single self-contained executable (~70-100MB) that includes the .NET runtime.

### Add Custom Icon (Optional)

1. Create a 256x256 .ico file
2. Save as `Resources/icon.ico`
3. Uncomment `<ApplicationIcon>` in `.csproj`
4. Rebuild

## 🖥️ User Interface

### System Tray

- **Double-click** - Open status window
- **Right-click** - Context menu:
  - Show Window
  - View Logs
  - Open Dashboard
  - Exit

### Status Window

- Connection status (green = connected)
- Events sent/queued counters
- Active monitors list
- Recent activity log
- Quick action buttons

## ⚙️ Configuration

Settings are stored in Windows Registry:

| Key | Description | Default |
|-----|-------------|---------|
| `ApiUrl` | SasWatch API endpoint | Required |
| `ApiKey` | Your account API key | Required |
| `CheckInterval` | Seconds between syncs | 30 |
| `EnableApps` | Track applications | 1 (true) |
| `EnableBrowser` | Track browser URLs | 1 (true) |
| `EnableWindowFocus` | Track window focus | 1 (true) |
| `EnableNetwork` | Track network (high volume) | 0 (false) |

## 📊 What's Monitored

- ✅ Running applications (process names, window titles)
- ✅ Browser URLs (Chrome, Edge, Firefox)
- ✅ Active window focus changes
- ✅ Network connections (optional, disabled by default)
- ❌ **NOT** monitored: keystrokes, file contents, screenshots

## 🔒 Privacy & Security

- No keystroke logging
- No file content access
- No screenshots
- Data sent only to your SasWatch instance
- API key authentication
- HTTPS encrypted communication

## 📝 Logs

Location: `C:\ProgramData\ActivityAgent\logs\`

View logs:
```powershell
Get-Content "C:\ProgramData\ActivityAgent\logs\activity-agent-*.log" -Tail 50 -Wait
```

## 🛠️ Development

### Project Structure

```
ActivityAgent/
├── src/
│   └── ActivityAgent.Service/
│       ├── App.xaml(.cs)           # WPF Application (tray)
│       ├── MainWindow.xaml(.cs)    # Status GUI
│       ├── AgentWorker.cs          # Main monitoring logic
│       ├── Configuration/
│       │   └── AgentConfig.cs      # Registry settings
│       ├── Monitors/
│       │   ├── ApplicationMonitor.cs
│       │   ├── WindowFocusMonitor.cs
│       │   └── NetworkMonitor.cs
│       └── Services/
│           ├── SocketClient.cs     # Real-time API
│           ├── EventQueue.cs
│           └── PersistentQueue.cs
└── README.md
```

### Tech Stack

- .NET 8 WPF
- Hardcodet.NotifyIcon.Wpf (tray icon)
- Socket.IO (real-time)
- Serilog (logging)
- SQLite (offline queue)

## 🤝 Support

- **Bugs/Issues**: GitHub Issues
- **Feature Requests**: GitHub Issues
- **Questions**: [app.saswatch.com](https://app.saswatch.com)

## 📄 License

AGPL-3.0 - See LICENSE file
