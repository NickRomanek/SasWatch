# Self-Healing Test Loop

Run the test suite and automatically fix any failures.

## Process

1. **Run tests**: Execute `cd SasWatch && npm test`
2. **Analyze failures**: If tests fail, carefully read the error output
3. **Fix the code**: Fix the failing code (not the tests, unless the tests themselves are wrong)
4. **Re-run tests**: Verify the fix worked
5. **Iterate**: Repeat until all tests pass or ask for help after 3 failed attempts

## Rules

- Always fix the implementation code first, not the tests
- If a test seems incorrect, explain why before modifying it
- Check multi-tenant isolation after any database-related fixes
- Run the full test suite, not just the failing test, to catch regressions

## Commands

```bash
# Run all tests
cd SasWatch && npm test

# Run specific test file
cd SasWatch && npm test __tests__/unit/lib/auth.test.js

# Run with verbose output
cd SasWatch && npm test -- --reporter=verbose
```

## Success Criteria

- All tests pass (`npm test` exits with code 0)
- No new linting errors introduced
- Multi-tenant isolation maintained
