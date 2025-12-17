# Activity Agent - Windows Monitoring Service

A professional .NET 8 Windows Service for comprehensive activity monitoring. Tracks applications, browser URLs, and network connections. Integrates seamlessly with your existing SasWatch backend.

## 🎯 Overview

This Windows Service monitors user activity and reports to the SasWatch backend API for license optimization and usage analytics. **Zero backend changes required!**

## ⚡ Quick Start

**Want to test it right now?** → [QUICK-START.md](QUICK-START.md) (5 minutes)

**Want to understand what was built?** → [BUILD-SUMMARY.md](BUILD-SUMMARY.md) (10 minutes)

**Ready for production?** → [ENTERPRISE-DEPLOYMENT.md](ENTERPRISE-DEPLOYMENT.md) (30 minutes)

## 📁 Project Structure

```
ActivityAgent/
├── src/
│   ├── ActivityAgent.Service/           # Main Windows Service
│   └── ActivityAgent.Installer/         # WiX MSI Installer
├── tests/
│   └── ActivityAgent.Tests/
├── docs/
│   └── ENTERPRISE-DEPLOYMENT.md
└── build/
    └── build.ps1                        # Build automation
```

## 🚀 Quick Start

### Prerequisites

- .NET 8 SDK
- Visual Studio 2022 (or VS Code)
- WiX Toolset v4 (for installer)

### Build

```bash
cd ActivityAgent
dotnet restore
dotnet build
```

### Run Locally (Development)

```bash
cd src/ActivityAgent.Service
dotnet run
```

### Configuration

The agent reads configuration from Windows Registry:
- Location: `HKLM\Software\ActivityAgent`
- Keys:
  - `ApiUrl` - Backend API endpoint
  - `ApiKey` - Account API key
  - `CheckInterval` - Seconds between checks (default: 10)

For local testing, set these manually:

```powershell
New-Item -Path "HKLM:\Software\ActivityAgent" -Force
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "ApiUrl" -Value "http://localhost:3000/api/track"
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "ApiKey" -Value "your-test-api-key"
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "CheckInterval" -Value 10
```

## 🏗️ Architecture

### Components

1. **Configuration Manager** - Reads settings from registry
2. **API Client** - Communicates with SasWatch backend
3. **Event Queue** - In-memory queue for events
4. **Monitors:**
   - Application Monitor - Tracks running applications
   - Browser Monitor - Extracts URLs from browsers
   - Window Focus Monitor - Tracks active windows
   - Network Monitor - Monitors network connections

### Data Flow

```
Monitors → Event Queue → API Client → SasWatch Backend
                ↓
         Offline Cache (SQLite)
```

## 📊 What It Monitors

- ✅ Running applications (process names, window titles)
- ✅ Browser URLs (Chrome, Edge, Firefox)
- ✅ Active window focus
- ✅ Network connections (external domains)
- ❌ Does NOT monitor: keystrokes, file contents, screenshots

## 🔒 Security

- Runs as Windows Service (SYSTEM account)
- API key authentication
- HTTPS-only communication
- Respects system proxy settings
- Minimal data collection (privacy-focused)

## 📦 Deployment

### Via Intune (Recommended)

1. Build MSI installer
2. Upload to Intune as Win32 app
3. Configure install command:
   ```
   msiexec /i ActivityAgent.msi /qn APIKEY="%API_KEY%" APIURL="https://your-app.railway.app/api/track"
   ```
4. Assign to user groups

### Manual Installation

```powershell
# Install
msiexec /i ActivityAgent.msi /qn APIKEY="your-key" APIURL="https://your-api.com/api/track"

# Uninstall
msiexec /x {PRODUCT-GUID} /qn
```

## 🧪 Testing

```bash
cd tests/ActivityAgent.Tests
dotnet test
```

## 📝 Logs

- Location: `C:\ProgramData\ActivityAgent\logs\`
- Retention: 30 days
- View logs: `Get-Content C:\ProgramData\ActivityAgent\logs\activity-agent-*.log -Tail 50`

## 🔧 Development

### Adding a New Monitor

1. Create class implementing `IMonitor`
2. Add to `Worker.cs` monitors list
3. Register in dependency injection

### Testing Against Local Backend

```bash
# Terminal 1: Start SasWatch backend
cd SasWatch
npm start

# Terminal 2: Run agent
cd ActivityAgent/src/ActivityAgent.Service
dotnet run
```

## 📚 Documentation

- [Enterprise Deployment Guide](ENTERPRISE-DEPLOYMENT.md)
- [API Integration](docs/API-INTEGRATION.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## 🤝 Contributing

This is an internal tool. For changes:
1. Create feature branch
2. Test thoroughly
3. Update documentation
4. Submit for review

## 📄 License

Proprietary - Internal Use Only

## 🆘 Support

- Technical Issues: IT Support
- Feature Requests: Development Team
- Privacy Questions: Legal/HR Department

