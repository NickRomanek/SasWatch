# SubTracker Multi-Tenant - Complete Deployment Guide

## 📖 Overview

SubTracker is a **multi-tenant SaaS platform** for tracking Adobe license usage. Multiple organizations can sign up, each with isolated data and unique API keys.

**Key Features:**
- 🔐 User authentication (signup/login)
- 🏢 Multi-tenant data isolation
- 🔑 Unique API keys per account
- 📊 Adobe usage tracking via PowerShell
- 📈 Usage analytics dashboard
- 🚀 Ready for Railway deployment

---

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- Node.js 16+ installed
- PostgreSQL (Docker or local)
- Git

### Step 1: Environment Setup

Create `.env` file in `SubTracker/` directory:

```env
# Database (Railway auto-provides in production)
DATABASE_URL=postgresql://localhost:5432/subtracker?schema=public

# Session Secret (generate random string)
SESSION_SECRET=your-super-secret-random-string-change-this-in-production

# API URL (for script generation)
API_URL=http://localhost:3000

# Server
PORT=3000
NODE_ENV=development

# Azure Sync (disabled by default)
ENABLE_AZURE_SYNC=false
```

**Generate SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 2: Install Dependencies

```bash
cd SubTracker
npm install
```

### Step 3: Start PostgreSQL

**Option A: Docker (Recommended)**
```bash
docker-compose up -d
```

**Option B: Local PostgreSQL**
- Install PostgreSQL 15+
- Create database: `createdb subtracker`
- Update DATABASE_URL in .env

### Step 4: Setup Database

```bash
# Generate Prisma Client
npm run db:generate

# Push schema to database
npm run db:push
```

### Step 5: Integrate Multi-Tenant Routes

Update `SubTracker/server.js` - replace entire contents with:

```javascript
// SubTracker Multi-Tenant Server
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { setupMultiTenantRoutes } = require('./server-multitenant-routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Setup all multi-tenant routes
setupMultiTenantRoutes(app);

// Error handling
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).send('Internal Server Error');
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

// Start server
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  SubTracker Multi-Tenant Server');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  🚀 Server: http://localhost:${PORT}`);
    console.log(`  📊 Mode: Multi-Tenant`);
    console.log(`  🔐 Auth: Enabled`);
    console.log('═══════════════════════════════════════════════════════');
});
```

### Step 6: Start Server

```bash
npm start
```

Visit `http://localhost:3000` - you'll be redirected to `/signup`

### Step 7: Create First Account

1. Click "Sign up"
2. Enter organization name, email, password
3. You're automatically logged in!
4. Go to Account Settings to get your API key

**Done!** 🎉

---

## 🗄️ Database Architecture

### Multi-Tenant Schema

**accounts** (Organizations/Tenants)
- `id` - UUID primary key
- `name` - Organization name
- `email` - Admin email (unique, login)
- `password` - Bcrypt hashed
- `apiKey` - Unique UUID for API access
- `subscriptionTier` - free/pro/enterprise
- `isActive` - Boolean
- `createdAt`, `updatedAt`, `lastLoginAt`

**users** (Adobe Users - Account Scoped)
- `accountId` - Links to account
- `email` - User email (unique per account)
- `firstName`, `lastName`
- `licenses` - Array of Adobe licenses
- `lastActivity`, `activityCount`
- Relations: `windowsUsernames[]`

**windows_usernames** (Username Mappings)
- `username` - Windows username (unique globally)
- `userId` - Links to user
- Auto-deleted when user deleted (cascade)

**unmapped_usernames** (Not Yet Mapped)
- `accountId` - Links to account
- `username` - Windows username
- `activityCount` - Number of events
- `firstSeen`, `lastSeen`

**usage_events** (Adobe Usage Tracking)
- `accountId` - Links to account
- `event` - Event type
- `url` - App name or URL
- `windowsUser`, `computerName` - Computer info
- `source` - 'adobe' or 'wrapper'
- `when`, `receivedAt` - Timestamps

**All queries are automatically filtered by `accountId` for complete data isolation!**

