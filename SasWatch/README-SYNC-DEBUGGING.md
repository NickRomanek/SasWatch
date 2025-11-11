# Sync Debugging Guide

## 🔧 **Debugging Tools Added**

### **Console Logging**
All sync operations now log with `[SYNC-DEBUG]` prefix. Open browser DevTools → Console to see:
- Sync initiation and parameters
- Progress updates every 2 seconds
- Status polling requests/responses
- Sync completion details

### **Test Scenarios**

#### **1. Normal Sync Test**
```
1. Go to /dev page
2. Click "🧪 Add Test Data" → Creates 15 events + 5 sign-ins
3. Go to / (main dashboard)
4. Click "🔄 Sync" → Should see progress: "Fetching page X (Y events so far)"
5. Should complete with: "Sync completed: X events synced"
```

#### **2. Clear + Resync Test**
```
1. Go to /dev → "🧪 Add Test Data"
2. Go to / → Click "🗑️ Clear Data"
3. Click "🔄 Sync" → Should NOT be throttled (no "cached data" message)
4. Should complete with: "Sync completed - no new activity found in the last 24 hours"
```

#### **3. Stuck Sync Test**
```
1. Go to /dev → "🐛 Stuck Sync Test"
2. Go to / → Should see "🛑 Cancel Sync" button appear
3. Progress shows "Test: Sync appears stuck (use cancel button)"
4. Click "🛑 Cancel Sync" → Should disappear and show "Sync cancelled"
```

## 🐛 **Common Issues & Fixes**

### **Issue: Sync gets stuck on "Loading..."**
**Symptoms:** Button shows spinner, progress never updates, no console logs

**Debug Steps:**
1. Check console for `[SYNC-DEBUG] Starting sync...`
2. If missing → Network issue, check browser connection
3. If present but no progress → Server not responding, check server logs
4. If polling starts but never completes → Check `/api/sync/status` endpoint

**Fix:**
- Click "🛑 Cancel Sync" if button appears
- Refresh page and try again
- Check server logs for errors

### **Issue: Sync times out after 30 seconds (old issue - now fixed)**
**Note:** This should no longer happen as timeout is now 2 minutes per page.
**Old symptoms:** Sync would timeout after 30 seconds even when making progress

**Debug Steps:**
1. Check if you're seeing "Fetched page X (Y events so far)" messages
2. If yes, this was the timeout issue (now fixed)
3. If still happening, check server logs for actual timeout errors

### **Issue: Second sync after clear shows "cached data"**
**Symptoms:** Clear works, but second sync still throttled

**Debug Steps:**
1. Check console for cursor reset confirmation
2. Check server logs for `entraSignInLastSyncAt` being set correctly
3. Verify force flag is being passed

**Fix:**
- Cursor reset might not be working - check database
- Force flag not passed - check client-side code

### **Issue: Sync completes but shows 0 events**
**Symptoms:** Sync finishes successfully but no data appears

**Debug Steps:**
1. Check console for "events=0"
2. Verify cursor was reset to 24 hours ago
3. Check if Microsoft Graph has data in that timeframe

**Fix:**
- No data in last 24 hours (normal)
- Cursor not reset properly (check database)
- Graph API permissions missing (check Azure)

## 📊 **Debugging Checklist**

### **Client-Side Debugging:**
```javascript
// Check these in browser console:
console.log('Active syncs:', activeSyncs); // Should show Map
console.log('Sync poller:', syncStatusPoller); // Should show interval ID or null

// Manual status check:
fetch('/api/sync/status').then(r => r.json()).then(console.log);
```

### **Server-Side Debugging:**
```bash
# Check server logs for:
grep "\[SYNC-DEBUG\]" server.log
grep "entraSignInLastSyncAt" server.log
grep "cursor reset" server.log
```

### **Database Debugging:**
```sql
-- Check account sync state:
SELECT id, "entraSignInCursor", "entraSignInLastSyncAt"
FROM accounts WHERE id = 'your-account-id';

-- Check recent events:
SELECT COUNT(*) FROM "usageEvent" WHERE "accountId" = 'your-account-id';
SELECT COUNT(*) FROM "entraSignIn" WHERE "accountId" = 'your-account-id';
```

## 🧪 **Automated Test Script**

Run this in browser console to test all scenarios:

```javascript
async function runSyncTests() {
    console.log('🧪 Starting sync tests...');

    // Test 1: Populate data
    console.log('📝 Test 1: Populating test data...');
    await fetch('/api/test/populate-data', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({hoursBack: 2, eventCount: 10})
    });

    // Test 2: Clear data
    console.log('🗑️ Test 2: Clearing data...');
    await fetch('/api/usage?resetCursor=true&cursorHours=24', {method: 'DELETE'});

    // Test 3: Force sync
    console.log('🔄 Test 3: Running forced sync...');
    const syncResponse = await fetch('/api/usage/recent?awaitSync=true&force=true');
    const syncData = await syncResponse.json();
    console.log('Sync result:', syncData);

    console.log('✅ Tests completed - check console for [SYNC-DEBUG] logs');
}
runSyncTests();
```

## 🎯 **Quick Fixes**

### **If sync gets stuck:**
1. Click "🛑 Cancel Sync" button (appears during active sync)
2. Refresh page
3. Try sync again

### **If sync times out:**
- **Increased timeout**: Sync now waits up to 2 minutes per Graph API page (was 30 seconds)
- **Better messaging**: Users now see "Microsoft Graph sync may take up to 3 minutes"
- **Progress feedback**: Shows actual progress like "Fetched page 2 (14 events so far)"

### **If no progress updates:**
1. Check browser console for errors
2. Check network tab for failed requests
3. Restart server if needed

### **If cursor reset doesn't work:**
1. Check database directly
2. Verify DELETE endpoint parameters
3. Check server logs for cursor update confirmation

## 📞 **When to Escalate**

- If console shows no `[SYNC-DEBUG]` logs → Server connection issue
- If progress polling fails repeatedly → Network/API issue
- If cursor never resets → Database issue
- If Graph API calls fail → Permission/Azure configuration issue
