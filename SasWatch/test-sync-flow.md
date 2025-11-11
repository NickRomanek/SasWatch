# Sync Flow Test Plan

## Current Flow:
1. User clicks "🔄 Sync" button on activity page
2. Calls `startManualSync()` in app.js
3. Calls `refreshData({ awaitSync: true, force: true })`
4. Makes request to `/api/usage/recent?awaitSync=true&force=true&limit=100`
5. Server calls `db.syncEntraSignInsIfNeeded(accountId, {force: true})`
6. Returns data and sync metadata

## Issues to Check:
- [ ] Is the API endpoint receiving the request?
- [ ] Is the force flag being passed correctly?
- [ ] Is the sync actually running?
- [ ] Is the status polling working?
- [ ] Are the toast notifications showing?

## Test Steps:
1. Add test data
2. Click sync button
3. Check console for [SYNC-DEBUG] logs
4. Check server logs
5. Verify data appears

