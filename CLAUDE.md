# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SasWatch is a **multi-tenant SaaS platform** for tracking Adobe Creative Cloud license usage across organizations. Each organization (account) gets complete data isolation with a unique API key for automated usage tracking via PowerShell scripts and Chrome extension.

## Development Commands

### Setup & Installation
```bash
cd SasWatch
npm install
cp env.example .env  # Edit with your values
docker-compose up -d  # Start PostgreSQL
npm run db:generate  # Generate Prisma Client
npm run db:push      # Push schema to database
npm start            # Start server on port 3000
```

### Database Commands
```bash
npm run db:generate  # Generate Prisma Client (run after schema changes)
npm run db:push      # Push schema to database (development)
npm run db:migrate   # Create migration (production)
npm run db:studio    # Open Prisma Studio UI
npm run db:test      # Test database connection
```

### Development
```bash
npm start            # Production mode
npm run dev          # Development mode with nodemon
```

## Architecture Overview

### Multi-Tenant Data Isolation

The platform uses **account-scoped queries** for complete data isolation:

- **accounts** table: Each organization is a separate account with unique API key
- All data models (users, usage_events, unmapped_usernames) include `accountId` foreign key
- **Critical**: All database queries MUST filter by `accountId` to maintain isolation
- The `lib/database-multitenant.js` abstraction layer enforces account-scoping automatically

### Core Components

**`lib/auth.js`** - Authentication & Authorization
- Password hashing with bcrypt (10 rounds)
- Session-based authentication for web UI
- API key authentication for PowerShell/Extension tracking
- Middleware: `requireAuth` (sessions), `requireApiKey` (API), `attachAccount`

**`lib/database-multitenant.js`** - Account-Scoped Database Layer
- All operations automatically scoped to `accountId`
- User operations: `getUsersData()`, `createUser()`, `updateUser()`, `deleteUser()`
- Usage tracking: `getUsageData()`, `addUsageEvent()`
- Username mapping: Links Windows usernames to Adobe user emails
- Unmapped usernames: Tracks activity from users not yet imported

**`lib/script-generator.js`** - PowerShell Script Generation
- Generates monitoring scripts with embedded API keys
- Environment-aware intervals (5 seconds for testing, 5 minutes for production)
- Emits detailed logs via `Write-MonitorLog` to both console and `monitor.log`
- Each account gets custom script with their unique API key and API URL
- Scripts monitor foreground Adobe processes and send data to `/api/track`

**`lib/intune-package-generator.js`** - Intune Package Builder
- Creates tenant-specific ZIPs containing installer, uninstaller, detection, troubleshoot scripts
- Embeds generated monitor script as `Monitor-AdobeUsage-Generated.ps1`
- Produces tailored deployment guide and names packages per environment (production/testing)

**`server-multitenant-routes.js`** - All Application Routes
- Session setup with PostgreSQL store (production) or memory (dev)
- Auth routes: `/signup`, `/login`, `/logout`
- Dashboard routes: `/` (users), `/dashboard` (activity), `/account` (settings)
- API routes: `/api/users`, `/api/activity`, `/api/track`, etc.
- Download routes: Scripts, extension, deployment instructions

**`server.js`** - Main Entry Point
- Imports and registers all route modules
- Minimal setup - all logic in route modules

### Database Schema (Prisma)

**Multi-tenant design** with complete data isolation:

```prisma
Account (id, name, email, password, apiKey, subscriptionTier)
  ├─ User (accountId, email, firstName, lastName, licenses[])
  │   └─ WindowsUsername (username → userId)
  ├─ UsageEvent (accountId, event, url, windowsUser, computerName, source)
  └─ UnmappedUsername (accountId, username, activityCount)
```

**Important constraints:**
- Email is unique per account: `@@unique([accountId, email])`
- Windows usernames are globally unique across all accounts
- API keys are globally unique UUIDs

### Authentication Flow

