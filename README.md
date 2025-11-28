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
- **User Import** - Import users from Microsoft Entra (Azure AD) or Adobe reports
- **Usage Analytics** - See who's using Adobe and how often
- **License Optimization** - Identify inactive users and reassign licenses
- **Cost Savings** - Reduce Adobe spend by 20-40%

## ✨ Features

### For Organizations (Your Customers)
- 🔐 **Self-Service Signup** - Create account in seconds
- 📊 **Usage Dashboard** - View Adobe usage across all users
- 📥 **Multiple Import Options** - Import users from Microsoft Entra (Azure AD) or Adobe CSV reports
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
git clone https://github.com/yourusername/saswatch.git
cd saswatch/SasWatch

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

**For complete setup instructions, see `START-HERE.md`**

## 📁 Project Structure

```
SasWatch/
├── SasWatch/              # Main application
│   ├── lib/                 # Core libraries
│   │   ├── auth.js         # Authentication & authorization
│   │   ├── database-multitenant.js  # Account-scoped database
│   │   ├── script-generator.js      # PowerShell generator
│   │   ├── entra-sync.js   # Microsoft Entra (Azure AD) integration
│   │   └── prisma.js       # Prisma client
│   ├── views/               # EJS templates
│   ├── prisma/
│   │   └── schema.prisma   # Multi-tenant database schema
│   ├── public/              # Static assets
│   ├── server-multitenant-routes.js  # All multi-tenant routes
│   └── server.js            # Main server
├── extension/               # Chrome extension (multi-tenant)
│   └── README.md            # Extension docs
├── scripts/                 # PowerShell reference templates
│   └── README-GIT-RELEASE.md  # Git release script docs
├── START-HERE.md            # 🚀 Quick start guide
├── CONTRIBUTING.md          # 🤝 Contributing guidelines
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

1. **Push to GitHub** - Ensure your repository is pushed to GitHub

2. **Connect Railway** - Visit [railway.app](https://railway.app) → New Project → Deploy from GitHub

3. **Add PostgreSQL** - In Railway dashboard, add a PostgreSQL database service

4. **Set Environment Variables** - Configure the following in Railway:
   ```env
   DATABASE_URL=<automatically-set-by-railway>
   SESSION_SECRET=<generate-strong-secret>
   API_URL=https://your-app.railway.app
   NODE_ENV=production
   PORT=3000
   
   # Optional: Microsoft Entra integration
   CLIENT_ID=<azure-ad-client-id>
   CLIENT_SECRET=<azure-ad-client-secret>
   TENANT_ID=<azure-ad-tenant-id>
   ```

5. **Initialize Database** - Run in Railway CLI or via one-time command:
   ```bash
   railway run npm run db:push
   ```

6. **Deploy** - Railway will automatically deploy on every push to your main branch

### Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Strong random secret for session encryption (32+ characters)
- `API_URL` - Your application URL (e.g., https://your-app.railway.app)
- `NODE_ENV` - Set to `production` for production deployments

Optional (for Microsoft Entra integration):
- `CLIENT_ID` - Azure AD Application (client) ID
- `CLIENT_SECRET` - Azure AD client secret
- `TENANT_ID` - Azure AD Directory (tenant) ID

See `SasWatch/env.example` for a complete list of available environment variables.

**For detailed deployment instructions, see the Deployment section below and `START-HERE.md`**

## 📈 Usage Tracking

### How It Works

1. **Organization signs up** → Gets unique API key
2. **Import users** → From Microsoft Entra (Azure AD) or Adobe CSV reports
3. **Downloads monitoring script** → PowerShell with API key embedded
4. **Deploys via Intune/GPO** → Script runs on employees' computers
5. **Script monitors Adobe apps** → Acrobat, Photoshop, Illustrator, etc.
6. **Sends data to API** → Using organization's API key
7. **View in dashboard** → See who's using Adobe and how often

### User Import Options

**Microsoft Entra (Azure AD) Integration:**
- Sync users from your Entra directory
- Automatic user updates
- Requires Azure AD app registration with Graph API permissions

**Adobe Report Import:**
- Upload CSV exports from Adobe Admin Console
- Bulk import of licensed users
- Manual or scheduled imports

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

**Add Stripe integration** - Implement billing by integrating Stripe API with the subscription tier field

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
2. **`SasWatch/SECURITY-SETUP.md`** - Security configuration and best practices
3. **`extension/README.md`** - Chrome extension setup guide
4. **`scripts/README-GIT-RELEASE.md`** - Git release script documentation
5. **`CONTRIBUTING.md`** - Contributing guidelines for developers
6. **`README.md`** - This file (project overview)

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Bcrypt, express-session
- **Frontend**: EJS templates, vanilla JavaScript
- **Hosting**: Railway (or any Node.js host)
- **Monitoring**: PowerShell scripts
- **Integrations**: Microsoft Graph API (Entra/Azure AD), Adobe Admin Console

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

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on:

- Development setup
- Code style guidelines
- Testing procedures
- Submitting pull requests

### Quick Contributing Guidelines

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly, especially multi-tenant isolation
5. Update documentation if adding features
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## 📄 License

This project is open source and available under the [GNU Affero General Public License v3.0](LICENSE).

## 🙏 Acknowledgments

- Built with [Prisma](https://www.prisma.io/) ORM
- Deployed on [Railway](https://railway.app/)
- Powered by PostgreSQL

## 📞 Support

For setup and deployment questions, see:
- **Quick Start**: `START-HERE.md`
- **Full Guide**: This README
- **Security Setup**: `SasWatch/SECURITY-SETUP.md`
- **Contributing**: `CONTRIBUTING.md`

For issues and questions:
- Open an issue on GitHub
- Check existing issues before creating new ones

## 🎯 Roadmap

**Current Features** (✅ Complete):
- Multi-tenant architecture
- User authentication
- API key system
- Usage tracking
- Dashboard analytics
- Script generation
- Railway deployment
- Email verification
- Password reset
- Admin dashboard
- API rate limiting
- Microsoft Entra (Azure AD) integration
- License management & tracking

**Future Enhancements** (Optional):
- Stripe billing integration
- General email notifications (beyond verification/reset)
- 2FA/MFA authentication (schema ready, UI pending)
- Advanced analytics & reporting
- Export functionality

---

**Ready to deploy?** See `START-HERE.md` for quick start or the Deployment section above for details.

**Questions?** All documentation is comprehensive with troubleshooting.

---


