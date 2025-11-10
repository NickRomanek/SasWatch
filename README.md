# SasWatch - Multi-Tenant Adobe License Management

> Track Adobe Creative Cloud usage across your organization and optimize license allocation

[![Node.js](https://img.shields.io/badge/Node.js-16+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![Railway](https://img.shields.io/badge/Deploy-Railway-blueviolet.svg)](https://railway.app/)

## 📖 Overview

SasWatch is a **multi-tenant SaaS platform** that helps organizations track Adobe Creative Cloud license usage and identify optimization opportunities. Multiple companies can sign up, each with completely isolated data and unique API keys.

### The Problem

- Adobe Creative Cloud licenses are expensive ($50-80/user/month)
- Many licensed users rarely use Adobe applications
- No easy way to track actual usage across your organization
- Wasted spend on unused licenses

### The Solution

SasWatch provides:
- **Automated Usage Tracking** - PowerShell scripts monitor Adobe application usage
- **Multi-Tenant Platform** - Serve multiple organizations from one deployment
- **Usage Analytics** - See who's using Adobe and how often
- **License Optimization** - Identify inactive users and reassign licenses
- **Cost Savings** - Reduce Adobe spend by 20-40%

## ✨ Features

### For Organizations (Your Customers)
- 🔐 **Self-Service Signup** - Create account in seconds
- 📊 **Usage Dashboard** - View Adobe usage across all users
- 📥 **CSV Import** - Import Adobe users easily
- 🔑 **Unique API Key** - Secure API access per organization
- 📝 **Custom Scripts** - Download PowerShell monitoring scripts
- 🚀 **Easy Deployment** - Deploy via Intune or Group Policy
- 📈 **Activity Tracking** - See last activity per user
- 💡 **Optimization Insights** - Identify inactive users

### For You (Platform Owner)
- 🏢 **Multi-Tenant** - Unlimited organizations
- 🔒 **Data Isolation** - Complete separation between accounts
- 💰 **Monetization Ready** - Built-in subscription tier field
- 📦 **Easy Deployment** - One-click Railway deployment
- ⚡ **Scalable** - Handles millions of usage events
- 🔐 **Secure** - Bcrypt passwords, API key auth, HTTPS
- 📊 **PostgreSQL** - Reliable, scalable database

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL (Docker or local)
- Git

### Local Development

```bash
# 1. Clone repository
git clone https://github.com/yourusername/subtracker.git
cd subtracker/SasWatch

# 2. Install dependencies
npm install

# 3. Setup environment
cp env.example .env
# Edit .env with your values

# 4. Start PostgreSQL
docker-compose up -d

# 5. Initialize database
npm run db:generate
npm run db:push

# 6. Start server
npm start

# 7. Visit http://localhost:3000/signup
```

**For complete setup instructions, see `DEPLOYMENT-GUIDE.md`**

## 📁 Project Structure

```
abowdyV4/
├── SasWatch/              # Main application
│   ├── lib/                 # Core libraries
│   │   ├── auth.js         # Authentication & authorization
│   │   ├── database-multitenant.js  # Account-scoped database
│   │   ├── script-generator.js      # PowerShell generator
│   │   └── prisma.js       # Prisma client
│   ├── views/               # EJS templates
│   │   ├── signup.ejs      # Registration page
│   │   ├── login.ejs       # Login page
│   │   ├── account.ejs     # Account settings & downloads
│   │   ├── users.ejs       # Users page (default landing)
│   │   └── index.ejs       # Activity dashboard
│   ├── prisma/
│   │   └── schema.prisma   # Multi-tenant database schema
│   ├── public/              # Static assets
│   │   ├── css/            # Stylesheets
│   │   └── js/             # Client-side JavaScript
│   ├── server-multitenant-routes.js  # All multi-tenant routes
│   └── server.js            # Main server
├── extension/               # Chrome extension (multi-tenant)
│   ├── background.js        # Extension logic
│   ├── options.html         # Configuration UI
│   ├── options.js           # Configuration logic
│   ├── manifest.json        # Extension manifest
│   └── README.md            # Extension docs
├── scripts/                 # PowerShell reference templates
├── DEPLOYMENT-GUIDE.md      # 📖 Complete deployment guide
├── START-HERE.md            # 🚀 Quick start guide
├── FOLDER-GUIDE.md          # 📁 Detailed folder guide
└── README.md                # 📄 This file
```

## 🗄️ Database Architecture

### Multi-Tenant Schema

**accounts** - Organizations/tenants
- Each organization gets isolated account
- Unique API key auto-generated
- Subscription tier field for billing

**users** - Adobe users (account-scoped)
- Links to account via `accountId`
- Email unique per account
- Tracks licenses, activity, Windows usernames

**usage_events** - Adobe usage tracking (account-scoped)
- All events linked to account
- Tracks which Adobe apps are used
- Computer and user information

**Complete data isolation** - All queries automatically filtered by `accountId`

## 🔐 Security

### Authentication
- **Password Hashing**: Bcrypt with 10 rounds
- **Session Management**: PostgreSQL-backed sessions
- **Secure Cookies**: HTTP-only, HTTPS in production
- **Session Expiry**: 7 days

### Authorization
- **API Keys**: UUID v4, unique per account
- **Account Scoping**: All queries filtered by accountId
- **Data Isolation**: No cross-account access possible
- **API Key Rotation**: Can regenerate anytime

## 📊 Routes & API Endpoints

### Public Routes
- `GET /signup` - Account registration
- `GET /login` - User login
- `POST /signup` - Create account
- `POST /login` - Authenticate

### Authenticated Routes (Session)
- `GET /` - Users page (default landing)
- `GET /dashboard` - Activity dashboard
- `GET /account` - Account settings & downloads
- `GET /logout` - End session

### Download Endpoints (Session Auth)
- `GET /download/monitor-script` - PowerShell script (.ps1)
- `GET /download/extension` - Chrome extension (.zip)
- `GET /download/instructions` - Deployment guide

### Account Management API (Session Auth)
- `GET /api/account` - Get account info
- `POST /api/account/regenerate-key` - New API key

### Data Operations API (Session Auth)
- `GET /api/users` - Get users (account-scoped)
- `POST /api/users` - Add user
- `POST /api/upload-csv` - Import users from CSV
- `PUT /api/users/update` - Update user
- `DELETE /api/users/:email` - Delete user
- `GET /api/activity` - Get activity data
- `GET /api/stats` - Get statistics

### Usage Tracking API (API Key Auth)
- `POST /api/track` - Track usage event (PowerShell & Extension)

## 🚀 Deployment

### Railway (Recommended)

```bash
# 1. Push to GitHub
git push

# 2. Connect Railway
# Visit railway.app → New Project → Deploy from GitHub

# 3. Add PostgreSQL
# In Railway: Add PostgreSQL database

# 4. Set environment variables
SESSION_SECRET=<random-string>
API_URL=https://your-app.railway.app
NODE_ENV=production

# 5. Push database schema
railway run npm run db:push

# 6. You're live!
```

**See `DEPLOYMENT-GUIDE.md` for complete Railway deployment instructions**

## 📈 Usage Tracking

### How It Works

1. **Organization signs up** → Gets unique API key
2. **Downloads monitoring script** → PowerShell with API key embedded
3. **Deploys via Intune/GPO** → Script runs on employees' computers
4. **Script monitors Adobe apps** → Acrobat, Photoshop, Illustrator, etc.
5. **Sends data to API** → Using organization's API key
6. **View in dashboard** → See who's using Adobe and how often

### Monitored Applications

**Desktop (PowerShell):**
- Adobe Acrobat (Reader & Pro)
- Adobe Photoshop
- Adobe Illustrator
- Adobe InDesign
- Adobe Premiere Pro
- Adobe After Effects
- Creative Cloud Desktop App

**Web (Chrome Extension - Optional):**
- Adobe.com websites
- Acrobat Web
- Adobe Express
- Admin Console
- All *.adobe.com sites

### Data Collected

- Application name / URL
- Windows username (desktop only)
- Computer name (desktop only)
- Browser tab ID (web only)
- Timestamp
- Frequency

**No personal data, file names, or content is collected**

## 💰 Monetization

SasWatch is monetization-ready with built-in subscription tier support.

### Example Pricing Model

```javascript
account.subscriptionTier
// 'free' | 'pro' | 'enterprise'
```

**Suggested Pricing:**
- **Free**: Up to 50 users
- **Pro**: $49/month - Up to 500 users
- **Enterprise**: $199/month - Unlimited users

**Add Stripe integration** - See DEPLOYMENT-GUIDE.md for details

## 🧪 Testing

```bash
# Test multi-tenant isolation
1. Create Account A
2. Import 10 users
3. Create Account B
4. Import 5 users
5. Verify Account A still has 10 (not 15) ✓

# Test API keys
1. Get Account A's API key
2. Send test data
3. Verify appears in Account A only ✓
4. Verify NOT in Account B ✓
```

## 📚 Documentation

1. **`START-HERE.md`** - Quick start guide (5 minutes)
2. **`DEPLOYMENT-GUIDE.md`** - Complete deployment & Railway guide
3. **`FOLDER-GUIDE.md`** - Detailed folder structure & architecture
4. **`extension/README.md`** - Chrome extension setup guide
5. **`README.md`** - This file (project overview)

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Bcrypt, express-session
- **Frontend**: EJS templates, vanilla JavaScript
- **Hosting**: Railway (or any Node.js host)
- **Monitoring**: PowerShell scripts

## 📦 NPM Scripts

```bash
npm start              # Start server
npm run dev            # Development mode with nodemon
npm run db:generate    # Generate Prisma Client
npm run db:push        # Push schema to database
npm run db:migrate     # Create migration
npm run db:studio      # Open Prisma Studio
npm run db:test        # Test database connection
```

## 🤝 Contributing

This is a custom application. For modifications:

1. Update Prisma schema if changing database
2. Run `npm run db:generate` after schema changes
3. Test with multiple accounts to verify isolation
4. Update documentation if adding features

## 📄 License

Private/Proprietary - Not for public distribution

## 🙏 Acknowledgments

- Built with [Prisma](https://www.prisma.io/) ORM
- Deployed on [Railway](https://railway.app/)
- Powered by PostgreSQL

## 📞 Support

For setup and deployment questions, see:
- **Quick Start**: `START-HERE.md`
- **Full Guide**: `DEPLOYMENT-GUIDE.md`
- **Troubleshooting**: Check DEPLOYMENT-GUIDE.md troubleshooting section

## 🎯 Roadmap

**Current Features** (✅ Complete):
- Multi-tenant architecture
- User authentication
- API key system
- Usage tracking
- Dashboard analytics
- Script generation
- Railway deployment

**Future Enhancements** (Optional):
- Email verification
- Password reset
- Stripe billing integration
- Email notifications
- 2FA authentication
- Admin dashboard
- API rate limiting
- Advanced analytics

---

**Ready to deploy?** See `START-HERE.md` for quick start or `DEPLOYMENT-GUIDE.md` for complete guide.

**Questions?** All documentation is comprehensive with troubleshooting.

---

Made with ☕ for Adobe license optimization
