# Folder Structure Guide

## 📁 What Each Folder Does

### ✅ **SubTracker/** (Main Application)
**Status:** ✅ Active - Multi-tenant SaaS platform

**What it is:**
- Main Node.js/Express application
- Multi-tenant with authentication
- PostgreSQL database
- API endpoints for usage tracking
- Dashboard for viewing Adobe usage

**Deploy this:** Yes - This is your production application

---

### ✅ **extension/** (Chrome Extension)
**Status:** ✅ Active - Multi-tenant compatible

**What it is:**
- Chrome browser extension
- Tracks Adobe web usage (browser-based)
- Sends data to SubTracker API with API key
- Users configure their organization's API key

**Deploy this:** Yes - Distribute to users' Chrome browsers

**How users get it:**
1. You provide the extension files
2. Users load in Chrome (Developer mode)
3. They configure with their API key from SubTracker
4. OR: Package and deploy via Chrome Web Store / Google Workspace

---

### ✅ **scripts/** (Reference Scripts)
**Status:** ⚠️  Reference/Template Only

**What it is:**
- PowerShell monitoring scripts (templates)
- Deployment helpers for Intune
- Start/stop server scripts (legacy)

**Important:** 
- PowerShell scripts are now **dynamically generated** by SubTracker
- Users download pre-configured scripts from their account
- These files are templates/reference only
- **Do not distribute these directly to users**

**What users actually use:**
- Go to SubTracker → Account Settings
- Click "Download Monitoring Script"
- Get script with their API key embedded
- Deploy that script, not these templates

---

### ❌ **receiver/** (Obsolete)
**Status:** ❌ Deprecated - Completely replaced

**What it was:**
- Standalone receiver server for usage data
- Separate from main app
- Single-tenant architecture

**Why obsolete:**
- Replaced by `server-multitenant-routes.js`
- API endpoint now built into SubTracker
- No longer needed

**Action:** Excluded from git (in .gitignore)

---

## 🚀 Deployment Checklist

### For Production Deployment:

1. **SubTracker/** → Deploy to Railway
   - This is your main application
   - Handles authentication, database, API, dashboard
   - Users sign up here

2. **extension/** → Distribute to users
   - Package as .zip or .crx
   - Upload to Chrome Web Store (optional)
   - OR distribute as unpacked extension
   - Users configure with their API key

3. **scripts/** → Do NOT distribute
   - These are templates only
   - Users get scripts from SubTracker dashboard
   - Scripts are auto-generated with API keys

4. **receiver/** → Ignore
   - Not needed anymore
   - Already excluded from git

---

## 📊 Data Flow

```
Employee's Computer:
├── PowerShell Script (from SubTracker download)
│   └── Monitors: Acrobat.exe, Photoshop.exe, etc.
│   └── Sends to: SubTracker API with API key
│
└── Chrome Extension (optional)
    └── Monitors: adobe.com sites
    └── Sends to: SubTracker API with API key

                    ↓ ↓ ↓

SubTracker (Railway):
└── /api/track endpoint
    └── Validates API key
    └── Saves to PostgreSQL (account-scoped)
    └── Displays in dashboard
```

---

## 🔑 How API Keys Work

### Each Organization Gets:
1. Unique API key (UUID)
2. Completely isolated data
3. Custom monitoring scripts with embedded key
4. Chrome extension configured with their key

### Security:
- API key required for all usage tracking
- Each key only accesses that organization's data
- Keys can be regenerated anytime
- Old scripts stop working when key regenerated

---

## 📝 What Users Download

### From SubTracker Dashboard:

**1. PowerShell Monitoring Script**
```powershell
# Auto-generated, includes:
$API_KEY = "their-unique-key-here"
$API_URL = "https://your-app.railway.app/api/track"
# Rest of monitoring logic
```

**2. Chrome Extension Configuration**
- Extension files (you provide)
- They configure with their API key
- Works in their browser only

---

## ⚙️ Development Workflow

### Working Locally:

```bash
# 1. Start SubTracker
cd SubTracker
npm start

# 2. Test Chrome Extension
# Load extension in chrome://extensions/
# Configure with localhost:3000 and test API key

# 3. Test PowerShell Script
# Download from http://localhost:3000/account
# Run on your Windows machine
```

---

## 🗂️ Git Repository Structure

```
abowdyV4/
├── SubTracker/              ✅ Main app (INCLUDE)
│   ├── lib/                 ✅ Core logic
│   ├── views/               ✅ Templates
│   ├── prisma/              ✅ Database schema
│   └── server.js            ✅ Main server
│
├── extension/               ✅ Chrome extension (INCLUDE)
│   ├── background.js        ✅ Multi-tenant compatible
│   ├── options.html         ✅ Configuration page
│   └── manifest.json        ✅ Extension manifest
│
├── scripts/                 ✅ Reference only (INCLUDE)
│   ├── Monitor-AdobeUsage.ps1    ⚠️  Template only
│   └── Deploy-AdobeMonitor.ps1   ✅ Deployment helper
│
├── receiver/                ❌ Obsolete (EXCLUDE via .gitignore)
│
├── README.md                ✅ Project overview
├── START-HERE.md            ✅ Quick start
├── DEPLOYMENT-GUIDE.md      ✅ Complete guide
└── FOLDER-GUIDE.md          ✅ This file
```

---

## 💡 Common Questions

### Q: Why keep scripts/ if they're templates?
**A:** They're useful reference and contain deployment helpers. Just don't distribute them directly to users.

### Q: Should users modify the extension?
**A:** No - they just configure it with their API key. One extension works for all organizations.

### Q: What if I want to customize the PowerShell script?
**A:** Edit `SubTracker/lib/script-generator.js` - it generates the scripts dynamically.

### Q: Can I delete receiver/?
**A:** Yes, it's completely obsolete. Already excluded from git.

### Q: Do I need to deploy scripts/ separately?
**A:** No - scripts are generated by SubTracker and downloaded by users from their dashboard.

---

## 🎯 Summary

**Deploy to Production:**
1. ✅ SubTracker/ (Railway)
2. ✅ extension/ (Chrome Web Store or direct distribution)

**Users Download:**
1. PowerShell script from SubTracker dashboard (auto-generated with their API key)
2. Chrome extension from you (they configure with their API key)

**Keep as Reference:**
1. scripts/ (templates and helpers)

**Ignore:**
1. receiver/ (obsolete)

---

**Questions?** See `DEPLOYMENT-GUIDE.md` for complete setup instructions.

