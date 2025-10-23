# ✅ Pre-Deployment Testing Checklist

Before deploying to Railway, test these features locally to ensure everything works.

---

## 🔐 **1. Authentication & Account Management**

### Test Signup
- [ ] Visit `http://localhost:3000/signup`
- [ ] Create a new account with unique email
- [ ] Verify you're auto-logged in after signup
- [ ] Check you land on Users page (default)

### Test Login/Logout
- [ ] Logout from your account
- [ ] Visit `http://localhost:3000/login`
- [ ] Login with your credentials
- [ ] Verify session persists (refresh page, still logged in)
- [ ] Logout again

### Test Multi-Tenant Isolation
- [ ] Create Account A (e.g., company-a@test.com)
- [ ] Import 3-5 users to Account A
- [ ] Logout
- [ ] Create Account B (e.g., company-b@test.com)
- [ ] Import 3-5 different users to Account B
- [ ] Verify Account B only sees their own users (not Account A's)
- [ ] Login as Account A again
- [ ] Verify Account A still has only their own users

---

## 👥 **2. Users Page (Default Landing)**

### CSV Import
- [ ] Click "Upload CSV" or drag-drop a CSV file
- [ ] Use CSV with headers: `Email, First Name, Last Name, Admin Roles, User Groups, Team Products`
- [ ] Verify users appear in the table after upload
- [ ] Check success message shows correct count (e.g., "Imported 5 new users")
- [ ] Upload same CSV again to test updates
- [ ] Verify it shows "Updated X existing users"

**Test CSV Format:**
```csv
Email,First Name,Last Name,Admin Roles,User Groups,Team Products
john.doe@company.com,John,Doe,System,IT Team,Adobe Acrobat Pro
jane.smith@company.com,Jane,Smith,,Marketing,Creative Cloud Pro
```

### User Table
- [ ] Verify all imported users are displayed
- [ ] Check columns show: Email, First Name, Last Name, Licenses, Activity Count
- [ ] Test sorting (if implemented)
- [ ] Test search/filter (if implemented)

### Edit User
- [ ] Click edit button on a user
- [ ] Change first name and last name
- [ ] Click Save
- [ ] Verify changes are reflected in table
- [ ] Refresh page, verify changes persist

### Delete User
- [ ] Click delete button on a user
- [ ] Confirm deletion
- [ ] Verify user is removed from table
- [ ] Refresh page, verify user is still gone

---

## 📊 **3. Dashboard Page**

### Access Dashboard
- [ ] Navigate to `http://localhost:3000/dashboard`
- [ ] Verify page loads without errors
- [ ] Check for "Failed to load data" error (should NOT appear)

### Stat Cards
- [ ] Verify three stat cards display:
  - 💻 Desktop Apps: 0 (0 today)
  - 🔵 Web Apps: 0 (0 today)
  - 📈 This Week: 0 (0 unique clients)
- [ ] Cards should show "0" if no activity data yet

### Activity Tabs
- [ ] Click "Recent Activity" tab - should show "No activity yet"
- [ ] Click "Web Apps" tab - should show "No activity yet"
- [ ] Click "Desktop Apps" tab - should show "No activity yet"
- [ ] All tabs should load without JavaScript errors (check browser console)

---

## 🔑 **4. Account Page**

### Access Account Page
- [ ] Navigate to `http://localhost:3000/account` or click "Account" in nav
- [ ] Verify page loads

### Account Information
- [ ] Check organization name is displayed
- [ ] Check email is displayed
- [ ] Check account created date is shown

### API Key Section
- [ ] Verify API key is displayed (UUID format)
- [ ] Click "Copy" button (if exists)
- [ ] Copy API key for later testing

### API Key Regeneration
- [ ] Click "Regenerate API Key" button
- [ ] Confirm regeneration
- [ ] Verify new API key is different
- [ ] Note: Old API key should no longer work

---

## 📥 **5. Downloads**

### PowerShell Script Download
- [ ] From Account page, click "Download Adobe Monitor Script"
- [ ] Verify file downloads: `Monitor-AdobeUsage.ps1`
- [ ] Open the file in text editor
- [ ] **Critical Check:** Verify your API key is embedded in the script
  - Look for: `$API_KEY = "your-actual-api-key-here"`
- [ ] Verify API URL points to localhost (for local testing)
  - Look for: `$API_URL = "http://localhost:3000/api/track"`

### Chrome Extension Download
- [ ] From Account page, click "Download Extension"
- [ ] Verify file downloads: `adobe-usage-sensor.zip`
- [ ] Extract the ZIP file
- [ ] Verify it contains:
  - `manifest.json`
  - `background.js`
  - `options.html`
  - `options.js`
  - `icon128.png`
- [ ] **No README.md** (should be excluded from zip)

---

## 🔌 **6. API Endpoints**

### Test Tracking API (PowerShell)
Open PowerShell and run:

```powershell
# Replace with your actual API key from Account page
$apiKey = "your-api-key-here"

# Test data
$body = @{
    username = $env:USERNAME
    appName = "Adobe Acrobat"
    source = "desktop"
    computerName = $env:COMPUTERNAME
} | ConvertTo-Json

# Send to API
Invoke-RestMethod -Uri "http://localhost:3000/api/track" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $apiKey"
        "Content-Type" = "application/json"
    } `
    -Body $body
```

**Expected Result:** Should return `{ "success": true }` or similar

- [ ] Test returns success (no errors)
- [ ] Go to Dashboard, verify activity appears
- [ ] Check stat cards update (Desktop Apps should increase)
- [ ] Check "Recent Activity" tab shows the event
- [ ] Check "Desktop Apps" tab shows the event

### Test with Wrong API Key
```powershell
$wrongApiKey = "wrong-key-12345"

Invoke-RestMethod -Uri "http://localhost:3000/api/track" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $wrongApiKey"
        "Content-Type" = "application/json"
    } `
    -Body $body
```

