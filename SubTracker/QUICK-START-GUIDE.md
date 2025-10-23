# SubTracker Enhanced - Quick Start Guide

## 🚀 Getting Started

Your SubTracker application is now running with all the new enhancements!

### Access the Application
**URL**: http://localhost:3000

---

## 📍 Navigation Overview

### Top Navigation Bar
- **Dashboard** 📊 - Overview and analytics
- **Users & Licenses** 👥 - Detailed user management  
- **App Activity** 📱 - Application usage statistics

---

## 1️⃣ Dashboard Tab

### What You'll See
- **6 Stat Cards** at the top:
  - Total Users (with trend)
  - Licensed Users (with percentage)
  - Inactive 30+ Days (clickable)
  - Inactive 60+ Days (clickable)
  - Inactive 90+ Days (clickable)
  - MFA Status (percentage enabled)

- **2 Charts**:
  - License Distribution (doughnut chart)
  - Activity Trend (last 7 days line chart)

- **Recent Sign-Ins Table**:
  - Last 10 authentication events
  - Shows user, app, time, location, status

### Quick Actions
- **Click any "Inactive" card** → Automatically switches to Users tab with filter applied
- **Refresh Dashboard** → Click refresh button to reload all data

---

## 2️⃣ Users & Licenses Tab

### Filters Available
1. **Search**: Type name or email
2. **Activity Filter**: All Users, Inactive 30/60/90 days
3. **License Status**: All, Licensed, Unlicensed, M365 Only, Custom Only
4. **M365 License Type**: Filter by specific Microsoft 365 licenses
5. **Refresh**: Reload user data

### User Table Columns
- **User**: Avatar with initials + name
- **Email**: User principal name
- **Status**: Active/Inactive badge
- **Last Sign-In**: "X days ago" format
- **Apps (7 days)**: Icons of recently used apps
- **Assigned Licenses**: 
  - 🟢 Green badges = M365 licenses
  - 🔵 Blue badges = Custom SaaS licenses
- **Actions**: 
  - 👁️ View Details
  - ➕ Assign License
  - 🗑️ Remove License (if has custom licenses)

### Visual Indicators
- **Green left border** = User active in last 30 days
- **Red left border** = User inactive 30+ days

### User Actions

#### View User Details
1. Click the **eye icon** (👁️) on any user
2. Side drawer slides in from right showing:
   - User profile and stats
   - All M365 licenses
   - All custom SaaS licenses
   - Recent sign-in history (last 10 events)
3. Click overlay or X to close

#### Assign Custom License
1. Click **green + button** on user row (pre-selects user)
   OR click **"+ Assign License"** in header
2. Select user (if not pre-selected)
3. Enter SaaS product name (e.g., "Adobe Creative Cloud")
4. Optionally select assignment date
5. Click **"Assign License"**

#### Remove Custom Licenses
1. Click **red trash icon** on users with custom licenses
2. Confirm removal
3. All custom licenses for that user are removed
   (M365 licenses cannot be removed via this app)

---

## 3️⃣ App Activity Tab

### What You'll See
Table showing all applications accessed in your organization:

| Column | Description |
|--------|-------------|
| **Application** | App name with icon |
| **Active Users** | Count + percentage bar |
| **Total Sign-Ins** | Aggregated sign-in count |
| **Last Activity** | Relative time since last use |
| **Trend** | 📈 Up, 📉 Down, or ━ Stable |
| **Actions** | Details button |

### Time Filter
- Dropdown at top-right: Last 7, 30, or 90 days
- Change filter and click **Refresh** to reload

### Use Cases
- **Identify unused apps**: Look for low active user counts
- **License optimization**: Find apps with few users but many licenses
- **Adoption tracking**: See which apps are growing
- **Activity monitoring**: Check last activity dates

---

## 💡 Pro Tips

### Dashboard
- **Trend Indicators**: The "+2 this week" and percentages give quick insights
- **Clickable Cards**: Use inactive cards to quickly navigate and filter
- **Charts**: Visual at-a-glance understanding of your license distribution

### Users & Licenses
- **Combine Filters**: Use multiple filters together (e.g., "M365 Only" + "Inactive 60+ Days")
- **Relative Time**: Hover over relative times to see exact timestamps
- **App Icons**: Show what tools users are actually using
- **Drawer**: Keep drawer open while browsing - click another user to switch

### App Activity
- **Sort by Active Users**: Already sorted to show most-used apps first
- **Look for Outliers**: Apps with high sign-ins but few users might indicate automation
- **Track Adoption**: Come back weekly to see trends over time

---

## 🔍 Common Workflows

### Find Users Wasting Licenses
1. Go to **Dashboard**
2. Click **"Inactive 90+ Days"** card
3. Review list of users with licenses but no activity
4. Click user's eye icon to see their licenses
5. Coordinate with user or remove custom licenses

### Assign License to New User
1. Go to **Users & Licenses**
2. Find user (search or scroll)
3. Click **green + button** on their row
4. Enter SaaS product name
5. Click **"Assign License"**

### Review User's Complete Activity
1. Go to **Users & Licenses**
2. Click **eye icon** on user
3. Drawer shows:
   - Sign-in frequency (last 30 days)
   - All licenses (M365 + Custom)
   - Recent activity log
4. Use this for:
   - Onboarding verification
   - Offboarding checklist
   - Security audits
   - License justification

### Analyze Application Usage
1. Go to **App Activity**
2. Review active user counts
3. Apps with < 50% active users might be candidates for license reduction
4. Click **Details** for more info (placeholder for future expansion)

---

## 🎨 Visual Guide

### Color Coding
- **Purple/Blue Gradients**: Navigation and primary actions
- **Green**: Active status, M365 licenses, success states
- **Blue**: Custom SaaS licenses, informational
- **Red**: Inactive users, removal actions, failures
- **Yellow/Orange**: Warning states (60-day inactive)

### Badge Meanings
- **Green "Active"**: Account enabled
- **Gray "Inactive"**: Account disabled
- **Green license badges**: Microsoft 365 licenses
- **Blue license badges**: Custom SaaS assignments

---

## ⚡ Keyboard Shortcuts (Future Enhancement)
*Currently all actions are point-and-click*

---

## 🔧 Troubleshooting

### Dashboard not loading?
- Check browser console (F12)
- Ensure Azure AD credentials are correct
- Verify API permissions are granted

### No recent sign-ins showing?
- Check if users have signed in recently
- Verify AuditLog.Read.All permission is granted
- Some tenants may have audit log retention limits

### Charts not displaying?
- Ensure Chart.js is loaded (check browser console)
- Refresh the page

### User drawer not opening?
- Check browser console for errors
- Try clicking different user
- Refresh page if needed

---

## 📊 Data Refresh

### Automatic Refresh
- Data does not auto-refresh (to reduce API calls)
- Click **Refresh** buttons to get latest data

### Refresh Locations
- **Dashboard**: Top right of Recent Sign-Ins section
- **Users & Licenses**: Filter section, far right
- **App Activity**: Top right next to time filter

---

## 🎯 Best Practices

1. **Daily**: Check Dashboard for overview
2. **Weekly**: Review App Activity to track usage
3. **Monthly**: Review Inactive Users and optimize licenses
4. **As Needed**: Assign licenses to new users
5. **Regular**: Audit user access via detail drawer

---

## 📞 Need Help?

- Check `UPGRADE-SUMMARY.md` for detailed feature list
- Check `README.md` for setup information
- Check `setup-guide.md` for Azure AD configuration

---

## 🎉 Enjoy Your Enhanced SubTracker!

You now have a powerful, professional license management tool at your fingertips!

