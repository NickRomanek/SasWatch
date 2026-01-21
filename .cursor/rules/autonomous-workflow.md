# Autonomous Development Workflow

This file guides the AI on how to implement features autonomously.

## Workflow Steps

When implementing a new feature, follow this process:

### 1. Planning Phase

- **Read the request carefully** - Understand what the user wants
- **Check existing code** - Look for similar patterns in the codebase
- **Review rules** - Check `.cursor/rules/` for constraints
- **Create a plan** (if using Plan Mode) - Break down into steps

### 2. Implementation Phase

- **Write tests first** (TDD) - Define expected behavior
- **Implement feature** - Follow existing patterns
- **Ensure account scoping** - All database queries must include `accountId`
- **Add error handling** - Use `AppError` from `lib/error-handler.js`
- **Follow naming conventions** - See `general.md`

### 3. Testing Phase

- **Run tests** - `npm test` must pass
- **Verify isolation** - Multi-tenant data isolation works
- **Check coverage** - New code should have tests

### 4. Review Phase

- **Self-review** - Check code follows patterns
- **Document changes** - Add JSDoc comments
- **Update tests** - Ensure all edge cases covered

## Protected Files

**NEVER modify these without explicit approval:**
- `lib/auth.js`
- `lib/security.js`
- `lib/database-multitenant.js`
- `prisma/schema.prisma`
- `server.js`

If a feature requires modifying these, **STOP and ask for approval first**.

## Common Patterns

### Adding a New API Endpoint

```javascript
// 1. Add route in server-multitenant-routes.js
app.get('/api/new-endpoint', auth.requireAuth, async (req, res) => {
    const accountId = req.session.accountId;
    // Use accountId for all queries
    const data = await db.getData(accountId);
    res.json(data);
});

// 2. Add function to lib/database-multitenant.js
async function getData(accountId) {
    return await prisma.model.findMany({
        where: { accountId } // ← Always include accountId
    });
}

// 3. Write tests
test('should return data for account', async () => {
    const data = await db.getData(accountId);
    expect(data).toBeArray();
    expect(data.every(d => d.accountId === accountId)).toBe(true);
});
```

### Adding a New Database Model

1. Add to `prisma/schema.prisma` with `accountId` field
2. Add `@@index([accountId])` for performance
3. Run `npm run db:generate` and `npm run db:push`
4. Add operations to `lib/database-multitenant.js`
5. Write tests for multi-tenant isolation

### Adding a New UI Feature

1. Add route in `server-multitenant-routes.js`
2. Create/update EJS template in `views/`
3. Add client-side JS in `public/js/` if needed
4. Test the flow manually or with E2E tests

## Testing Requirements

Every feature must include:

1. **Unit tests** - Test individual functions
2. **Integration tests** - Test API endpoints
3. **Isolation tests** - Verify multi-tenant isolation
4. **Error handling tests** - Test failure cases

## Success Criteria

A feature is complete when:

- ✅ Tests pass (`npm test`)
- ✅ Code follows patterns from `.cursor/rules/`
- ✅ Multi-tenant isolation verified
- ✅ Error handling in place
- ✅ JSDoc comments added
- ✅ No console.log() in production code

## When to Ask for Help

Ask the user if:

- Feature requires modifying protected files
- You're unsure about security implications
- Database schema changes are needed
- Feature conflicts with existing patterns
- Tests are failing and you can't fix them

## Example: Complete Feature Implementation

**User Request:** "Add a function to get inactive users (no activity in 30 days)"

**AI Process:**

1. **Plan:**
   - Add function to `lib/database-multitenant.js`
   - Add route to `server-multitenant-routes.js`
   - Write tests

2. **Implement:**
   ```javascript
   // lib/database-multitenant.js
   async function getInactiveUsers(accountId, daysInactive = 30) {
       const cutoffDate = new Date();
       cutoffDate.setDate(cutoffDate.getDate() - daysInactive);
       
       return await prisma.user.findMany({
           where: {
               accountId, // ← Account scoped
               OR: [
                   { lastActivity: null },
                   { lastActivity: { lt: cutoffDate } }
               ]
           }
       });
   }
   ```

3. **Test:**
   ```javascript
   test('should return inactive users for account', async () => {
       const inactive = await db.getInactiveUsers(accountId, 30);
       expect(inactive.every(u => u.accountId === accountId)).toBe(true);
   });
   ```

4. **Verify:**
   - Run `npm test`
   - Check isolation works
   - Confirm error handling

**Result:** Feature complete, tested, and ready for review!
