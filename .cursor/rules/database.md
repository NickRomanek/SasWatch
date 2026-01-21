# Database Rules - Multi-Tenant Architecture

## CRITICAL: Account Scoping

**Every database query MUST include `accountId` filtering.**

This is non-negotiable. SasWatch is a multi-tenant SaaS platform where each organization's data must be completely isolated.

## Using the Database Layer

**Always use functions from `lib/database-multitenant.js`** - they handle account scoping automatically:

```javascript
// ✅ CORRECT - Uses database layer
const users = await db.getUsersData(accountId);

// ❌ WRONG - Direct Prisma query without scoping
const users = await prisma.user.findMany(); // DATA LEAK!
```

## Direct Prisma Queries (When Necessary)

If you must use Prisma directly, **always include `accountId`**:

```javascript
// ✅ CORRECT - Account scoped
const users = await prisma.user.findMany({
    where: { accountId }  // ← REQUIRED
});

// ❌ WRONG - No account scoping
const users = await prisma.user.findMany(); // SECURITY BREACH!
```

## Database Schema

- All tenant-scoped models have `accountId` field
- `accountId` is a foreign key to `Account` table
- Use `onDelete: Cascade` for related models
- Add `@@index([accountId])` for query performance

## Common Patterns

### Getting Account-Scoped Data

```javascript
// Users
const users = await db.getUsersData(accountId, { limit: 100 });

// Usage Events
const events = await db.getUsageData(accountId, { 
    startDate, 
    endDate 
});

// Applications
const apps = await db.getApplications(accountId);
```

### Creating Account-Scoped Records

```javascript
// Create user
const user = await db.createUser(accountId, {
    email: 'user@example.com',
    firstName: 'John',
    lastName: 'Doe',
    licenses: ['Photoshop']
});

// Add usage event
await db.addUsageEvent(accountId, {
    event: 'application_launch',
    url: 'photoshop.exe',
    source: 'desktop',
    // ... other fields
});
```

### Updating Account-Scoped Records

```javascript
// Update user
await db.updateUser(accountId, userId, {
    licenses: ['Photoshop', 'Illustrator']
});

// Always verify the record belongs to the account
const user = await prisma.user.findFirst({
    where: { id: userId, accountId }  // ← Both conditions
});
if (!user) throw new Error('User not found');
```

## Testing Multi-Tenant Isolation

After any database changes, verify isolation:

1. Create Account A with 10 users
2. Create Account B with 5 users
3. Login as Account A → should see 10 users only
4. Login as Account B → should see 5 users only
5. Use Account A's API key → events appear only in Account A
6. Use Account B's API key → events appear only in Account B

## Prisma Schema Changes

When modifying `prisma/schema.prisma`:

1. **Never remove `accountId`** from tenant-scoped models
2. Always add `@@index([accountId])` for new tenant-scoped models
3. Run `npm run db:generate` after schema changes
4. Run `npm run db:push` (dev) or `npm run db:migrate` (prod)
5. Update `lib/database-multitenant.js` if needed

## Database Migrations

- Use `npm run db:push` for development (auto-generates migration)
- Use `npm run db:migrate` for production (creates named migration)
- Never modify existing migrations - create new ones
- Test migrations on a copy of production data first

## Performance

- Use database indexes (already configured in schema)
- Avoid N+1 queries - use Prisma `include`:
  ```javascript
  const users = await prisma.user.findMany({
      where: { accountId },
      include: { windowsUsernames: true }  // ← Single query
  });
  ```
- Use `select` to limit fields when you don't need everything
- Use pagination for large result sets

## Transactions

When modifying multiple related records:

```javascript
await prisma.$transaction(async (tx) => {
    // All operations use same transaction
    const user = await tx.user.create({ data: { accountId, ... } });
    await tx.windowsUsername.create({ 
        data: { userId: user.id, username: '...' } 
    });
});
```

## Error Handling

- Handle Prisma errors gracefully:
  - `P2002`: Unique constraint violation
  - `P2025`: Record not found
  - `P2003`: Foreign key constraint violation
- Use `handleDatabaseError()` from `lib/error-handler.js`

## Connection Management

- Prisma handles connection pooling automatically
- Use `prisma.$disconnect()` only when shutting down
- Don't create multiple Prisma clients - use singleton from `lib/prisma.js`