- [ ] Should return 401 Unauthorized error
- [ ] Should NOT add activity to dashboard

### Test Web Activity
```powershell
$body = @{
    event = "adobe_web_login_detected"
    url = "https://acrobat.adobe.com"
    source = "web"
    clientId = "test-client-123"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/track" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $apiKey"
        "Content-Type" = "application/json"
    } `
    -Body $body
```

- [ ] Test returns success
- [ ] Go to Dashboard, verify Web Apps count increases
- [ ] Check "Web Apps" tab shows the event

---

## 🧪 **7. Data Persistence**

### Test Database Persistence
- [ ] Send 5-10 test events via API
- [ ] Verify they appear in Dashboard
- [ ] Stop the server (`Ctrl+C`)
- [ ] Restart the server (`npm start`)
- [ ] Login again
- [ ] Verify all users still exist
- [ ] Verify all activity still shows in Dashboard
- [ ] **All data should persist** (stored in PostgreSQL)

---

## 🔒 **8. Security & Authorization**

### Test Protected Routes (Without Login)
Open an incognito/private browser window:

- [ ] Visit `http://localhost:3000/` → Should redirect to `/login`
- [ ] Visit `http://localhost:3000/dashboard` → Should redirect to `/login`
- [ ] Visit `http://localhost:3000/account` → Should redirect to `/login`
- [ ] Visit `http://localhost:3000/users` → Should redirect to `/login`

**All pages should be protected!**

### Test Session Timeout
- [ ] Login to your account
- [ ] Wait 10+ minutes without activity
- [ ] Try to navigate to another page
- [ ] **Note:** Session expires after 7 days by default

---

## 🎨 **9. UI/UX Testing**

### Navigation
- [ ] From any page, click "Users" in nav → Goes to Users page
- [ ] Click "Dashboard" → Goes to Dashboard
- [ ] Click "Account" → Goes to Account page
- [ ] Click "Logout" → Logs out and redirects to login

### Responsive Design
- [ ] Test on full desktop screen (looks good)
- [ ] Resize browser to tablet size (≈768px wide)
- [ ] Resize to mobile size (≈375px wide)
- [ ] **All pages should be readable and functional**

### Browser Console
- [ ] Open browser DevTools (F12)
- [ ] Check Console tab for JavaScript errors
- [ ] Navigate through all pages
- [ ] **Should have NO red errors**
- [ ] Prisma query logs are OK (those are server-side)

---

## 📊 **10. Edge Cases & Error Handling**

