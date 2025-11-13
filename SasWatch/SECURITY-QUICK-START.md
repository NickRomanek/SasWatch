# 🔐 Security Quick Start (10 Seconds)

## First Time Setup

```bash
# Just start the server - it handles everything automatically!
npm start
```

That's it! 🎉

The startup script will:
- ✅ Check if SESSION_SECRET exists
- ✅ Generate it automatically if missing
- ✅ Validate it's strong enough (32+ chars)
- ✅ Never regenerate (keeps users logged in)

---

## Manual Generation (Optional)

If you prefer to generate the secret yourself:

```bash
# Generate a new secret
npm run generate-secret

# Copy the output and add to .env file manually
# SESSION_SECRET=<paste-secret-here>
```

---

## Verify Security is Working

### Check 1: Server Starts Successfully
```
✅ Server should display: "Security headers configured via Helmet.js"
❌ If it fails with SESSION_SECRET error → Run npm run generate-secret
```

### Check 2: Security Headers Present
```bash
curl -I http://localhost:3000
```
Look for:
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`
- `Content-Security-Policy`

### Check 3: Rate Limiting Works
Try logging in with wrong password 6 times:
```
✅ Should see: "Too many login attempts. Please try again in 15 minutes."
```

### Check 4: Logs Being Written
```bash
ls -la logs/
```
You should see:
- `security.log` - Security events
- `error.log` - Errors only

---

## Daily Monitoring (2 Minutes)

```bash
# View today's security events
tail -100 logs/security.log

# Count failed login attempts today
grep "LOGIN_FAILED" logs/security.log | grep "$(date +%Y-%m-%d)" | wc -l

# Find any rate limit violations
grep "RATE_LIMIT_EXCEEDED" logs/security.log | tail -20
```

---

## Production Deployment Checklist

```bash
# ✅ Required Environment Variables
SESSION_SECRET=<strong-secret>
NODE_ENV=production
ENFORCE_HTTPS=true
DATABASE_URL=<postgres-url>

# ✅ Optional but Recommended
LOG_LEVEL=info
```

---

## Common Commands

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

---

## Security Event Types

| Event | Meaning | Action Required |
|-------|---------|-----------------|
| `LOGIN_SUCCESS` | User logged in | ✅ Normal |
| `LOGIN_FAILED` | Wrong password | ⚠️ Monitor for patterns |
| `SIGNUP_SUCCESS` | New account created | ✅ Normal |
| `RATE_LIMIT_EXCEEDED` | Too many requests | ⚠️ Could be attack |
| `API_KEY_REGENERATED` | API key changed | ℹ️ Expected if user requested |
| `SESSION_ERROR` | Session problem | ⚠️ Check logs |

---

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

---

## Need Help?

📖 **Full Documentation**: See `SECURITY-SETUP.md`  
📋 **Implementation Details**: See `PHASE1-SECURITY-COMPLETE.md`  
🐛 **Troubleshooting**: See section in `SECURITY-SETUP.md`

---

**Remember**: Security is a continuous process, not a one-time setup!

