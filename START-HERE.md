# 🚀 SubTracker - START HERE

## What is SubTracker?

SubTracker is a **multi-tenant SaaS platform** for tracking Adobe Creative Cloud license usage. Organizations can sign up, import their Adobe users, deploy monitoring scripts, and optimize license allocation based on real usage data.

## ✨ Key Features

- 🔐 **User Authentication** - Secure signup/login for organizations
- 🏢 **Multi-Tenant** - Multiple organizations, completely isolated data
- 🔑 **API Keys** - Unique API key per organization
- 📊 **Usage Tracking** - PowerShell scripts monitor Adobe application usage
- 📈 **Analytics Dashboard** - View activity, identify inactive users
- 💰 **Cost Savings** - Reassign unused licenses, reduce Adobe spend

## 🎯 Quick Start

### 1. Setup (5 minutes)

```bash
cd SubTracker
npm install
```

Create `.env` file:
```env
DATABASE_URL=postgresql://localhost:5432/subtracker?schema=public
SESSION_SECRET=your-random-secret-here
API_URL=http://localhost:3000
PORT=3000
```

### 2. Start PostgreSQL

```bash
docker-compose up -d
```

### 3. Initialize Database

```bash
npm run db:generate
npm run db:push
```

### 4. Start Server

```bash
npm start
```

Visit `http://localhost:3000/signup` to create your account!

## 📖 Full Documentation

**For complete setup and deployment:**
→ See **`DEPLOYMENT-GUIDE.md`**

This guide covers:
- ✅ Complete local setup
- ✅ Database architecture
- ✅ Authentication & security
- ✅ API endpoints
- ✅ Railway deployment
- ✅ Multi-tenant testing
- ✅ Troubleshooting
- ✅ Monetization options

## 🏗️ Architecture

```
Multiple Organizations
       ↓
Sign up at your-app.railway.app
       ↓
Each gets unique API key
       ↓
Download custom PowerShell monitoring script
       ↓
Deploy to employees' computers
       ↓
Scripts track Adobe usage (Acrobat, Photoshop, etc.)
       ↓
Data sent to API with account's API key
       ↓
View usage in account's dashboard (isolated)
       ↓
Optimize license allocation
```

## 🔐 Security

- **Passwords**: Bcrypt hashed (10 rounds)
- **Sessions**: PostgreSQL-backed, HTTP-only cookies
- **API Keys**: UUID v4, HTTPS only
- **Data Isolation**: All queries scoped by accountId
- **No Cross-Account Access**: Database-level enforcement

## 📊 Tech Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: Bcrypt + express-session
- **Frontend**: EJS templates
- **Hosting**: Railway (auto-deploy from GitHub)
- **Monitoring**: PowerShell scripts

## 🚀 Deploy to Production

See **`DEPLOYMENT-GUIDE.md`** → "Railway Deployment" section

**Quick steps:**
1. Push to GitHub
2. Connect Railway
3. Add PostgreSQL database
4. Set environment variables
5. Push database schema
6. You're live!

## 📂 Project Structure

```
SubTracker/
├── lib/                    # Core logic
│   ├── auth.js            # Authentication
│   ├── database-multitenant.js  # Database ops
│   └── script-generator.js     # PowerShell generator
├── views/                 # EJS templates
│   ├── signup.ejs
│   ├── login.ejs
│   ├── account.ejs
│   └── ...
├── prisma/
│   └── schema.prisma      # Database schema
├── server-multitenant-routes.js  # All routes
└── server.js              # Main server
```

## 💡 User Workflow

**For Organizations Using SubTracker:**

1. **Sign Up** → Create account at your-app.railway.app
2. **Login** → Lands on Users page (default)
3. **Import Users** → Upload CSV of Adobe licensed users
4. **View Dashboard** → See usage analytics and activity
5. **Get Downloads** → Go to Account page for PowerShell script & Chrome extension
6. **Deploy Tools** → Push to computers via Intune/GPO
7. **Monitor Usage** → Track who's using Adobe apps
8. **Optimize Licenses** → Reassign unused licenses, save money

## 🧪 Test It Out

```bash
# Create Account A
Visit http://localhost:3000/signup
Email: test-a@company.com

# Get API Key
Go to Account Settings → Copy API key

# Test API
$headers = @{ "X-API-Key" = "your-api-key" }
Invoke-RestMethod -Uri "http://localhost:3000/api/track" -Method POST -Headers $headers -Body '{"test":"data"}'

# Create Account B
Logout → Sign up again with different email

# Verify Isolation
Account A can't see Account B's data ✓
```

## 📞 Need Help?

- **Complete Guide**: `DEPLOYMENT-GUIDE.md`
- **Project Overview**: `README.md`
- **Issues**: Check troubleshooting section in DEPLOYMENT-GUIDE.md

## ✅ What's Next?

After local testing:

1. ✅ Deploy to Railway (see DEPLOYMENT-GUIDE.md)
2. ✅ Share signup link with customers
3. ✅ Monitor usage
4. ✅ (Optional) Add Stripe billing

## 🎉 You're Ready!

SubTracker is a complete multi-tenant SaaS platform ready for production.

**Start here:**
1. Read this file (done! ✓)
2. Follow Quick Start above
3. See DEPLOYMENT-GUIDE.md for full details
4. Deploy to Railway
5. Launch your SaaS!

---

**Questions?** Everything is covered in `DEPLOYMENT-GUIDE.md` 📖