### Empty States
- [ ] Login to brand new account (no data)
- [ ] Verify Users page shows "No users yet" or similar
- [ ] Verify Dashboard shows zeros (not errors)
- [ ] Verify Account page loads properly

### Invalid CSV Upload
- [ ] Try uploading a .txt file (should reject)
- [ ] Try CSV with wrong headers (should show error)
- [ ] Try empty CSV (should show error)
- [ ] Try CSV with missing Email column (should show error)

### Invalid API Requests
- [ ] Send API request without Authorization header
- [ ] Send API request with malformed JSON
- [ ] Send API request to wrong account
- [ ] **All should return appropriate error messages**

---

## 🗄️ **11. Database Health Check**

### Check PostgreSQL Connection
```powershell
# In SubTracker folder
npm run db:studio
```

- [ ] Prisma Studio opens in browser
- [ ] Can see `accounts` table with your test accounts
- [ ] Can see `users` table with imported users
- [ ] Can see `usage_events` table (may be empty if no API calls yet)
- [ ] Can see `session` table with active sessions

### Verify Data Isolation
- [ ] In Prisma Studio, check `users` table
- [ ] Each user has `accountId` field
- [ ] Users from Account A have different `accountId` than Account B
- [ ] **No user should be shared between accounts**

---

## 🚀 **12. Environment Configuration**

### Check .env File
Open `SubTracker/.env` and verify:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/subtracker?schema=public
SESSION_SECRET=<should-be-a-long-random-string>
PORT=3000
NODE_ENV=development
ENABLE_AZURE_SYNC=false
```

- [ ] `DATABASE_URL` is correct
- [ ] `SESSION_SECRET` is unique (not the default)
- [ ] `NODE_ENV=development` for local testing
- [ ] No hardcoded production URLs

---

## ✅ **Summary Checklist**

Before deploying to Railway, verify:

- [ ] ✅ **Authentication works** (signup, login, logout, multi-tenant)
- [ ] ✅ **CSV import works** (users appear after upload)
- [ ] ✅ **Dashboard loads** (no "Failed to load data" error)
- [ ] ✅ **Account page shows API key**
- [ ] ✅ **PowerShell script downloads** with embedded API key
- [ ] ✅ **Chrome extension downloads** as .zip
- [ ] ✅ **API tracking works** (test with PowerShell)
- [ ] ✅ **Activity appears in dashboard** after API calls
- [ ] ✅ **Data persists** after server restart
- [ ] ✅ **Protected routes redirect to login**
- [ ] ✅ **Multi-tenant isolation** (Account A can't see Account B's data)
- [ ] ✅ **No JavaScript errors** in browser console
- [ ] ✅ **PostgreSQL running** and database accessible

---

## 📝 **Known Issues to Fix Before Deploy**

If you encounter these, fix them before deploying:

### Dashboard Issues:
- ❌ "Failed to load data" → API endpoints `/api/stats` and `/api/usage/recent` missing
- ❌ Stats show NaN or undefined → Check API response format

### CSV Upload Issues:
- ❌ "DOCTYPE not valid JSON" → `/api/users/import` endpoint missing
- ❌ Users don't appear → Check database `createUser` function
- ❌ Headers not recognized → CSV parser needs to normalize header names

### Download Issues:
- ❌ PowerShell script has placeholder API key → Check script generator
- ❌ Extension download fails → Check `archiver` dependency installed
- ❌ API URL is wrong → Check `process.env.API_URL` or host detection

### API Issues:
- ❌ 401 Unauthorized with correct key → Check Authorization header format
- ❌ Activity doesn't appear → Check `source` field mapping (web/desktop)
- ❌ Wrong account receives data → Check `accountId` in API tracking

---

## 🎉 **Ready for Deployment?**

Once all checkboxes are ✅ checked, you're ready to:

1. **Commit to Git**
2. **Push to GitHub**
3. **Deploy to Railway**

**See `DEPLOYMENT-GUIDE.md` for Railway deployment steps!**

---

## 🛟 **Need Help?**

If any tests fail:
1. Check the terminal for error messages
2. Check browser console (F12) for JavaScript errors
3. Check PostgreSQL is running (`docker ps`)
4. Restart server and try again
5. Check the code changes made in this session

**All features should work locally before deploying!**


