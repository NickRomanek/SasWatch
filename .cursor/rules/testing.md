# Testing Rules

## Test-Driven Development (TDD)

When implementing new features:

1. **Write tests first** - Define expected behavior
2. **Run tests** - They should fail initially
3. **Implement feature** - Make tests pass
4. **Refactor** - Improve code while keeping tests green

## Test Structure

```
__tests__/
├── unit/              # Fast, isolated tests (Vitest)
│   ├── lib/          # Test library functions
│   └── utils/        # Test utility functions
├── integration/      # Test API endpoints with real DB (Vitest)
│   ├── api/          # Test API routes
│   └── routes/       # Test route handlers
└── e2e/              # Full browser tests
    ├── playwright/   # Playwright browser automation tests
    └── *.test.js     # Legacy fetch-based E2E tests (Vitest)
```

## Testing Frameworks

### Vitest (Unit & Integration Tests)
- **Config**: `vitest.config.js`
- **Test files**: `__tests__/**/*.test.js`
- **Setup**: `__tests__/setup.js`

### Playwright (E2E Browser Tests)
- **Config**: `playwright.config.js`
- **Test files**: `__tests__/e2e/playwright/*.spec.js`
- **Browser**: Chromium (default)
- **Base URL**: `http://localhost:3000` (override with `TEST_BASE_URL` env var)

## Test Requirements

### Unit Tests
- Test individual functions in isolation
- Mock external dependencies (database, APIs)
- Fast execution (< 100ms per test)
- High coverage of business logic

### Integration Tests
- Test API endpoints with real database
- Use test database (separate from production)
- Clean up after each test
- Test multi-tenant isolation

### E2E Tests (Playwright)
- Test complete user flows with real browser automation
- Use Playwright for browser control (clicks, form fills, navigation)
- Test critical paths: login, signup, data isolation
- Run in CI, not in watch mode
- Requires server running on localhost:3000

**Playwright Test Files Location**: `__tests__/e2e/playwright/*.spec.js`

**Example Playwright Test**:
```javascript
import { test, expect } from '@playwright/test';

test('should login successfully', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('user@example.com');
    await page.locator('#password').fill('password');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL('/');
});
```

## Writing Tests

### Test Naming

```javascript
// ✅ GOOD - Descriptive
test('should return 401 when API key is invalid')
test('should filter users by license type')
test('should prevent Account A from accessing Account B data')

// ❌ BAD - Vague
test('auth works')
test('users')
test('test 1')
```

### Test Structure

```javascript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

describe('getUsersData', () => {
    beforeEach(() => {
        // Setup test data
    });

    afterEach(() => {
        // Cleanup
    });

    test('should return users for account', async () => {
        // Arrange
        const accountId = 'test-account-id';
        
        // Act
        const users = await db.getUsersData(accountId);
        
        // Assert
        expect(users).toBeArray();
        expect(users.every(u => u.accountId === accountId)).toBe(true);
    });

    test('should return empty array for non-existent account', async () => {
        const users = await db.getUsersData('non-existent');
        expect(users).toEqual([]);
    });
});
```

## Test Coverage Requirements

- **Minimum**: 70% overall coverage
- **Critical paths**: 90%+ coverage (auth, multi-tenant isolation)
- **New code**: 80%+ coverage required

## Multi-Tenant Isolation Tests

**Always test data isolation:**

```javascript
test('should prevent cross-account data access', async () => {
    // Create two accounts
    const accountA = await createTestAccount('account-a@test.com');
    const accountB = await createTestAccount('account-b@test.com');
    
    // Create users for each account
    await db.createUser(accountA.id, { email: 'user-a@test.com', ... });
    await db.createUser(accountB.id, { email: 'user-b@test.com', ... });
    
    // Account A should only see its users
    const usersA = await db.getUsersData(accountA.id);
    expect(usersA).toHaveLength(1);
    expect(usersA[0].email).toBe('user-a@test.com');
    
    // Account B should only see its users
    const usersB = await db.getUsersData(accountB.id);
    expect(usersB).toHaveLength(1);
    expect(usersB[0].email).toBe('user-b@test.com');
});
```

## Running Tests

### Vitest (Unit & Integration)
```bash
# Run all unit/integration tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test __tests__/unit/lib/auth.test.js

# Run tests matching pattern
npm test -- --grep "multi-tenant"
```

### Playwright (E2E Browser Tests)
```bash
# IMPORTANT: Start the server first!
npm run dev  # In one terminal

# Run all Playwright E2E tests (headless)
npm run test:e2e

# Run with visible browser (useful for debugging)
npm run test:e2e:headed

# Run with Playwright UI (interactive test runner)
npm run test:e2e:ui

# Run in debug mode (step through tests)
npm run test:e2e:debug

# Run specific test file
npx playwright test login.spec.js

# Run tests matching pattern
npx playwright test --grep "login"
```

### Environment Variables for Testing
```bash
TEST_EMAIL=nick@romatekai.com     # Test user email
TEST_PASSWORD=password             # Test user password
TEST_BASE_URL=http://localhost:3000  # Server URL
```

## Test Database

- Use separate test database (configured via `DATABASE_URL` in test env)
- Reset database before test suite runs
- Use transactions when possible for faster cleanup
- Never use production database for tests

## Mocking

- Mock external APIs (Microsoft Graph, email sending)
- Mock file system operations when appropriate
- Don't mock Prisma - use real test database for integration tests
- Use Vitest's `vi.mock()` for mocking

## CI/CD

- All tests must pass before merge
- Run tests on every PR
- Fail CI if coverage drops below threshold
- Run E2E tests on main branch only (slower)

## Debugging Tests

### Vitest Debugging
- Use `console.log()` temporarily (remove before commit)
- Use `--reporter=verbose` for detailed output
- Use `--no-coverage` for faster runs during debugging
- Use debugger in VS Code/Cursor

### Playwright Debugging
- Use `npm run test:e2e:debug` for step-through debugging
- Use `npm run test:e2e:headed` to see browser actions
- Use `npm run test:e2e:ui` for interactive test runner
- Check `playwright-report/` for HTML reports after test runs
- Screenshots saved on failure to `test-results/`
- Use `await page.pause()` to pause execution mid-test

### Playwright Trace Viewer
```bash
# View trace from failed test
npx playwright show-trace test-results/path-to-trace.zip
```

## Playwright Test Patterns

### Login Before Tests
```javascript
test.describe('Authenticated Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.locator('#email').fill(process.env.TEST_EMAIL);
        await page.locator('#password').fill(process.env.TEST_PASSWORD);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL('/');
    });

    test('should access protected page', async ({ page }) => {
        await page.goto('/users');
        await expect(page).toHaveURL('/users');
    });
});
```

### Testing API with Authentication
```javascript
test('should access API after login', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.locator('#email').fill(TEST_EMAIL);
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL('/');

    // Make authenticated API call via page context
    const response = await page.evaluate(async () => {
        const res = await fetch('/api/users/inactive');
        return { status: res.status, data: await res.json() };
    });

    expect(response.status).toBe(200);
});
```

### Common Selectors
- `#email` - Email input field
- `#password` - Password input field  
- `button[type="submit"]` - Form submit button
- `.error-message` - Error message display
- `a[href="/signup"]` - Links by href
