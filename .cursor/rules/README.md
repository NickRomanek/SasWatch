# Cursor Rules

This directory contains rules and guidelines for Cursor's AI agent mode. These rules help the AI understand your codebase, coding standards, and constraints.

## Rule Files

- **general.md** - Coding standards, naming conventions, code style
- **security.md** - Security rules, authentication, input validation
- **database.md** - Multi-tenant architecture, account scoping, Prisma patterns
- **forbidden.md** - Protected files that AI cannot modify without approval
- **testing.md** - Testing requirements, TDD workflow, coverage targets, Playwright E2E

## Quick Reference: Running Tests

```bash
cd SasWatch

# Unit & Integration (Vitest)
npm test                    # Run all
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage

# E2E Browser Tests (Playwright) - requires server running!
npm run test:e2e            # Headless
npm run test:e2e:headed     # Visible browser
npm run test:e2e:ui         # Interactive UI
npm run test:e2e:debug      # Debug mode
```

## How It Works

When you use Cursor's Agent Mode (`Cmd/Ctrl + K`), the AI reads these rule files to understand:
- How to structure code
- What patterns to follow
- What files are off-limits
- How to test changes
- Security requirements

## Adding New Rules

To add a new rule file:

1. Create a new `.md` file in `.cursor/rules/`
2. Use clear headings and examples
3. Reference existing code patterns when possible
4. Update this README

## Best Practices

- **Be specific** - Vague rules lead to inconsistent code
- **Use examples** - Show what good code looks like
- **Reference files** - Point to existing implementations
- **Keep updated** - Update rules when patterns change

## Plan Mode

Before implementing complex features, use Cursor's Plan Mode (`Shift + Tab`):
1. AI creates a detailed implementation plan
2. You review and edit the plan
3. AI implements from the approved plan
4. Save successful plans to `.cursor/plans/` for future reference
