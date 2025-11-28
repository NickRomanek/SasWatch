# Contributing to SasWatch

Thank you for your interest in contributing to SasWatch! This document provides guidelines and instructions for contributing to the project.

## License

SasWatch is licensed under the [GNU Affero General Public License v3.0 (AGPL v3)](LICENSE). By contributing to this project, you agree that your contributions will be licensed under the same AGPL v3 license. This means:

- Your contributions will be open source and available to all users
- Users who modify and run the software as a network service must share their source code
- All derivative works must also be licensed under AGPL v3

If you have questions about the license or need a different licensing arrangement, please contact the maintainers before contributing.

## Development Setup

### Prerequisites

- Node.js 16+ (or Node.js 18+ recommended)
- PostgreSQL (via Docker or local installation)
- Git
- npm (included with Node.js)

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/saswatch.git
   cd saswatch/SasWatch
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env
   ```
   Edit `.env` with your configuration values.

4. **Start PostgreSQL**
   ```bash
   docker-compose up -d
   ```

5. **Initialize database**
   ```bash
   npm run db:generate  # Generate Prisma Client
   npm run db:push      # Push schema to database
   ```

6. **Start development server**
   ```bash
   npm start            # Production mode
   # or
   npm run dev          # Development mode with nodemon
   ```

7. **Access the application**
   Open http://localhost:3000 in your browser.

## Development Commands

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
npm run generate-secret  # Generate session secret
```

## Code Style Guidelines

### Multi-Tenant Data Isolation

**CRITICAL**: All database queries MUST filter by `accountId` to maintain data isolation.

```javascript
// ✅ CORRECT - Account scoped
const users = await prisma.user.findMany({
    where: { accountId }
});

// ❌ WRONG - No account scoping (data leak!)
const users = await prisma.user.findMany();
```

Use the `lib/database-multitenant.js` functions when possible - they handle scoping automatically.

### Authentication Patterns

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

### File Organization

- `lib/` - Core business logic
- `views/` - EJS templates
- `public/` - Static assets (CSS, JS, images)
- `prisma/` - Database schema and migrations
- Routes defined in `server-multitenant-routes.js`

## Testing

### Testing Multi-Tenant Isolation

Always verify data isolation when making changes:

1. Create Account A, import 10 users
2. Create Account B, import 5 users
3. Login as Account A → should see 10 users only
4. Login as Account B → should see 5 users only
5. Use Account A's API key → events should only appear in Account A
6. Use Account B's API key → events should only appear in Account B

### Testing Script Generation

1. Download script from account page
2. Verify API key is embedded correctly
3. Test script with localhost API URL
4. Verify events appear in correct account dashboard

## Debugging

### Microsoft Entra (Azure AD) Sync Debugging

If you're working on Entra sync functionality, here are debugging tools and common issues:

#### Console Logging

All sync operations log with `[SYNC-DEBUG]` prefix. Open browser DevTools → Console to see:
- Sync initiation and parameters
- Progress updates every 2 seconds
- Status polling requests/responses
- Sync completion details

#### Common Issues

**Sync gets stuck on "Loading..."**
- Check console for `[SYNC-DEBUG] Starting sync...`
- If missing → Network issue, check browser connection
- If present but no progress → Server not responding, check server logs
- Fix: Click "🛑 Cancel Sync" if button appears, refresh page and try again

**Sync times out**
- Sync now waits up to 2 minutes per Graph API page
- Users see "Microsoft Graph sync may take up to 3 minutes"
- Progress feedback shows: "Fetched page X (Y events so far)"

**Sync completes but shows 0 events**
- Check if cursor was reset to 24 hours ago
- Verify Microsoft Graph has data in that timeframe
- Check Graph API permissions are granted

#### Client-Side Debugging

```javascript
// Check these in browser console:
console.log('Active syncs:', activeSyncs); // Should show Map
console.log('Sync poller:', syncStatusPoller); // Should show interval ID or null

// Manual status check:
fetch('/api/sync/status').then(r => r.json()).then(console.log);
```

#### Server-Side Debugging

```bash
# Check server logs for:
grep "\[SYNC-DEBUG\]" logs/*.log
grep "entraSignInLastSyncAt" logs/*.log
grep "cursor reset" logs/*.log
```

#### Database Debugging

```sql
-- Check account sync state:
SELECT id, "entraSignInCursor", "entraSignInLastSyncAt"
FROM accounts WHERE id = 'your-account-id';

-- Check recent events:
SELECT COUNT(*) FROM "usageEvent" WHERE "accountId" = 'your-account-id';
SELECT COUNT(*) FROM "entraSignIn" WHERE "accountId" = 'your-account-id';
```

### General Debugging Tips

1. Check browser console for JavaScript errors
2. Check server logs in `logs/` directory
3. Use Prisma Studio to inspect database: `npm run db:studio`
4. Enable verbose logging by setting `LOG_LEVEL=debug` in `.env`

## Making Changes

### Database Schema Changes

1. Edit `prisma/schema.prisma`
2. Run `npm run db:generate` to regenerate Prisma Client
3. Run `npm run db:push` for development (or create migration for production)
4. Update any affected code

### Adding New Routes

Add to appropriate section in `server-multitenant-routes.js`:
- Use `auth.requireAuth` for web UI routes
- Use `auth.requireApiKey` for external API routes
- Always use `req.accountId` or `req.session.accountId` for queries

### Adding New Account-Scoped Models

1. Add to `prisma/schema.prisma` with `accountId` field and relation
2. Add `@@index([accountId])` for query performance
3. Run `npm run db:generate`
4. Create operations in `lib/database-multitenant.js` that accept `accountId` as first parameter
5. Add routes in `server-multitenant-routes.js` using auth middleware

## Submitting Changes

### Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly, especially multi-tenant isolation
5. Update documentation if adding features
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Commit Messages

Please write clear commit messages:
- Use present tense ("Add feature" not "Added feature")
- First line should be a summary (50 chars or less)
- Add more detailed explanation if needed

### Code Review

All code contributions go through code review:
- Ensure all tests pass
- Verify multi-tenant isolation works
- Check that documentation is updated
- Make sure no sensitive information is committed

## Security Considerations

- Never commit `.env` files or secrets
- Always use account-scoped queries
- Validate all user inputs
- Use parameterized queries (Prisma handles this)
- Test authentication and authorization

## Getting Help

- Check existing issues on GitHub
- Review the main [README.md](README.md) for project overview
- See [START-HERE.md](START-HERE.md) for setup instructions
- Check [SasWatch/SECURITY-SETUP.md](SasWatch/SECURITY-SETUP.md) for security setup

## Architecture Notes

For detailed architecture information, see [CLAUDE.md](CLAUDE.md) which contains comprehensive developer notes about:
- Multi-tenant data isolation
- Core components and their responsibilities
- Database schema design
- Authentication flows
- Usage tracking flow

---

Thank you for contributing to SasWatch! 🎉

