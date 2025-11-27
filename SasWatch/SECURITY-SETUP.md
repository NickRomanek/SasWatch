# Security Setup Guide

This guide covers the security hardening implemented in SasWatch.

## Overview

SasWatch includes enterprise-grade security features:
- ✅ HTTP security headers (Helmet.js)
- ✅ Rate limiting on authentication endpoints
- ✅ Input validation and sanitization
- ✅ Security audit logging
- ✅ HTTPS enforcement in production
- ✅ Strong session secret requirements

## Quick Start (10 Seconds)

### Automatic Setup

Just start the server - it handles everything automatically!

```bash
npm start
```

The startup script will:
- ✅ Check if SESSION_SECRET exists
- ✅ Generate it automatically if missing
- ✅ Validate it's strong enough (32+ chars)
- ✅ Never regenerate (keeps users logged in)

That's it! 🎉

### Verify Security is Working

**Check 1: Server Starts Successfully**
```
✅ Server should display: "Security headers configured via Helmet.js"
❌ If it fails with SESSION_SECRET error → Run npm run generate-secret
```

**Check 2: Security Headers Present**
```bash
curl -I http://localhost:3000
```
Look for:
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`
- `Content-Security-Policy`

**Check 3: Rate Limiting Works**
Try logging in with wrong password 6 times:
```
✅ Should see: "Too many login attempts. Please try again in 15 minutes."
```

**Check 4: Logs Being Written**
```bash
ls -la logs/
```
You should see:
- `security.log` - Security events
- `error.log` - Errors only

## Manual Setup (5 Minutes)

### Manual Session Secret Generation (Optional)

If you prefer to generate the secret yourself instead of using automatic generation:

**On Linux/Mac:**
```bash
openssl rand -hex 32
```

**On Windows (PowerShell):**
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Or use our helper script:**
```bash
npm run generate-secret
```

### 2. Update Environment Variables

Copy `env.example` to `.env`:
```bash
cp env.example .env
```

Then edit `.env` and set:
```env
SESSION_SECRET=<paste_your_generated_secret_here>
ENFORCE_HTTPS=true  # Set to false for local development only
LOG_LEVEL=info
```

### 3. Create Logs Directory

The logs directory is created automatically, but if needed:
```bash
mkdir -p logs
```

### 4. Test the Application

Start the server:
```bash
npm start
```

The server will **refuse to start** if `SESSION_SECRET` is not set properly!

## Security Features Explained

### HTTP Security Headers (Helmet.js)

Helmet sets secure HTTP headers automatically:
- **Content-Security-Policy**: Prevents XSS attacks
- **Strict-Transport-Security**: Forces HTTPS connections
- **X-Frame-Options**: Prevents clickjacking
- **X-Content-Type-Options**: Prevents MIME sniffing

### Rate Limiting

Protects against brute force attacks:
- **Login**: 5 attempts per 15 minutes
- **Signup**: 3 accounts per hour per IP
- **API endpoints**: Progressive slowdown after 50 requests

### Input Validation

All user inputs are validated before processing:
- **Email**: Proper email format, normalized
- **Password**: Minimum 12 characters, must contain:
  - Uppercase letter (A-Z)
  - Lowercase letter (a-z)
  - Number (0-9)
  - Special character (@$!%*?&)
- **Name**: 2-100 characters, alphanumeric only

### Security Audit Logging

All security events are logged to `logs/security.log`:
- Login attempts (success/failure)
- Signup attempts
- API key regeneration
- Logout events
- Rate limit violations
- Session errors

Log entries include:
- Timestamp
- Action type
- Account ID
- IP address
- User agent
- Request ID (for tracing)

### HTTPS Enforcement

In production (`NODE_ENV=production`), all HTTP requests are automatically redirected to HTTPS.

To disable (local development only):
```env
ENFORCE_HTTPS=false
```

## Password Requirements

Users must create strong passwords:
- Minimum 12 characters (previously 8)
- Must contain uppercase, lowercase, number, and special character
- Special characters allowed: `@$!%*?&`

The signup form provides real-time password strength feedback.

## Monitoring Security Logs

### Daily Monitoring (2 Minutes)

```bash
# View today's security events
tail -100 logs/security.log

# Count failed login attempts today
grep "LOGIN_FAILED" logs/security.log | grep "$(date +%Y-%m-%d)" | wc -l

# Find any rate limit violations
grep "RATE_LIMIT_EXCEEDED" logs/security.log | tail -20
```

### View Recent Security Events
```bash
tail -f logs/security.log
```

### Search for Failed Login Attempts
```bash
grep "LOGIN_FAILED" logs/security.log
```

### Find Rate Limit Violations
```bash
grep "RATE_LIMIT_EXCEEDED" logs/security.log
```

### View Logs in JSON Format
Security logs are in JSON format for easy parsing:
```bash
cat logs/security.log | jq '.'
```

### Common Commands

```bash
# Generate new SESSION_SECRET
npm run generate-secret

# Start server
npm start

