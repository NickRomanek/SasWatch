# Activity Agent - Testing Guide

## 🧪 Local Testing

### Prerequisites

1. **.NET 8 SDK** installed
2. **SasWatch backend** running locally
3. **Administrator privileges** (for registry access)
4. **Test API key** from your SasWatch account

### Step 1: Start SasWatch Backend

```bash
cd SasWatch
npm start
```

Backend should be running at `http://localhost:3000`

### Step 2: Get Test API Key

1. Open browser: `http://localhost:3000`
2. Sign up or log in to test account
3. Go to Account page
4. Copy your API key

### Step 3: Configure Agent

Run as Administrator:

```powershell
cd ActivityAgent
.\setup-local-config.ps1 -ApiKey "your-api-key-here"
```

This creates registry configuration at `HKLM\Software\ActivityAgent`

### Step 4: Build and Run Agent

```bash
cd src/ActivityAgent.Service
dotnet run
```

You should see output like:

```
==============================================
Activity Agent Service Starting
==============================================
API URL: http://localhost:3000/api/track
Check Interval: 10s
Monitors Enabled: 3
Testing API connection...
API connection successful
Started: Application Monitor
Started: Window Focus Monitor
Started: Network Monitor
All monitors started. Beginning main loop...
==============================================
```

### Step 5: Generate Activity

1. Open some applications (Chrome, Notepad, etc.)
2. Browse some websites
3. Switch between windows
4. Wait 10-15 seconds

### Step 6: Verify Events in Dashboard

1. Open browser: `http://localhost:3000`
2. Log in to your test account
3. Go to Dashboard
4. You should see events appearing with `source: agent`

## 🔍 Troubleshooting

### Agent Won't Start

**Error: "Invalid configuration"**
- Check registry: `Get-ItemProperty HKLM:\Software\ActivityAgent`
- Verify ApiKey and ApiUrl are set
- Re-run setup script as Administrator

**Error: "Cannot reach API"**
- Verify SasWatch backend is running
- Check firewall settings
- Try: `curl http://localhost:3000/api/health`

### No Events Appearing

**Check logs:**
```powershell
Get-Content C:\ProgramData\ActivityAgent\logs\activity-agent-*.log -Tail 50
```

**Common issues:**
- API key is invalid → Check in SasWatch account page
- Rate limiting → Wait 1 minute, check again
- No activity → Open applications, browse websites

### Events Not Showing in Dashboard

1. Check API response:
   ```powershell
   # In agent logs, look for:
   # "Event sent: application_usage - chrome"
   ```

2. Check backend logs:
   ```bash
   # In SasWatch terminal, look for:
   # POST /api/track 200
   ```

3. Check database:
   ```bash
   cd SasWatch
   npm run db:studio
   # Browse usage_events table
   ```

## 🧪 Testing Specific Monitors

### Application Monitor

1. Open several applications
2. Check logs: Should see "New application detected"
3. Verify in dashboard: Events with `event: application_usage`

### Window Focus Monitor

1. Switch between windows frequently
2. Check logs: Should see "Active window: ..."
3. Verify in dashboard: Events with `event: window_focus`

### Browser Monitor (via Window Focus)

1. Open Chrome/Edge
2. Navigate to different websites
3. Switch tabs
4. Check logs: Should see "Active window: chrome - ..."
5. Verify in dashboard: Events with `event: web_browsing`

### Network Monitor

1. Browse internet
2. Use applications that connect online
3. Wait 30 seconds (network check interval)
4. Check logs: Should see "Network connection: ..."
5. Verify in dashboard: Events with `event: network_activity`

## 📊 Performance Testing

### CPU Usage

```powershell
# Monitor CPU usage
Get-Process -Name "ActivityAgent.Service" | Select-Object CPU, WorkingSet
```

Expected: <1% CPU, ~30-50 MB memory

### Network Usage

```powershell
# Monitor network activity
Get-NetAdapterStatistics
```

Expected: ~1-5 KB/minute to API

### Event Rate

Check logs for event processing rate:
```
Processing 5 events from queue
Batch complete: 5 events sent successfully
```

Expected: 5-20 events per minute (varies by activity)

## 🔐 Security Testing

### API Authentication

Test with invalid API key:

```powershell
# Temporarily set invalid key
Set-ItemProperty -Path "HKLM:\Software\ActivityAgent" -Name "ApiKey" -Value "invalid-key"

# Restart agent
# Should see: "API returned 401: Invalid API key"
```

### Rate Limiting

Generate many events quickly:
- Open/close many applications rapidly
- Should see: "API returned 429: Too many requests"
- Agent should handle gracefully

### Offline Behavior

1. Stop SasWatch backend
2. Agent should continue running
3. Check logs: "Failed to send event"
4. Restart backend
5. Agent should reconnect automatically

## 🚀 Production Testing

### Build Release Version

```powershell
.\build.ps1 -Configuration Release
```

### Test Published Executable

```powershell
cd publish
.\ActivityAgent.Service.exe
```

Should work identically to `dotnet run`

### Install as Windows Service

```powershell
# Create service
sc.exe create "ActivityMonitorService" binPath= "C:\Path\To\ActivityAgent.Service.exe"

# Start service
sc.exe start "ActivityMonitorService"

# Check status
sc.exe query "ActivityMonitorService"

# View logs
Get-Content C:\ProgramData\ActivityAgent\logs\activity-agent-*.log -Tail 50 -Wait

# Stop service
sc.exe stop "ActivityMonitorService"

# Delete service
sc.exe delete "ActivityMonitorService"
```

## 📝 Test Checklist

Before deployment, verify:

- [ ] Agent starts successfully
- [ ] API connection test passes
- [ ] All monitors start without errors
- [ ] Application events are captured
- [ ] Window focus events are captured
- [ ] Browser URLs are extracted correctly
- [ ] Network connections are monitored
- [ ] Events appear in SasWatch dashboard
- [ ] CPU usage is <1%
- [ ] Memory usage is <50 MB
- [ ] Logs are written correctly
- [ ] Agent handles API errors gracefully
- [ ] Agent reconnects after network issues
- [ ] Rate limiting is respected
- [ ] Invalid API key is rejected
- [ ] Service can be installed/uninstalled
- [ ] Service auto-starts on reboot

## 🐛 Reporting Issues

When reporting issues, include:

1. **Agent logs:**
   ```powershell
   Get-Content C:\ProgramData\ActivityAgent\logs\activity-agent-*.log
   ```

2. **Configuration:**
   ```powershell
   Get-ItemProperty HKLM:\Software\ActivityAgent
   ```

3. **System info:**
   ```powershell
   Get-ComputerInfo | Select-Object WindowsVersion, OsArchitecture
   ```

4. **Steps to reproduce**
5. **Expected vs actual behavior**

## 📚 Additional Resources

- [Enterprise Deployment Guide](ENTERPRISE-DEPLOYMENT.md)
- [README](README.md)
- [SasWatch API Documentation](../SasWatch/README.md)

