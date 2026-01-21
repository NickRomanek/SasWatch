# Testing Guide

This directory contains all tests for SasWatch. The test suite uses **Vitest** for fast, reliable testing.

## Test Structure

```
__tests__/
├── setup.js                    # Global test setup (runs before all tests)
├── unit/                       # Fast, isolated unit tests
│   └── lib/                   # Test library functions
├── integration/               # API and database integration tests
│   └── multi-tenant-isolation.test.js  # CRITICAL: Data isolation tests
└── e2e/                       # End-to-end browser tests (coming soon)
    └── flows/                 # User flow tests
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test __tests__/unit/lib/auth.test.js

# Run tests matching a pattern
npm test -- --grep "multi-tenant"
```

## Test Database Setup

Tests use a separate test database. Set the `DATABASE_URL` environment variable:

```bash
# In .env.test or set before running tests
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/saswatch_test
```

Or use the default (configured in `__tests__/setup.js`).

## Writing Tests

### Unit Tests

Test individual functions in isolation:

```javascript
const { describe, test, expect } = require('vitest');
const { hashPassword } = require('../../lib/auth');

describe('hashPassword', () => {
  test('should hash password successfully', async () => {
    const hash = await hashPassword('password123');
    expect(hash).toBeDefined();
    expect(hash).not.toBe('password123');
  });
});
```

### Integration Tests

Test API endpoints and database operations:

```javascript
const { describe, test, expect, beforeEach } = require('vitest');
const db = require('../../lib/database-multitenant');

describe('getUsersData', () => {
  let accountId;

  beforeEach(async () => {
    // Setup test data
    const account = await prisma.account.create({ ... });
    accountId = account.id;
  });

  test('should return users for account', async () => {
    const users = await db.getUsersData(accountId);
    expect(users).toBeArray();
  });
});
```

## Multi-Tenant Isolation Tests

**CRITICAL**: Always test that data isolation works correctly. See `integration/multi-tenant-isolation.test.js` for examples.

Every test that touches the database should verify:
1. Account A can only see its own data
2. Account B can only see its own data
3. No cross-account data leakage

## Test Coverage

Current coverage targets:
- **Overall**: 70%+
- **Critical paths** (auth, multi-tenant): 90%+
- **New code**: 80%+ required

View coverage report:
```bash
npm run test:coverage
# Open coverage/index.html in browser
```

## Best Practices

1. **Isolate tests** - Each test should be independent
2. **Clean up** - Use `afterEach` to clean up test data
3. **Use descriptive names** - `test('should return 401 when API key is invalid')`
4. **Test edge cases** - Null, empty, boundary values
5. **Test error cases** - What happens when things go wrong?
6. **Keep tests fast** - Unit tests should run in < 100ms each

## Troubleshooting

### Tests fail with database connection error

Make sure PostgreSQL is running and `DATABASE_URL` is set correctly.

### Tests are slow

- Use `beforeEach`/`afterEach` instead of `beforeAll`/`afterAll` when possible
- Mock external APIs instead of calling them
- Use transactions for faster cleanup

### Coverage is low

Run `npm run test:coverage` to see which files need more tests. Focus on:
- `lib/auth.js` - Authentication logic
- `lib/database-multitenant.js` - Data layer
- `lib/security.js` - Security middleware
