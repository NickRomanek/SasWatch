# SasWatch Setup Guide

## ⚙️ Prerequisites

### Required Software
- **Node.js 18+** - [Download](https://nodejs.org)
- **npm** (included with Node.js)
- **Windows/Mac/Linux** - Any OS supported by Node.js

### Check Your Installation
```bash
node --version   # Should be v18.0 or higher
npm --version    # Should be v8.0 or higher
```

---

## ⚠️ Important Note

**Microsoft Graph API features are currently disabled** in this version of SasWatch. The application currently focuses on tracking Adobe usage data from:
- Browser extension (web Adobe apps)
- Desktop wrapper (Adobe Reader/Acrobat)

The Azure AD integration sections below are for reference if you want to re-enable Graph API features in the future.

---

## 🚀 Quick Setup (Current Version)

### 1. Install Dependencies
```bash
cd SasWatch
npm install
```

### 2. Start the Application
```bash
node server.js
```

### 3. Access the UI
Open http://localhost:3000 in your browser

That's it! The current version doesn't require Azure AD setup.

---

## 📚 Azure AD App Registration Setup (Optional / Future Use)

**Note:** This section is for reference only. The current version has Graph API features disabled.

If you want to re-enable Microsoft Graph API integration for user management and M365 license tracking, follow these steps:

### Step 1: Create App Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Fill in the details:
   - **Name**: `SasWatch`
   - **Supported account types**: `Accounts in this organizational directory only`
   - **Redirect URI**: Leave blank for now
5. Click **Register**

### Step 2: Configure API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Application permissions** (not Delegated)
5. Add the following permissions:
   - `User.Read.All` - Read all users' full profiles
   - `AuditLog.Read.All` - Read all audit log data
   - `Directory.Read.All` - Read directory data
6. Click **Add permissions**
7. Click **Grant admin consent** (requires admin privileges)

### Step 3: Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description: `SasWatch Secret`
4. Choose expiration: `24 months` (or your preference)
5. Click **Add**
6. **IMPORTANT**: Copy the secret value immediately (you won't be able to see it again)

### Step 4: Get Required Information

From your app registration overview page, copy:
- **Application (client) ID**
- **Directory (tenant) ID**
- **Client Secret** (from step 3)

### Step 5: Configure Environment

1. Copy `env.example` to `.env`:
   ```bash
   cp env.example .env
   ```

2. Update `.env` with your values:
   ```
   CLIENT_ID=your_application_client_id
   CLIENT_SECRET=your_client_secret_value
   TENANT_ID=your_directory_tenant_id
   REDIRECT_URI=http://localhost:3000/auth/callback
   PORT=3000
   NODE_ENV=development
   ```

## Installation & Running (Current Version)

### Prerequisites
- **Node.js 18+** installed
- **npm** package manager (included with Node.js)
- **No Azure AD required** for current simplified version

### Install Dependencies
```bash
cd SasWatch
npm install
```

### Start the Application
```bash
node server.js
```

Or use the convenience script from project root:
```cmd
start.bat
```

## Usage

1. Open http://localhost:3000 in your browser
2. View tracked Adobe usage data from:
   - Browser extension activity (web apps)
   - Desktop wrapper activity (Adobe Reader)
3. Features available:
   - Real-time usage statistics
   - Recent activity feed
   - Filter by source (Adobe/Wrapper)
   - Dark/light theme toggle
   - Export and clear data

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors**
   - Run `npm install` in the SasWatch directory
   - Ensure Node.js is properly installed

2. **"Port already in use" error**
   - Another application is using port 3000
   - Stop it with: `start.bat stop`
   - Or change the port in server.js

3. **No data showing up**
   - Ensure receiver is running on port 8080
   - Check browser extension is loaded and active
   - Verify wrapper is properly configured
   - Click "Refresh" button in UI

4. **Browser extension not tracking**
   - Reload the extension in chrome://extensions
   - Check service worker console for errors
   - Ensure you're visiting actual Adobe sites

### API Permission Requirements

The application requires these Microsoft Graph API permissions:

| Permission | Type | Description |
|------------|------|-------------|
| User.Read.All | Application | Read all users' full profiles |
| AuditLog.Read.All | Application | Read sign-in logs and audit data |
| Directory.Read.All | Application | Read directory data |

### Security Notes

- Never commit the `.env` file to version control
- Rotate client secrets regularly
- Use application permissions (not delegated) for server-to-server authentication
- Consider using Azure Key Vault for production deployments

## Features (Current Version)

### Usage Tracking
- Track Adobe web app usage (via browser extension)
- Track Adobe Reader launches (via desktop wrapper)
- Real-time activity monitoring
- Persistent data storage

### Dashboard
- Usage statistics by source
- Recent activity feed with timestamps
- Unique client tracking
- Today/week activity counts

### Data Management
- View all tracked events
- Filter by source (Adobe/Wrapper)
- Clear data functionality
- Auto-refresh capability

### User Interface
- Dark/light theme toggle
- Responsive design
- Real-time updates
- Clean, modern UI

### Future Features (when Graph API re-enabled)
- User management
- M365 license assignment
- Sign-in log analysis
- Inactivity reporting
