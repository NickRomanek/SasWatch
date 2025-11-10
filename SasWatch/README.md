# SasWatch - Microsoft Graph API License Tracking

A web application that integrates with Microsoft Graph API to track user login logs and manage SaaS product licenses.

## Features

- **User Management**: List all active users from Azure AD
- **Microsoft 365 License Reading**: View actual M365 licenses assigned to users via Graph API
- **License Assignment**: Assign custom SaaS products to users
- **Login Tracking**: Monitor user login activity via sign-in logs
- **Advanced Filtering**: Filter users by inactivity periods (30, 60, 90 days) and license types
- **License Analytics**: Track license usage and identify unused licenses
- **Web Interface**: Modern, responsive dashboard for comprehensive license management

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Azure AD App Registration**
   - Go to Azure Portal > Azure Active Directory > App registrations
   - Create a new registration
   - Add the following API permissions:
     - `User.Read.All` (Application)
     - `AuditLog.Read.All` (Application)
     - `Directory.Read.All` (Application)
     - `Organization.Read.All` (Application) - for reading M365 licenses
   - Generate a client secret
   - Copy the client ID, client secret, and tenant ID

3. **Environment Configuration**
   ```bash
   cp env.example .env
   ```
   Update the `.env` file with your Azure AD credentials.

4. **Run the Application**
   ```bash
   npm start
   ```

5. **Access the Application**
   Open http://localhost:3000 in your browser.

## API Permissions Required

- `User.Read.All`: Read user profiles and license assignments
- `AuditLog.Read.All`: Read sign-in logs and audit data
- `Directory.Read.All`: Read directory data
- `Organization.Read.All`: Read organization info and M365 license subscriptions

## Usage

1. **Authentication**: The app will redirect you to Microsoft for authentication
2. **User List**: View all users in your organization
3. **License Assignment**: Assign SaaS products to users
4. **Activity Tracking**: View user login activity and filter by inactivity periods

---

## 🔐 Azure Security Group Sync (NEW)

SasWatch now includes automated Azure security group management based on Adobe license activity. This feature enables intelligent license optimization by automatically moving inactive users to different security groups for targeted Intune deployment.

### Overview

The Azure Sync feature:
- Creates and manages Entra (Azure AD) security groups
- Automatically classifies users as Active or Inactive based on usage data
- Integrates with Microsoft Intune for automated script deployment
- Provides scheduled auto-sync or manual control
- Tracks sync history and results

### Prerequisites

#### 1. Azure App Permissions

Your Azure AD app registration needs these **Application permissions**:
- ✅ `Group.ReadWrite.All` - Create/manage security groups
- ✅ `User.Read.All` - Read user information
- ✅ `AuditLog.Read.All` - Read audit logs (existing)
- ✅ `Directory.Read.All` - Read directory data (existing)

**Important:** After adding permissions, click **"Grant admin consent"** in the Azure Portal.

#### 2. Adobe Users Imported

Before using Azure Sync:
1. Export users from Adobe Admin Console (CSV format)
2. Import the CSV via SasWatch's Users page
3. Ensure activity tracking is collecting data

### Setup Guide

#### Step 1: Configure Settings

1. Navigate to the **Users** page in SasWatch
2. Find the **☁️ Azure Security Group Sync** section
3. Configure:
   - **Inactive Threshold**: Number of days without activity to mark as inactive (default: 90)
   - **Auto-Sync**: Enable automatic weekly syncs (runs every Sunday at midnight)
4. Click **💾 Save Settings**

#### Step 2: Create Active Users Group

1. Enter a group name (e.g., `Adobe-Active-Users`)
2. Click **➕ Create Active Group**
3. The system will:
   - Create a security group in Azure AD
   - Add all imported Adobe users to the group
   - Save the group ID to configuration

**Intune Integration**: Configure Intune to deploy `Deploy-AdobeMonitor.ps1` to this group.

#### Step 3: Create Inactive Users Group

1. Enter a group name (e.g., `Adobe-Inactive-Users`)
2. Click **➕ Create Inactive Group**
3. An empty security group is created (users will be moved here later)

**Intune Integration**: Configure Intune to deploy `Uninstall-AdobeMonitor.ps1` to this group.

#### Step 4: Move Inactive Users

After collecting usage data (recommended: 60-90 days):

1. Click **👁️ Preview Inactive Users** to see who would be moved
2. Review the list of inactive users and their last activity dates
3. Click **↗️ Move to Inactive Group** to execute the move
4. Users are:
   - Removed from Active group
   - Added to Inactive group
   - Intune automatically deploys uninstall script

### Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Export Adobe Users → Import to SasWatch               │
│ 2. Create "Active" Security Group → Add all licensed users │
│ 3. Intune deploys Monitor script to Active group           │
│ 4. Collect activity data (60-90 days)                      │
│ 5. Create "Inactive" Security Group                        │
│ 6. Move inactive users to Inactive group (manual/auto)     │
│ 7. Intune deploys Uninstall script to Inactive group       │
│ 8. Review license reclamation candidates                   │
└─────────────────────────────────────────────────────────────┘
```

### Manual vs. Automatic Sync

#### Manual Sync
- Full control over when users are moved
- Review preview before moving
- Best for initial setup or when making major changes

#### Automatic Sync
- Runs every Sunday at midnight (configurable via `autoSyncSchedule` in config)
- Automatically moves users exceeding inactive threshold
- Results logged to sync history
- Ideal for ongoing maintenance

### Configuration File

Settings are stored in `SasWatch/data/azure-sync-config.json`:

```json
{
  "inactiveDaysThreshold": 90,
  "activeGroupId": "group-id-here",
  "inactiveGroupId": "group-id-here",
  "autoSyncEnabled": false,
  "autoSyncSchedule": "0 0 * * 0",
  "lastSyncDate": "2024-01-15T00:00:00.000Z",
  "lastSyncResults": {
    "date": "2024-01-15T00:00:00.000Z",
    "movedCount": 12,
    "errors": [],
    "auto": true
  }
}
```

### API Endpoints

The following endpoints are available for automation:

- `GET /api/azure/test-connection` - Test Graph API permissions
- `GET /api/azure/config` - Get current configuration
- `PUT /api/azure/config` - Update configuration
- `POST /api/azure/groups/create-active` - Create active users group
- `POST /api/azure/groups/create-inactive` - Create inactive users group
- `GET /api/azure/users/preview-inactive` - Preview inactive users
- `POST /api/azure/users/move-inactive` - Move inactive users

### Intune Deployment Setup

#### For Active Group (Deploy Monitor)

1. Go to **Intune > Devices > Windows > PowerShell scripts**
2. Click **Add**
3. Upload `scripts/Deploy-AdobeMonitor.ps1`
4. Assign to security group: `Adobe-Active-Users`
5. Configure:
   - Run as: **System**
   - Run script in 64-bit: **Yes**
   - Enforcement: **Required**

#### For Inactive Group (Deploy Uninstall)

1. Go to **Intune > Devices > Windows > PowerShell scripts**
2. Click **Add**
3. Upload `scripts/Uninstall-AdobeMonitor.ps1`
4. Assign to security group: `Adobe-Inactive-Users`
5. Configure:
   - Run as: **System**
   - Run script in 64-bit: **Yes**
   - Enforcement: **Required**

### Best Practices

1. **Initial Data Collection**: Wait 60-90 days before moving users to ensure accurate activity data
2. **Review Before Moving**: Always preview inactive users before executing the move
3. **Gradual Rollout**: Start with a small test group before organization-wide deployment
4. **Grace Period**: Use 90+ days threshold to avoid false positives (vacations, sabbaticals)
5. **Communication**: Notify users before removing licenses
6. **Regular Reviews**: Check sync history weekly to monitor trends

### Troubleshooting

#### Connection Status Shows Disconnected

1. Verify Azure app permissions are granted
2. Check `.env` file has correct `CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`
3. Ensure admin consent was granted in Azure Portal
4. Check network connectivity to Microsoft Graph API

#### Users Not Moving to Inactive Group

1. Verify both groups are created
2. Check that users exist in Azure AD with matching emails
3. Review last sync results for specific error messages
4. Ensure inactive threshold is correctly configured

#### Rate Limiting Errors

The system includes 100ms delays between API calls. If you still encounter rate limiting:
- Reduce the number of users being processed
- Run sync during off-peak hours
- Contact Microsoft support to increase limits

### Security Considerations

- All API calls use Application permissions (no user context required)
- Group membership changes are logged to Azure AD audit logs
- Sync results are stored locally in `azure-sync-config.json`
- Consider implementing additional approval workflows for license removal

---

## License Optimization ROI

**Example Scenario:**
- 500 Adobe licenses @ $60/user/month = $30,000/month
- 30% inactive (150 users) identified by SasWatch
- **Potential savings: $108,000/year**

SasWatch helps you:
✅ Identify unused licenses
✅ Automate monitoring deployment
✅ Track usage over time
✅ Make data-driven license decisions