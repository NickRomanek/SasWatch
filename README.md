# SasWatch

SasWatch lives where finance and IT can’t see: in the shadows of your licenses, hunting down waste before it hunts you.

🌐 **Live at**: [https://app.saswatch.com](https://app.saswatch.com)

[![Node.js](https://img.shields.io/badge/Node.js-16+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

---

## What is this?

SasWatch helps you track Adobe license usage and Microsoft 365 subscriptions (soon to be many more) across your organization. Think of it as monitoring from the shadows, most of the time you won't notice it, but when you need to find waste, it's there.

Ever wonder why you're paying for Creative Cloud licenses when half your team hasn't opened Photoshop in six months? SasWatch tracks actual usage and shows you where the money's going.

### The problem we're solving

Adobe licenses aren't cheap. Microsoft 365 subscriptions add up. Organizations often pay for way more than they use, but there hasn't been an easy way to see who's actually using what. Until now.

---

## Features

**Multi-tenant from day one** — Built for organizations who need to manage multiple organizations with complete data isolation. Each organization gets their own account, API key, and isolated data silo.

**Automated usage tracking** — PowerShell scripts run silently in the background, tracking which Adobe applications are actually being used. No manual reporting, no guessing.

**Microsoft Entra integration** — Sync your users directly from Azure AD. Or import Adobe CSV exports if that's your thing.

**License optimization dashboard** — See at a glance who's using what, when they last used it, and which licenses you can safely reassign or cancel.

**Self-host or use our cloud** — It's open source (AGPL v3), so you can run it yourself. Or just use the hosted version at app.saswatch.com if you prefer things simple.

---

## Quick Start

### Prerequisites

You'll need:
- Node.js 16 or higher
- PostgreSQL (Docker works great)
- Git

### Get it running locally

```bash
# Clone it
git clone https://github.com/yourusername/saswatch.git
cd saswatch/SasWatch

# Install dependencies
npm install

# Copy the example env file and fill in your values
cp env.example .env

# Fire up PostgreSQL (if you have Docker)
docker-compose up -d

# Initialize the database
npm run db:generate
npm run db:push

# Start the server
npm start
```

Then visit `http://localhost:3000/signup` and create your first account.

**More detailed instructions?** Check out `START-HERE.md` — it's got everything you need.

---

## How it works

1. An organization signs up and gets their unique API key
2. They import users from Microsoft Entra and Adobe CSV exports. Contact me if you'd like us to manage this for you as we expand to include other vendors.
3. Download a PowerShell monitoring script (pre-configured with their API key) - this feature is in beta.
4. Deploy the script via Intune, Group Policy, or however you deploy things
5. The script quietly monitors Adobe app usage and reports back
6. The dashboard shows who's using what, how often, and when they last used it
7. Profit. Well, save money at least by optimizing license allocation

The scripts track:
- Desktop apps: Photoshop, Illustrator, InDesign, Premiere, After Effects, Acrobat, etc.
- Web usage: Chrome extension (optional) tracks Adobe web apps
- No file names, no content, no personal data beyond what's needed

---

## Architecture

Multi-tenant by design. Every query is scoped to an `accountId`. Every organization's data is completely isolated. This isn't an afterthought—it's baked into every database query, every API endpoint, every view.

**Core components:**
- `lib/auth.js` — Authentication (sessions for web, API keys for scripts)
- `lib/database-multitenant.js` — Database layer that enforces account scoping
- `lib/entra-sync.js` — Microsoft Graph API integration
- `lib/script-generator.js` — Generates PowerShell scripts with embedded API keys

**Database schema:**
- `accounts` — Organizations/tenants
- `users` — Adobe users (scoped to account)
- `usage_events` — Tracking events (scoped to account)
- `entra_sign_ins` — Microsoft sign-in logs (scoped to account)
- `applications` — Tracked applications

All models include `accountId` and all queries filter by it. No exceptions.

---

## Security

Passwords are hashed with bcrypt (10 rounds). Sessions use HTTP-only cookies (JavaScript can't access them) and are transmitted over HTTPS only in production. API keys are UUID v4 and unique per account. All queries are scoped to prevent cross-account access.

Want the full security details? See `SasWatch/SECURITY-SETUP.md`.

---

## Deployment

### Railway (easiest)

1. Push your repo to GitHub
2. Connect it to Railway
3. Add a PostgreSQL service in Railway (they'll give you the `DATABASE_URL`)
4. Set your environment variables:
   - `DATABASE_URL` (auto-set by Railway)
   - `SESSION_SECRET` (generate a strong random string)
   - `API_URL` (your Railway app URL)
   - `NODE_ENV=production`
5. Initialize the database: `railway run npm run db:push`
6. Deploy. Railway auto-deploys on every push to main.

That's it. See `START-HERE.md` for more deployment options.

---

## API Endpoints

**Public routes:**
- `GET/POST /signup` — Account registration
- `GET/POST /login` — Authentication

**Authenticated (session):**
- `GET /` — Users dashboard
- `GET /account` — Account settings
- `GET /licenses` — License inventory (beta)
- `GET /api/users` — User data
- `GET /api/activity` — Usage activity
- `GET /api/stats` — Statistics

**API key authenticated:**
- `POST /api/track` — Usage tracking endpoint (for PowerShell scripts and extensions)

Full API docs are in the code. Start with `server-multitenant-routes.js` if you want to see everything.

---

## Tech Stack

- **Backend**: Node.js + Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Bcrypt + express-session
- **Frontend**: EJS templates (simple, effective)
- **Hosting**: Railway (but runs anywhere Node.js runs)
- **Integrations**: Microsoft Graph API, Adobe Admin Console

---

## Contributing

Pull requests welcome. Issues welcome. Questions welcome.

See `CONTRIBUTING.md` for the details on:
- Development setup
- Multi-tenant testing procedures
- Code style (spoiler: account-scoping is critical)
- How to submit changes

---

## A Note on AI-Generated Code

Full transparency: Most of this codebase was generated with the help of AI assistants. Security audits were also done using AI tools. 

Is that a bad thing? We don't think so. The code works, it's been tested, and it's open source so you can see exactly what it does. Plus, let's be honest—if an AI wrote code so good that you can't tell, does it really matter? The important thing is that it works, it's secure, and it solves a real problem.

Consider this your friendly reminder that in the age of AI-assisted development, what matters isn't who (or what) wrote the code—it's whether it works, whether it's maintainable, and whether you can trust it. We've done our best on all three fronts, but don't just take our word for it. The code's right here.

*Fun fact: Even this README went through multiple AI iterations. Meta, right?*

---

## License

This project is open source under the [GNU Affero General Public License v3.0](LICENSE). 

AGPL v3 means you can use it, modify it, and distribute it freely. If you run a modified version as a network service, you need to share your changes. That's the deal. Want to use it commercially without sharing changes? We can talk about a commercial license—just open an issue.

---

## Support & Documentation

- **Quick Start**: `START-HERE.md` (5-minute setup)
- **Security Setup**: `SasWatch/SECURITY-SETUP.md`
- **Contributing**: `CONTRIBUTING.md`
- **Extension Docs**: `extension/README.md`

Questions? Open an issue. Found a bug? Open an issue. Want to contribute? Open a PR.

---

## Roadmap

**What's done:**
- Multi-tenant architecture
- User authentication & authorization
- API key system
- Usage tracking (PowerShell + Chrome extension) - Beta
- Microsoft Entra integration
- License management dashboard - Beta
- Email verification & password reset
- Rate limiting

**What's coming:**
- Stripe billing integration
- Advanced analytics & reporting
- MFA/2FA (schema is ready, UI coming)
- Export functionality
- More integrations (Google Workspace, Slack, Zoom, etc.)

---

## Acknowledgments

Thanks to:
- [Prisma](https://www.prisma.io/) for making database work less painful
- [Railway](https://railway.app/) for dead-simple deployment
- PostgreSQL for being PostgreSQL
- The open source community for existing

---

**Ready to start tracking those licenses?** Head to `START-HERE.md` and let's go.

*SasWatch: Because some things are better when they're watching from the shadows.*

---

Copyright (C) 2025 RomaTek LLC