# Monitor logs live
tail -f logs/security.log

# Search for specific account activity
grep "accountId123" logs/security.log

# Count login attempts by IP
grep "LOGIN_FAILED" logs/security.log | grep -oP 'ip":"[^"]+' | sort | uniq -c
```

## Security Event Types

| Event | Meaning | Action Required |
|-------|---------|-----------------|
| `LOGIN_SUCCESS` | User logged in | ✅ Normal |
| `LOGIN_FAILED` | Wrong password | ⚠️ Monitor for patterns |
| `SIGNUP_SUCCESS` | New account created | ✅ Normal |
| `RATE_LIMIT_EXCEEDED` | Too many requests | ⚠️ Could be attack |
| `API_KEY_REGENERATED` | API key changed | ℹ️ Expected if user requested |
| `SESSION_ERROR` | Session problem | ⚠️ Check logs |

## Production Deployment Checklist

Before deploying to production:

- [ ] Generate strong `SESSION_SECRET` (32+ characters)
- [ ] Set `NODE_ENV=production`
- [ ] Set `ENFORCE_HTTPS=true`
- [ ] Configure proper database connection
- [ ] Enable SSL/TLS certificates
- [ ] Set up log monitoring/alerting
- [ ] Test rate limiting works
- [ ] Verify HTTPS redirect works
- [ ] Review security logs regularly

## Azure Deployment

### Environment Variables (Azure App Service)

Set these in **Configuration > Application Settings**:

```
SESSION_SECRET=<your-secret-here>
NODE_ENV=production
ENFORCE_HTTPS=true
DATABASE_URL=<azure-postgres-connection-string>
CLIENT_ID=<azure-ad-app-id>
CLIENT_SECRET=<azure-ad-secret>
TENANT_ID=<your-tenant-id>
```

### Recommended Azure Services

- **App Service**: Web hosting
- **Azure Database for PostgreSQL**: Managed database
- **Key Vault**: Store SESSION_SECRET securely
- **Application Insights**: Monitor security logs
- **Azure Front Door**: DDoS protection + CDN

## Troubleshooting

### Server Won't Start

**Error**: `SESSION_SECRET environment variable must be set in production`

**Solution**: Generate and set SESSION_SECRET in `.env` file

### Rate Limit Errors

**Error**: "Too many login attempts"

**Solution**: This is working as designed. Wait 15 minutes or contact admin to clear rate limits.

### Password Validation Fails

**Error**: "Password must contain uppercase, lowercase, number, and special character"

**Solution**: Use a strong password like: `MyP@ssw0rd2024!`

### HTTPS Redirect Loop

**Issue**: Page keeps redirecting

**Solution**: Check `ENFORCE_HTTPS` setting and ensure proxy is configured:
```javascript
app.set('trust proxy', 1);
```

## Security Best Practices

1. **Never commit `.env` file** to version control
2. **Rotate SESSION_SECRET** every 90 days
3. **Monitor security logs** daily
4. **Review failed login attempts** weekly
5. **Update dependencies** monthly: `npm audit fix`
6. **Use strong passwords** for all accounts
7. **Enable 2FA** when available (Phase 2)
8. **Backup logs** regularly

## Emergency Procedures

### Suspicious Activity Detected

```bash
# 1. Get account ID from logs
grep "LOGIN_FAILED" logs/security.log | tail -20

# 2. Check all activity for that account
grep "accountId:abc123" logs/security.log

# 3. If confirmed attack, rotate API key via UI
# Go to Account page → Regenerate API Key
```

### Rotate SESSION_SECRET (Quarterly)

```bash
# 1. Generate new secret
npm run generate-secret

# 2. Update .env with new secret
# (Old sessions will be invalidated - users will need to re-login)

# 3. Restart server
npm start
```

## Security Incident Response

If you detect suspicious activity:

1. **Immediate Actions**:
   - Check `logs/security.log` for patterns
   - Block suspicious IPs (firewall level)
   - Rotate API keys and SESSION_SECRET
   - Force logout all users

2. **Investigation**:
   - Review all `LOGIN_FAILED` events
   - Check for `RATE_LIMIT_EXCEEDED` patterns
   - Look for unusual access times
   - Verify API key regeneration events

3. **Remediation**:
   - Reset affected account passwords
   - Regenerate compromised API keys
   - Update security rules
   - Notify affected users

## Next Steps (Phase 2)

Future security enhancements planned:
- [ ] 2FA/MFA support
- [ ] Azure Key Vault integration
- [ ] CSRF protection
- [ ] Pwned password checking
- [ ] Advanced threat detection
- [ ] SOC2 compliance features

## Support

For security issues or questions, please use the repository's security policy for reporting vulnerabilities.

**Do NOT report security issues via public GitHub Issues!**

## Compliance

This application implements security controls for:
- **OWASP Top 10** protection
- **GDPR** ready (with Phase 2)
- **SOC2** ready (with Phase 3)

For compliance documentation, see `/docs/compliance/`