**Web UI (Session-based):**
1. User signs up → Account created with auto-generated API key
2. Login → Session created with `accountId`
3. All routes use `requireAuth` middleware → checks `req.session.accountId`
4. Account attached to `req.account` via `attachAccount` middleware

**API Tracking (API Key):**
1. PowerShell/Extension sends data with `X-API-Key` header
2. `requireApiKey` middleware validates key and loads account
3. Account attached to `req.account` and `req.accountId`
4. Usage event saved with account scoping

### Username Mapping System

A critical feature that links Windows usernames to Adobe user emails:

1. **Import Adobe users** from CSV (email, firstName, lastName, licenses)
2. **Map Windows usernames** to Adobe emails in UI
3. **PowerShell script** reports Windows username with usage events
4. **Automatic matching**: When event arrives, lookup username → email → update activity
5. **Unmapped tracking**: Unknown usernames tracked separately for manual mapping

This enables tracking actual computer usage even when users aren't logged into Adobe accounts.

## Key Patterns & Conventions

### Always Use Account Scoping

When writing new database queries, ALWAYS include `accountId`:

```javascript
// ✅ CORRECT - Account scoped
const users = await prisma.user.findMany({
    where: { accountId }
});

// ❌ WRONG - No account scoping (data leak!)
const users = await prisma.user.findMany();
```

Use the `lib/database-multitenant.js` functions when possible - they handle scoping automatically.

### Two Authentication Patterns

**For web routes** - Use session middleware:
```javascript
app.get('/dashboard', auth.requireAuth, async (req, res) => {
    const accountId = req.session.accountId;
    // Use accountId for all queries
});
```

**For API endpoints** - Use API key middleware:
```javascript
app.post('/api/track', auth.requireApiKey, async (req, res) => {
    const accountId = req.accountId; // Set by requireApiKey
    // Use accountId for all queries
});
```

### Session Configuration

Sessions use PostgreSQL store in production (via `DATABASE_URL`), memory store in development. The session table is auto-created by `connect-pg-simple`.

### Script Generation

Each account downloads customized PowerShell scripts via `/download/monitor-script`:
- API key is embedded in the script
- API URL is dynamically set (supports self-host, Railway, or custom domains)
- Log file location: `C:\ProgramData\AdobeMonitor\monitor.log`
- Scripts include troubleshooting guidance via `Write-MonitorLog`
- Scripts are generated on-the-fly, not stored

The Intune package routes (`/download/intune-package`, `/download/intune-package-testing`) call the package generator to bundle:

- `Install-AdobeMonitor.ps1` (per-user launcher installer)
- `Uninstall-AdobeMonitor.ps1`
- `Detect-AdobeMonitor.ps1`
- `Monitor-AdobeUsage-Generated.ps1`
- `troubleshoot-monitoring.ps1`
- `DEPLOYMENT-GUIDE.txt`

## File Organization

```
SasWatch/
├── lib/                          # Core business logic
│   ├── auth.js                  # Authentication & middleware
│   ├── database-multitenant.js  # Account-scoped data operations
│   ├── script-generator.js      # PowerShell script generation
│   └── prisma.js                # Prisma client singleton
├── views/                        # EJS templates
│   ├── signup.ejs               # Account registration
│   ├── login.ejs                # Login page
│   ├── users.ejs                # User management (default landing)
│   ├── index.ejs                # Activity dashboard
│   └── account.ejs              # Account settings & downloads
├── public/                       # Static assets (CSS, JS)
├── prisma/schema.prisma          # Database schema
├── server.js                     # Main server entry point
└── server-multitenant-routes.js # All route handlers
```

Outside `SasWatch/`:
- `extension/` - Chrome extension for web Adobe.com tracking
- `scripts/` - Reference PowerShell templates
- `intune-scripts/` - Installer, uninstaller, detection, troubleshooting scripts bundled into Intune packages
- `README.md`, `DEPLOYMENT-GUIDE.md` - Documentation

