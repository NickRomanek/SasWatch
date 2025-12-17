# Activity Agent - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### 1. Prerequisites

- Windows 10/11
- .NET 8 SDK
- Administrator privileges
- SasWatch backend running (locally or Railway)

### 2. Get Your API Key

**Option A: Local Backend**
```bash
cd SasWatch
npm start
# Open http://localhost:3000
# Sign up → Go to Account → Copy API Key
```

**Option B: Railway Backend**
```
# Open https://your-app.railway.app
# Sign up → Go to Account → Copy API Key
```

### 3. Configure Agent

Run PowerShell as Administrator:

```powershell
cd ActivityAgent

# For local testing:
.\setup-local-config.ps1 -ApiKey "your-api-key-here"

# For Railway:
.\setup-local-config.ps1 -ApiUrl "https://your-app.railway.app/api/track" -ApiKey "your-api-key-here"
```

### 4. Run Agent

```bash
cd src/ActivityAgent.Service
dotnet run
```

You should see:
```
==============================================
Activity Agent Service Starting
==============================================
API URL: http://localhost:3000/api/track
...
API connection successful
Started: Application Monitor
Started: Window Focus Monitor
Started: Network Monitor
==============================================
```

### 5. Verify It's Working

1. Open some applications (Chrome, Notepad, etc.)
2. Browse some websites
3. Wait 10-15 seconds
4. Check SasWatch dashboard - you should see events!

## 🎉 Success!

The agent is now monitoring your activity and sending data to SasWatch.

## 📊 What's Being Monitored?

- ✅ Running applications
- ✅ Active window focus
- ✅ Browser URLs (Chrome, Edge, Firefox)
- ✅ Network connections

## 🔍 Troubleshooting

**Agent won't start?**
```powershell
# Check configuration
Get-ItemProperty HKLM:\Software\ActivityAgent
```

**No events appearing?**
```powershell
# Check logs
Get-Content C:\ProgramData\ActivityAgent\logs\activity-agent-*.log -Tail 50
```

**API connection failed?**
- Verify backend is running
- Check API key is correct
- Check firewall settings

## 📚 Next Steps

- [Full Testing Guide](TESTING-GUIDE.md)
- [Enterprise Deployment](ENTERPRISE-DEPLOYMENT.md)
- [Build for Production](README.md#deployment)

## 🛑 Stop Agent

Press `Ctrl+C` in the terminal where the agent is running.

## 🗑️ Remove Configuration

```powershell
# Run as Administrator
Remove-Item -Path "HKLM:\Software\ActivityAgent" -Recurse
```

---

**Need Help?** See [TESTING-GUIDE.md](TESTING-GUIDE.md) for detailed troubleshooting.

