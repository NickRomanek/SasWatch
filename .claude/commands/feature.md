# TDD Feature Implementation

Implement a feature using Test-Driven Development methodology.

## Process

1. **Understand requirements**: Read the feature request carefully
2. **Write failing tests**: Define expected behavior through tests FIRST
3. **Verify tests fail**: Run tests to confirm they fail (red phase)
4. **Implement minimum code**: Write just enough code to pass tests (green phase)
5. **Refactor**: Improve code while keeping tests green (refactor phase)
6. **Verify isolation**: If database involved, test multi-tenant isolation

## Test-First Approach

```javascript
// Example: Write test BEFORE implementation
describe('getInactiveUsers', () => {
    test('should return users with no activity in 30 days', async () => {
        // Arrange - setup test data
        const accountId = 'test-account';
        
        // Act - call the function
        const inactive = await db.getInactiveUsers(accountId, 30);
        
        // Assert - verify expected behavior
        expect(inactive).toBeArray();
        expect(inactive.every(u => u.accountId === accountId)).toBe(true);
    });
});
```

## Multi-Tenant Isolation Test

Always include isolation tests for database features:

```javascript
test('should not return users from other accounts', async () => {
    const accountA = 'account-a';
    const accountB = 'account-b';
    
    // Create users in both accounts
    await db.createUser(accountA, { email: 'a@test.com' });
    await db.createUser(accountB, { email: 'b@test.com' });
    
    // Query should only return own account's users
    const usersA = await db.getInactiveUsers(accountA);
    expect(usersA.every(u => u.accountId === accountA)).toBe(true);
});
```

## Commands

```bash
# Run tests in watch mode during development
cd SasWatch && npm run test:watch

# Run specific test file
cd SasWatch && npm test __tests__/unit/lib/new-feature.test.js

# Run with coverage to ensure good coverage
cd SasWatch && npm run test:coverage
```

## Checklist

- [ ] Tests written BEFORE implementation
- [ ] Tests initially fail (red)
- [ ] Implementation makes tests pass (green)
- [ ] Code refactored for clarity
- [ ] Multi-tenant isolation verified
- [ ] All existing tests still pass
- [ ] JSDoc comments added
- [ ] No console.log in production code
