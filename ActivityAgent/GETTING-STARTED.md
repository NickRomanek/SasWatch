# 🚀 Getting Started with Activity Agent

## Welcome!

You now have a professional Windows Service agent for comprehensive activity monitoring. This guide will help you get started.

## 📚 Documentation Overview

| Document | Purpose | Read Time |
|----------|---------|-----------|
| **[QUICK-START.md](QUICK-START.md)** | Get running in 5 minutes | 5 min |
| **[BUILD-SUMMARY.md](BUILD-SUMMARY.md)** | What was built and why | 10 min |
| **[TESTING-GUIDE.md](TESTING-GUIDE.md)** | Comprehensive testing instructions | 20 min |
| **[ENTERPRISE-DEPLOYMENT.md](ENTERPRISE-DEPLOYMENT.md)** | Production deployment guide | 30 min |
| **[COMPARISON.md](COMPARISON.md)** | PowerShell vs Agent comparison | 10 min |
| **[README.md](README.md)** | Technical documentation | 15 min |

## 🎯 Choose Your Path

### Path 1: Quick Test (Recommended First Step)
**Time: 10 minutes**

1. Read [QUICK-START.md](QUICK-START.md)
2. Run `setup-local-config.ps1`
3. Run `dotnet run`
4. Check SasWatch dashboard

**Goal:** Verify the agent works with your backend

### Path 2: Comprehensive Testing
**Time: 1-2 hours**

1. Complete Path 1
2. Read [TESTING-GUIDE.md](TESTING-GUIDE.md)
3. Test all monitors
4. Verify performance
5. Test error scenarios

**Goal:** Ensure production readiness

### Path 3: Production Deployment
**Time: 1-2 weeks**

1. Complete Path 2
2. Read [ENTERPRISE-DEPLOYMENT.md](ENTERPRISE-DEPLOYMENT.md)
3. Obtain code signing certificate
4. Create MSI installer
5. Deploy via Intune

**Goal:** Roll out to organization

## ⚡ Quick Commands

### Setup Configuration
```powershell
# Run as Administrator
.\setup-local-config.ps1 -ApiKey "your-api-key"
```

### Run Agent (Development)
```bash
cd src/ActivityAgent.Service
dotnet run
```

### Build for Production
```powershell
.\build.ps1 -Configuration Release
```

### View Logs
```powershell
Get-Content C:\ProgramData\ActivityAgent\logs\activity-agent-*.log -Tail 50 -Wait
```

### Check Configuration
```powershell
Get-ItemProperty HKLM:\Software\ActivityAgent
```

## 🔍 What Does It Monitor?

### ✅ Included
- Running applications (with window titles)
- Active window focus
- Browser URLs (Chrome, Edge, Firefox)
- Network connections (external domains)

### ❌ Not Included
- Keystrokes
- File contents
- Screenshots
- Passwords or credentials

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────┐
│         Activity Agent Service          │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐  ┌──────────────┐   │
│  │ Application  │  │   Window     │   │
│  │   Monitor    │  │    Focus     │   │
│  └──────────────┘  └──────────────┘   │
│                                         │
│  ┌──────────────┐  ┌──────────────┐   │
│  │   Network    │  │    Event     │   │
│  │   Monitor    │  │    Queue     │   │
│  └──────────────┘  └──────────────┘   │
│                                         │
│         ↓                               │
│  ┌──────────────┐                      │
│  │  API Client  │                      │
│  └──────────────┘                      │
└─────────────────────────────────────────┘
           ↓
    [SasWatch Backend]
```

## 🎯 Key Features

1. **Windows Service** - Runs as protected system service
2. **Low Resource Usage** - <1% CPU, ~30-50 MB RAM
3. **SasWatch Integration** - Uses existing API, zero backend changes
4. **Enterprise Ready** - Logging, configuration, error handling
5. **Privacy Focused** - Minimal data collection

## ⚠️ Important Notes

### Before Testing
- ✅ SasWatch backend must be running
- ✅ You need a valid API key
- ✅ Run setup script as Administrator
- ✅ .NET 8 SDK must be installed

### Before Production
- ⚠️ Obtain code signing certificate
- ⚠️ Create MSI installer
- ⚠️ Draft privacy policy
- ⚠️ Get legal/HR approval
- ⚠️ Notify employees

### Backend Compatibility
- ✅ Works with existing `/api/track` endpoint
- ✅ No backend changes required
- ✅ Multi-tenant compatible
- ✅ Rate limiting respected

## 🆘 Getting Help

### Common Issues

**"Invalid configuration"**
→ Run `setup-local-config.ps1` as Administrator

**"Cannot reach API"**
→ Verify backend is running, check API URL

**"No events appearing"**
→ Check logs, verify API key, wait 10-15 seconds

### Troubleshooting Steps

1. Check configuration:
   ```powershell
   Get-ItemProperty HKLM:\Software\ActivityAgent
   ```

2. Check logs:
   ```powershell
   Get-Content C:\ProgramData\ActivityAgent\logs\activity-agent-*.log -Tail 50
   ```

3. Test API connection:
   ```powershell
   curl http://localhost:3000/api/health
   ```

4. See [TESTING-GUIDE.md](TESTING-GUIDE.md) for detailed troubleshooting

## 📈 Success Metrics

After successful setup, you should see:

- ✅ Agent starts without errors
- ✅ "API connection successful" in logs
- ✅ All monitors started
- ✅ Events appearing in SasWatch dashboard
- ✅ CPU usage <1%
- ✅ Memory usage ~30-50 MB

## 🎉 Next Steps

### Immediate (Today)
1. ✅ Read [QUICK-START.md](QUICK-START.md)
2. ✅ Test agent locally
3. ✅ Verify events in dashboard

### Short-term (This Week)
1. ⏳ Complete comprehensive testing
2. ⏳ Review [ENTERPRISE-DEPLOYMENT.md](ENTERPRISE-DEPLOYMENT.md)
3. ⏳ Plan deployment strategy

### Long-term (This Month)
1. ⏳ Obtain code signing certificate
2. ⏳ Create MSI installer
3. ⏳ Pilot with IT team
4. ⏳ Roll out to organization

## 📞 Support

- **Technical Issues**: See [TESTING-GUIDE.md](TESTING-GUIDE.md)
- **Deployment Questions**: See [ENTERPRISE-DEPLOYMENT.md](ENTERPRISE-DEPLOYMENT.md)
- **Backend Integration**: See [BUILD-SUMMARY.md](BUILD-SUMMARY.md)

## 🎯 Quick Decision Tree

```
Do you want to test the agent?
├─ Yes → Read QUICK-START.md (5 min)
└─ No
   │
   Do you want to understand what was built?
   ├─ Yes → Read BUILD-SUMMARY.md (10 min)
   └─ No
      │
      Do you want to deploy to production?
      ├─ Yes → Read ENTERPRISE-DEPLOYMENT.md (30 min)
      └─ No
         │
         Do you want to compare with PowerShell?
         └─ Yes → Read COMPARISON.md (10 min)
```

---

**Ready to start?** → [QUICK-START.md](QUICK-START.md)

**Have questions?** → [TESTING-GUIDE.md](TESTING-GUIDE.md)

**Planning deployment?** → [ENTERPRISE-DEPLOYMENT.md](ENTERPRISE-DEPLOYMENT.md)

---

**Built with ❤️ for enterprise activity monitoring**