---

## 🔐 Authentication & Security

### User Authentication (Session-Based)

**Signup Flow:**
```
POST /signup
→ Validates input
→ Checks email unique
→ Hashes password (bcrypt, 10 rounds)
→ Creates account with auto-generated API key
→ Creates session
→ Redirects to dashboard
```

**Login Flow:**
```
POST /login
→ Finds account by email
→ Verifies password (bcrypt compare)
→ Updates lastLoginAt
→ Creates session
→ Redirects to dashboard
```

**Session Management:**
- PostgreSQL-backed sessions (scalable)
- HTTP-only cookies (XSS protection)
- Secure cookies in production (HTTPS)
- 7-day expiry
- Middleware: `auth.requireAuth`

### API Key Authentication (PowerShell Scripts)

**API Key Flow:**
```
POST /api/track
Header: X-API-Key: <account-api-key>
→ Validates API key
→ Finds account
→ Checks account.isActive
→ Attaches account to request
→ Saves data with accountId
```

**Security Features:**
- UUID v4 (cryptographically random)
- Validated on every API request
- Can be regenerated anytime
- Transmitted over HTTPS only
- Old key immediately invalid on regeneration

---

## 📊 API Endpoints

### Public (No Auth)
- `GET /signup` - Registration page
- `POST /signup` - Create account
- `GET /login` - Login page
- `POST /login` - Authenticate
- `GET /api/health` - Health check

### Protected (Session Auth)
- `GET /` - Dashboard
- `GET /users` - Users page
- `GET /account` - Account settings
- `GET /logout` - Logout
- `GET /download/monitor-script` - Download PowerShell script
- `POST /api/account/regenerate-key` - Regenerate API key
- `GET /api/users` - Get users (account-scoped)
- `POST /api/users` - Add user
- `PUT /api/users/update` - Update user
- `DELETE /api/users/:email` - Delete user

### API Key Auth (PowerShell)
- `POST /api/track` - Track usage event

Example:
```powershell
$apiKey = "your-api-key-here"
$headers = @{ "X-API-Key" = $apiKey }
$data = @{
    event = "adobe_desktop_usage"
    url = "Acrobat.exe"
    windowsUser = $env:USERNAME
    computerName = $env:COMPUTERNAME
    when = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://your-app.railway.app/api/track" `
    -Method POST `
    -Headers $headers `
    -Body $data `
    -ContentType "application/json"
```

---

## 🚀 Railway Deployment

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: SubTracker multi-tenant"
git remote add origin https://github.com/yourusername/subtracker.git
git push -u origin main
```

### Step 2: Create Railway Project

1. Go to https://railway.app
2. Sign up/login with GitHub
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your SubTracker repository
6. Railway auto-detects Node.js and builds

### Step 3: Add PostgreSQL Database

1. In Railway project, click "+ New"
2. Select "Database" → "PostgreSQL"
3. Railway automatically creates `DATABASE_URL` environment variable
4. **Don't manually add DATABASE_URL** - it's auto-injected!

### Step 4: Configure Environment Variables

In Railway project settings → Variables, add:

```
SESSION_SECRET=<use-output-from-crypto-command>
API_URL=https://your-app-name.railway.app
ENABLE_AZURE_SYNC=false
NODE_ENV=production
```

**Don't set:**
- `DATABASE_URL` - Railway provides this
- `PORT` - Railway provides this

### Step 5: Deploy & Initialize Database

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Push database schema
railway run npm run db:push
```

### Step 6: Access Your App

Railway provides a URL like: `https://subtracker-production-xyz.railway.app`

Visit it → Redirects to `/signup` → Create your account!

### Step 7: Custom Domain (Optional)

1. In Railway project → Settings → Domains
2. Add your domain (e.g., app.yourcompany.com)
3. Update DNS with provided CNAME
4. Update `API_URL` environment variable

---

## 📱 User Workflow

### For Your Customers:

**1. Sign Up**
```
Visit your-app.railway.app
→ Click "Sign up"
→ Enter organization name, email, password
→ Auto-login to dashboard
```

