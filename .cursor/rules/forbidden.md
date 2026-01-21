# Protected Files - DO NOT MODIFY Without Explicit Approval

## CRITICAL FILES

These files contain core business logic and security. **NEVER modify them without explicit human approval.**

### Authentication & Security
- `lib/auth.js` - Authentication, password hashing, session management
- `lib/security.js` - Security middleware, rate limiting, validation
- `lib/permissions.js` - RBAC permission system

### Database Layer
- `lib/database-multitenant.js` - Account-scoped database operations
- `lib/prisma.js` - Prisma client singleton
- `prisma/schema.prisma` - Database schema

### Server Configuration
- `server.js` - Main server entry point, middleware setup
- `scripts/startup.js` - Application startup logic

## MODIFICATION RULES

### If You Need to Modify a Protected File:

1. **Ask first** - Create a plan explaining why the change is needed
2. **Get approval** - Wait for explicit approval before modifying
3. **Test thoroughly** - Write tests for the change
4. **Document** - Update relevant documentation

### Safe Modification Zones

These areas are safe to modify without approval:

- `views/*.ejs` - UI templates (safe to improve)
- `public/js/*.js` - Client-side JavaScript (safe to improve)
- `public/css/*.css` - Stylesheets (safe to improve)
- `lib/script-generator.js` - PowerShell script generation (safe)
- `lib/intune-package-generator.js` - Intune package creation (safe)
- `lib/email-sender.js` - Email templates (safe, but be careful with logic)
- Route handlers in `server-multitenant-routes.js` (safe, but follow patterns)

## ADDING NEW PROTECTED FILES

If you create a new critical file, add it to this list:

```markdown
- `lib/new-critical-file.js` - Brief description of why it's protected
```

## EMERGENCY MODIFICATIONS

In case of critical bugs or security issues:

1. Document the issue clearly
2. Explain why immediate modification is necessary
3. Make minimal changes
4. Add tests immediately after
5. Create follow-up PR for proper review

## REVIEW CHECKLIST

Before modifying any protected file, verify:

- [ ] I understand why this file is protected
- [ ] I have explicit approval to modify it
- [ ] I've written tests for my changes
- [ ] I've considered security implications
- [ ] I've considered multi-tenant isolation implications
- [ ] I've documented the change
