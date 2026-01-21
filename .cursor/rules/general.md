# General Coding Standards

## Code Style

- Use **arrow functions** for callbacks and short functions
- Use **async/await** instead of promises chains
- Use **const** by default, **let** only when reassignment is needed
- Use **camelCase** for variables and functions
- Use **PascalCase** for classes and constructors
- Use **UPPER_SNAKE_CASE** for constants

## Naming Conventions

- Functions: `getUsersData()`, `createAccount()`, `validateInput()`
- Variables: `accountId`, `userEmail`, `isActive`
- Files: `auth.js`, `database-multitenant.js`, `script-generator.js`
- Routes: Use RESTful conventions (`/api/users`, `/api/track`)

## Error Handling

- Always use `try/catch` for async operations
- Use `AppError` class from `lib/error-handler.js` for application errors
- Never expose internal errors to users in production
- Log errors with context using `logApplicationError()` from `lib/security.js`

## Code Organization

- Keep functions focused and single-purpose
- Extract complex logic into separate functions
- Use meaningful variable names (avoid abbreviations)
- Add JSDoc comments for public functions
- Group related functions together

## Comments

- Write **why**, not **what** (code should be self-documenting)
- Use JSDoc for function documentation:
  ```javascript
  /**
   * Get users for an account with activity data
   * @param {string} accountId - The account UUID
   * @param {Object} [options] - Query options
   * @returns {Promise<User[]>} Array of users
   */
  ```

## Dependencies

- Prefer built-in Node.js modules when possible
- Use established libraries (express, prisma, bcrypt)
- Avoid adding new dependencies without justification
- Keep dependencies up to date (use Dependabot)

## Performance

- Use database indexes for frequently queried fields
- Avoid N+1 queries (use Prisma `include` or `select`)
- Cache expensive operations when appropriate
- Use `compression()` middleware for responses

## Testing

- Write tests for all new features
- Test happy paths, error cases, and edge cases
- Use descriptive test names: `test('should return 401 when API key is invalid')`
- Keep tests isolated (no shared state between tests)
- Run tests before committing: `npm test`
