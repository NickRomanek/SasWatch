# SasWatch - Adobe License Management Application

The core application for SasWatch, a multi-tenant platform for tracking Adobe Creative Cloud license usage across organizations.

## Features

- **Adobe Usage Tracking**: Monitor Adobe Creative Cloud application usage via PowerShell scripts and Chrome extension
- **Multi-Tenant Platform**: Serve multiple organizations with complete data isolation
- **User Import**: Import users from Microsoft Entra (Azure AD) or Adobe CSV reports
- **Usage Analytics**: Track who's using Adobe applications and how often
- **License Optimization**: Identify inactive users and optimize license allocation
- **PowerShell Script Generation**: Auto-generate monitoring scripts with embedded API keys
- **Intune Integration**: Deploy monitoring via Microsoft Intune
- **Chrome Extension**: Track Adobe web application usage

## Setup

See the main [README.md](../README.md) and [START-HERE.md](../START-HERE.md) for complete setup instructions.

### Quick Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   ```bash
   cp env.example .env
   ```
   Update the `.env` file with your configuration (see `env.example` for all options).

3. **Database Setup**
   ```bash
   npm run db:generate
   npm run db:push
   ```

4. **Run the Application**
   ```bash
   npm start
   ```

5. **Access the Application**
   Open http://localhost:3000 in your browser.

## Microsoft Entra (Azure AD) Integration (Optional)

To enable user import from Microsoft Entra:

1. **Azure AD App Registration**
   - Go to Azure Portal > Azure Active Directory > App registrations
   - Create a new registration
   - Add the following API permissions (Application permissions):
     - `User.Read.All` - Read user profiles
     - `Directory.Read.All` - Read directory data
     - `Group.ReadWrite.All` - For Azure security group sync (optional)
   - Generate a client secret
   - Copy the client ID, client secret, and tenant ID

2. **Configure Environment Variables**
   ```env
   CLIENT_ID=your_azure_ad_client_id
   CLIENT_SECRET=your_azure_ad_client_secret
   TENANT_ID=your_azure_ad_tenant_id
   ```

3. **Use in Application**
   - Import users from Entra via the Users page
   - Sync user data from your Azure AD directory

## Adobe Report Import

You can also import users from Adobe Admin Console:

1. Export users from Adobe Admin Console as CSV
2. Use the CSV import feature in the Users page
3. Users are imported with their license information

---

## 🔐 Azure Security Group Sync

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