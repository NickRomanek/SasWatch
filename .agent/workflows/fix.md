# Auto-Fix Command

Fix linting errors, type issues, and common code problems automatically.

## Process

1. **Identify issues**: Run linter on recently changed files
2. **Auto-fix**: Apply automatic fixes where possible
3. **Manual fixes**: For issues that can't be auto-fixed, make the changes manually
4. **Verify**: Ensure no new issues were introduced
5. **Test**: Run tests to confirm fixes don't break functionality

## Commands

```bash
# Check for linting issues
cd SasWatch && npm run lint

# Auto-fix where possible (if configured)
cd SasWatch && npm run lint -- --fix

# Check specific files
cd SasWatch && npx eslint lib/database-multitenant.js --fix
```

## Common Issues to Fix

- Missing semicolons or trailing commas
- Unused variables or imports
- Inconsistent indentation
- Missing JSDoc comments on public functions
- Console.log statements left in production code

## Rules

- Never remove console.log statements that are intentional logging
- Preserve existing code style and patterns
- Don't change formatting in files you didn't modify
- Run tests after fixing to catch any regressions