## Environment Variables

Required in `.env`:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SESSION_SECRET=random-secret-change-in-production
API_URL=https://your-domain.railway.app  # Or http://localhost:3000
NODE_ENV=production  # or development
```

## Testing Multi-Tenant Isolation

Always verify data isolation when making changes:

1. Create Account A, import 10 users
2. Create Account B, import 5 users
3. Login as Account A → should see 10 users only
4. Login as Account B → should see 5 users only
5. Use Account A's API key → events should only appear in Account A
6. Use Account B's API key → events should only appear in Account B

## Common Tasks

### Adding a New Account-Scoped Model

1. Add to `prisma/schema.prisma` with `accountId` field and relation
2. Add `@@index([accountId])` for query performance
3. Run `npm run db:generate`
4. Create operations in `lib/database-multitenant.js` that accept `accountId` as first parameter
5. Add routes in `server-multitenant-routes.js` using auth middleware

### Modifying the Database Schema

```bash
# 1. Edit prisma/schema.prisma
# 2. Regenerate Prisma Client
npm run db:generate
# 3. Push to database (dev) or create migration (prod)
npm run db:push          # Development
npm run db:migrate       # Production
```

### Adding a New Route

Add to appropriate section in `server-multitenant-routes.js`:
- Use `auth.requireAuth` for web UI routes
- Use `auth.requireApiKey` for external API routes
- Always use `req.accountId` or `req.session.accountId` for queries

## Deployment

The app is designed for Railway deployment with PostgreSQL:

1. Connect GitHub repo to Railway
2. Add PostgreSQL service
3. Set environment variables (SESSION_SECRET, API_URL, NODE_ENV)
4. Run `railway run npm run db:push` to initialize schema
5. Railway auto-detects Node.js and deploys

See `README.md` and `DEPLOYMENT-GUIDE.md` for complete instructions.

## Usage Tracking Flow

1. **Organization signs up** → Gets unique `apiKey`
2. **Downloads monitoring script** → PowerShell with embedded API key
3. **Deploys via Intune/GPO** → Installer runs as SYSTEM, registers per-user launcher
4. **Script detects Adobe processes** → Acrobat, Photoshop, Illustrator, etc.
5. **Launcher runs in the user session at logon** → Ensures foreground window access
6. **Sends to `/api/track`** → Includes Windows username, computer name, process
6. **Username mapping** → Links Windows username to Adobe email
7. **Updates activity** → `lastActivity` and `activityCount` for that user
8. **Dashboard shows usage** → Organization sees who's using Adobe and when

Optional: Chrome extension also tracks Adobe.com website usage.

## Intune Deployment Notes

- `Install-AdobeMonitor.ps1` now configures a launcher (`MonitorLauncher.vbs`) and Run key (`HKLM\...\Run\AdobeUsageMonitor`) so the monitoring script runs inside each user session (foreground window access).
- The installer sets ACLs on `C:\ProgramData\AdobeMonitor` so standard users can write `monitor.log` and status files.
- `Detect-AdobeMonitor.ps1` validates both the installed script and Run-key entry (checks 64-bit and WOW6432Node views for Intune’s 32-bit detection host).
- `Uninstall-AdobeMonitor.ps1` removes the Run-key entry, kills the launcher, and cleans up the install directory.
- Logging is available at `C:\ProgramData\AdobeMonitor\monitor.log` (monitoring) and `install.log` / `uninstall.log` (installer scripts) for troubleshooting.

## Security Considerations

- Passwords hashed with bcrypt (10 rounds)
- API keys are UUIDs, globally unique
- Sessions stored in PostgreSQL (production) with 7-day expiry
- HTTPS-only cookies in production (`secure: true`)
- All queries account-scoped to prevent cross-tenant access
- No sensitive data collected (no file names, content, or personal info)