**2. Get API Key**
```
Go to Account Settings (/account)
→ View unique API key
→ Copy to clipboard
```

**3. Download Monitoring Script**
```
Click "Download Adobe Monitor Script"
→ PowerShell script downloads
→ API key is already embedded!
```

**4. Deploy Script**
```
Option A: Microsoft Intune
- Upload script to Intune
- Assign to Adobe users group

Option B: Group Policy
- Add to startup scripts

Option C: Manual
- Copy to each computer
- Create scheduled task
```

**5. Monitor Usage**
```
Return to dashboard
→ Data appears within 5 minutes
→ View active/inactive users
→ Optimize license allocation
```

---

## 🧪 Testing Multi-Tenant Isolation

### Test 1: Create Multiple Accounts

```bash
# Account A
Email: company-a@test.com
Password: password123
API Key: xxxx-xxxx-xxxx-A

# Account B  
Email: company-b@test.com
Password: password123
API Key: yyyy-yyyy-yyyy-B
```

### Test 2: Import Users

```
1. Login as Account A
2. Import 10 Adobe users
3. Note user count = 10
4. Logout
5. Login as Account B
6. Import 5 Adobe users
7. Note user count = 5
8. Verify Account A still has 10 (not 15!)
```

### Test 3: API Key Isolation

```powershell
# Send data with Account A's key
$headers = @{ "X-API-Key" = "xxxx-xxxx-xxxx-A" }
Invoke-RestMethod -Uri "https://your-app.railway.app/api/track" ...

# Check Account A dashboard - data appears ✓
# Check Account B dashboard - data does NOT appear ✓
```

### Test 4: API Key Regeneration

```
1. Download monitoring script (has API key v1)
2. Test script works ✓
3. Regenerate API key in account settings
4. Old script stops working ✓
5. Download new script
6. New script works ✓
```

---

## 💰 Monetization (Optional)

Your platform is ready for billing:

### Subscription Tiers

Field already exists: `account.subscriptionTier`

**Example Pricing:**
- **Free:** Up to 50 users
- **Pro:** $49/month - Up to 500 users
- **Enterprise:** $199/month - Unlimited

### Add Stripe Integration

```bash
npm install stripe
```

```javascript
// In server-multitenant-routes.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Limit by tier
app.post('/api/users', auth.requireAuth, async (req, res) => {
    const userCount = await db.getUsersData(req.accountId).users.length;
    
    if (req.account.subscriptionTier === 'free' && userCount >= 50) {
        return res.status(403).json({ 
            error: 'Free tier limited to 50 users. Upgrade to Pro!' 
        });
    }
    
    // Create user...
});
```

---

## 🔧 Maintenance

### View Database

```bash
# Open Prisma Studio
npm run db:studio

# Opens http://localhost:5555
# Visual database browser
```

### Check Logs

```bash
# Local
npm start
# Watch console output

# Railway
railway logs
# Or view in Railway dashboard
```

### Backup Database

```bash
# Railway provides automatic backups
# Manual backup:
railway run pg_dump > backup.sql
```

### Update Schema

```bash
# Make changes to prisma/schema.prisma

# Generate migration
npm run db:migrate

# Or push directly (no migration files)
npm run db:push
```

---

## ⚠️ Troubleshooting

### "Cannot connect to database"
**Solution:**
- Check `DATABASE_URL` in .env
- Verify PostgreSQL is running: `docker ps`
- Test connection: `npm run db:test`

### "Session not saving"
**Solution:**
- Check `SESSION_SECRET` is set
- Verify PostgreSQL session store is working
- Check `session` table exists in database

### "API key not working"
**Solution:**
- Verify `X-API-Key` header is being sent
- Check API key matches in account settings
- Ensure account is active (`isActive = true`)

### "Data showing across accounts"
**Solution:**
- All queries MUST include `where: { accountId }`
- Check `lib/database-multitenant.js`
- Verify you're using account-scoped functions

