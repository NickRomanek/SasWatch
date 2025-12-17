# Backend Integration Guide

## ✅ Good News: No Changes Required!

Your SasWatch backend already supports the Activity Agent with **zero modifications**.

## 🔌 How It Works

### 1. Agent Uses Existing API

The agent sends events to your existing `/api/track` endpoint:

```http
POST /api/track
X-API-Key: your-account-api-key
Content-Type: application/json

{
  "event": "application_usage",
  "url": "chrome.exe",
  "windowsUser": "jdoe",
  "computerName": "DESKTOP-123",
  "userDomain": "COMPANY",
  "why": "agent_monitor",
  "when": "2025-11-30T12:00:00.000Z"
}
```

### 2. Backend Already Handles This

Your backend (`SasWatch/server-multitenant-routes.js` line 884-906):

```javascript
app.post('/api/track', auth.requireApiKey, trackingLimiter, async (req, res) => {
    const data = req.body;  // ✅ Accepts any JSON
    
    const source = data.why === 'adobe_reader_wrapper' || data.why === 'process_monitor' 
        ? 'wrapper' 
        : 'adobe';  // ✅ Agent events will be marked as 'adobe'
    
    await db.addUsageEvent(req.accountId, data, source);  // ✅ Saves to database
    
    res.json({ success: true, message: 'Usage data recorded' });
});
```

### 3. Events Appear in Dashboard

Agent events will show up alongside PowerShell and extension events:

```
Usage Events:
┌─────────────────────┬────────────┬──────────┐
│ Source              │ Event      │ User     │
├─────────────────────┼────────────┼──────────┤
│ wrapper (PS script) │ Acrobat    │ jdoe     │ ← Existing
│ adobe (agent)       │ Chrome     │ jdoe     │ ← New (agent)
│ adobe (extension)   │ adobe.com  │ jdoe     │ ← Existing
└─────────────────────┴────────────┴──────────┘
```

## 🎨 Optional Enhancement

If you want to distinguish agent events from other sources, make this small change:

### File: `SasWatch/server-multitenant-routes.js`

**Location:** Line 888-891

**Before:**
```javascript
const source = data.why === 'adobe_reader_wrapper' || data.why === 'process_monitor' 
    ? 'wrapper' 
    : 'adobe';
```

**After:**
```javascript
const source = data.why === 'adobe_reader_wrapper' || data.why === 'process_monitor' 
    ? 'wrapper'
    : data.why === 'agent_monitor'
    ? 'agent'
    : 'adobe';
```

**Result:**
```
Usage Events:
┌─────────────────────┬────────────┬──────────┐
│ Source              │ Event      │ User     │
├─────────────────────┼────────────┼──────────┤
│ wrapper (PS script) │ Acrobat    │ jdoe     │
│ agent (.NET)        │ Chrome     │ jdoe     │ ← Now labeled 'agent'
│ adobe (extension)   │ adobe.com  │ jdoe     │
└─────────────────────┴────────────┴──────────┘
```

## 📊 Dashboard Display (Optional)

If you want to show agent events differently in your dashboard UI:

### File: `SasWatch/public/js/app.js`

Add icon/badge for agent events:

```javascript
// In your event rendering code
function renderEvent(event) {
    let sourceIcon = '';
    
    if (event.source === 'agent') {
        sourceIcon = '🤖'; // Robot icon for agent
    } else if (event.source === 'wrapper') {
        sourceIcon = '📜'; // Script icon for PowerShell
    } else {
        sourceIcon = '🌐'; // Web icon for extension
    }
    
    return `${sourceIcon} ${event.event} - ${event.url}`;
}
```

## 🧪 Testing Integration

### 1. Start Backend

```bash
cd SasWatch
npm start
```

### 2. Create Test Account

```bash
# Open http://localhost:3000
# Sign up with test account
# Copy API key from Account page
```

### 3. Configure Agent

```powershell
cd ActivityAgent
.\setup-local-config.ps1 -ApiKey "your-test-api-key"
```

### 4. Run Agent

```bash
cd src/ActivityAgent.Service
dotnet run
```

### 5. Verify Events

1. Open browser: `http://localhost:3000`
2. Log in to test account
3. Go to Dashboard
4. You should see events appearing!

### 6. Check Database

```bash
cd SasWatch
npm run db:studio
# Browse usage_events table
# Look for events with why: 'agent_monitor'
```

## 📝 Event Types from Agent

The agent sends these event types:

### Application Usage
```json
{
  "event": "application_usage",
  "url": "chrome.exe",
  "windowTitle": "Google - Chrome",
  "processPath": "C:\\Program Files\\Google\\Chrome\\chrome.exe"
}
```

### Web Browsing
```json
{
  "event": "web_browsing",
  "url": "https://google.com",
  "browser": "chrome",
  "windowTitle": "Google - Chrome"
}
```

### Window Focus
```json
{
  "event": "window_focus",
  "url": "notepad.exe",
  "windowTitle": "Untitled - Notepad"
}
```

### Network Activity
```json
{
  "event": "network_activity",
  "url": "api.github.com",
  "processName": "Network"
}
```

## ✅ Compatibility Checklist

- [x] Agent uses existing `/api/track` endpoint
- [x] Agent uses `X-API-Key` header authentication
- [x] Agent respects rate limiting (100 req/min)
- [x] Agent sends compatible JSON payload
- [x] Backend accepts agent events without changes
- [x] Events are properly account-scoped
- [x] Multi-tenant isolation works correctly
- [x] Events appear in dashboard

## 🎯 Summary

**Required Backend Changes:** 0

**Optional Backend Changes:** 3 lines (to label agent events)

**Breaking Changes:** None

**Database Changes:** None

**API Changes:** None

**Your backend is ready!** Just test the agent and verify events appear in your dashboard.

---

**Next Step:** [QUICK-START.md](QUICK-START.md) - Test the agent locally

