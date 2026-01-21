# Security Rules

## CRITICAL: Never Modify These Files Without Explicit Approval

- `lib/auth.js` - Authentication logic
- `lib/security.js` - Security middleware and validation
- `lib/database-multitenant.js` - Core data layer (account scoping)
- `prisma/schema.prisma` - Database schema

## Authentication & Authorization

- **Session-based auth** for web UI routes (use `requireAuth` middleware)
- **API key auth** for external API routes (use `requireApiKey` middleware)
- Always verify `accountId` from session or API key before database operations
- Never trust client-provided `accountId` - always use `req.session.accountId` or `req.accountId`

## Password Security

- Use `bcrypt` with 10 salt rounds (already configured)
- Minimum password length: 12 characters
- Require: uppercase, lowercase, number, special character
- Never log passwords or password hashes
- Use `generateSecureToken()` from `lib/security.js` for tokens

## API Key Security

- API keys are UUIDs, globally unique
- Never expose API keys in logs or error messages
- Validate API keys with `requireApiKey` middleware
- Rate limit API endpoints (use `apiSpeedLimiter`)

## Input Validation

- Always validate user input using `express-validator`
- Use validation middleware: `signupValidation`, `loginValidation`, etc.
- Sanitize file uploads (check file type, size limits)
- Never trust user input - validate and sanitize everything

## Rate Limiting

- Login endpoint: 5 attempts per 15 minutes (`loginLimiter`)
- Signup endpoint: 3 attempts per hour (`signupLimiter`)
- API endpoints: Progressive slowdown (`apiSpeedLimiter`)
- Never disable rate limiting in production

## Security Headers

- Helmet.js is configured in `lib/security.js`
- CSP (Content Security Policy) enabled in production
- HTTPS enforced in production (`requireHTTPS` middleware)
- Never disable security headers

## Secrets & Environment Variables

- Never commit secrets to git
- Use environment variables for all sensitive data
- Validate `SESSION_SECRET` on startup (must be 32+ chars in production)
- Never log environment variables or secrets

## Multi-Tenant Data Isolation

- **CRITICAL**: All database queries MUST include `accountId` filter
- Use functions from `lib/database-multitenant.js` - they handle scoping automatically
- Never query across accounts
- Test multi-tenant isolation after any database changes

## Audit Logging

- Log security events using `auditLog()` from `lib/security.js`
- Log: login attempts, API key usage, permission changes, errors
- Security logs go to `logs/security.log`
- Never log sensitive data (passwords, tokens, API keys)

## File Upload Security

- Validate file types (use `isSupportedFileType()`)
- Limit file size (30MB max configured)
- Scan uploaded files for malicious content
- Store uploads outside web root when possible

## SQL Injection Prevention

- Use Prisma ORM - it handles parameterization automatically
- Never use string concatenation for SQL queries
- If using raw SQL, use Prisma's parameterized queries

## XSS Prevention

- Escape user input when rendering in templates
- Use EJS's built-in escaping (`<%= %>` escapes, `<%- %>` doesn't)
- Never use `<%- %>` with user-provided data
- Validate and sanitize all user input

## Session Security

- Sessions stored in PostgreSQL (production) or memory (dev)
- HTTP-only cookies (JavaScript cannot access)
- Secure cookies in production (HTTPS only)
- Session expiry: 7 days (configured in session setup)

## Error Messages

- Never expose internal errors to users
- Use generic error messages in production
- Log detailed errors server-side only
- Don't reveal if email exists during login (security through obscurity)