### "Railway deployment failed"
**Solution:**
- Check Railway logs
- Verify `railway.json` exists
- Ensure `postinstall` script runs Prisma generate
- Check all environment variables are set

---

## 📚 Project Structure

```
SubTracker/
├── prisma/
│   └── schema.prisma              # Multi-tenant database schema
│
├── lib/
│   ├── prisma.js                  # Prisma client singleton
│   ├── auth.js                    # Authentication & middleware
│   ├── database-multitenant.js    # Account-scoped database ops
│   └── script-generator.js        # PowerShell script generator
│
├── views/
│   ├── login.ejs                  # Login page
│   ├── signup.ejs                 # Registration page
│   ├── account.ejs                # Account management
│   ├── index.ejs                  # Dashboard
│   └── users.ejs                  # Users page
│
├── public/
│   ├── css/style.css              # Styles
│   └── js/                        # Client-side JS
│
├── scripts/
│   └── migrate-json-to-db.js      # JSON to PostgreSQL migration
│
├── server-multitenant-routes.js   # All multi-tenant routes
├── server.js                      # Main server file
├── docker-compose.yml             # Local PostgreSQL
└── package.json                   # Dependencies
```

---

## 🎯 Next Steps

### Immediate:
- ✅ Deploy to Railway
- ✅ Create your admin account
- ✅ Import Adobe users
- ✅ Download monitoring script
- ✅ Deploy to test computer
- ✅ Verify data flows in

### This Week:
- Share signup link with customers
- Monitor usage patterns
- Gather feedback
- Optimize performance

### Future Enhancements (Optional):
- Email verification
- Password reset flow
- Stripe billing integration
- Email notifications
- 2FA authentication
- Admin dashboard
- API rate limiting
- Usage analytics

---

## 📞 Support

**Documentation:**
- This guide - Complete deployment
- `START-HERE.md` - Quick overview
- `README.md` - Project overview

**Common Commands:**
```bash
# Start local dev
npm start

# Database operations
npm run db:generate     # Generate Prisma Client
npm run db:push         # Push schema to DB
npm run db:studio       # Visual DB browser
npm run db:test         # Test connection

# Railway operations
railway login           # Login to Railway
railway link            # Link to project
railway logs            # View logs
railway run <command>   # Run command in prod
```

**Key Files:**
- `.env` - Environment configuration
- `prisma/schema.prisma` - Database schema
- `lib/auth.js` - Authentication logic
- `server-multitenant-routes.js` - All routes

---

## ✅ Deployment Checklist

### Pre-Deployment:
- [ ] PostgreSQL running (Docker or local)
- [ ] Environment variables set in `.env`
- [ ] Database schema pushed (`npm run db:push`)
- [ ] Server starts without errors
- [ ] Can create account locally
- [ ] Can login/logout
- [ ] API key visible in account settings
- [ ] Can download monitoring script
- [ ] Script has correct API key

### Railway Deployment:
- [ ] Code pushed to GitHub
- [ ] Railway project created
- [ ] PostgreSQL database added
- [ ] Environment variables configured
- [ ] Database schema pushed to Railway
- [ ] App accessible at Railway URL
- [ ] Can sign up for account
- [ ] Can login
- [ ] Can download script
- [ ] Script works with Railway API

### Production Testing:
- [ ] Create 2 test accounts
- [ ] Import users to each
- [ ] Verify data isolation
- [ ] Test API keys separately
- [ ] Regenerate API key works
- [ ] All pages render correctly
- [ ] No console errors

---

## 🎉 You're Live!

Your multi-tenant SaaS platform is now deployed and ready for customers!

**Share your signup link:**
`https://your-app.railway.app/signup`

**Monitor your platform:**
- Railway dashboard for metrics
- Prisma Studio for data
- Railway logs for debugging

**Scale as needed:**
- Railway auto-scales
- PostgreSQL can handle millions of records
- All queries are optimized with indexes

---

**Built with:**
- Node.js + Express
- PostgreSQL + Prisma
- Bcrypt + Sessions
- EJS Templates
- Railway Hosting

**Time to market:** Weekend deployment! 🚀

