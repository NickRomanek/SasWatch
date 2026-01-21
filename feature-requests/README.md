# Feature Requests & Implementation System

This directory contains the autonomous feature development system.

## Quick Start

**Ready to implement your first feature?**

1. Check the backlog: `backlog.json`
2. Read the guide: `HOW-TO-IMPLEMENT-FEATURE.md` (in root)
3. Pick a feature and start!

## Directory Structure

```
feature-requests/
├── README.md                    # This file
├── backlog.json                 # Prioritized feature queue
├── templates/
│   └── feature-spec.md          # Template for new features
└── completed/
    └── YYYY-MM-DD-*.json        # Completed feature logs
```

## Current Backlog

No pending features.

Recently completed:
- `api-inactive-users` - API Endpoint for Inactive Users (2026-01-19)

## Adding a New Feature

1. Edit `backlog.json`
2. Add feature entry with:
   - ID (kebab-case)
   - Title & description
   - Priority (1=high, 2=medium, 3=low)
   - Acceptance criteria
   - Files to modify
   - Protected files check

Example:
```json
{
  "id": "feature-name",
  "title": "Feature Title",
  "description": "What problem does this solve?",
  "priority": 1,
  "status": "ready",
  "acceptanceCriteria": [
    "Requirement 1",
    "Requirement 2"
  ],
  "filesToModify": [
    "path/to/file.js"
  ],
  "protectedFiles": [],
  "readyForImplementation": true
}
```

## Completing a Feature

After implementation:

1. Create completion log in `completed/`:
   - `YYYY-MM-DD-feature-id.json`
   - Include: test results, lessons learned, next steps

2. Update backlog:
   ```json
   {
     "status": "completed",
     "completedDate": "2026-01-19"
   }
   ```

3. Update rules if needed (`.cursor/rules/`)

## Workflow

See `HOW-TO-IMPLEMENT-FEATURE.md` in the root directory for the complete step-by-step guide.

**TL;DR:**
1. Pick feature from backlog
2. Check protected files (get approval if needed)
3. Write tests first (TDD)
4. Implement feature
5. Run tests (must pass)
6. Push → CI runs automatically
7. Create PR → Review → Merge
8. Document completion

## CI/CD

GitHub Actions automatically:
- Runs tests on every push
- Reports results in PR
- Blocks merge if tests fail

Workflow: `.github/workflows/test-saswatch.yml`

## Protected Files

**Before implementing,** check if feature requires modifying:

**Forbidden** (explicit approval required):
- `lib/auth.js`
- `lib/security.js`
- `prisma/schema.prisma`
- `server.js`

**Caution** (approval recommended):
- `lib/database-multitenant.js`

If yes, **request approval first**!

## Help

- Workflow guide: `HOW-TO-IMPLEMENT-FEATURE.md`
- AI guide: `.cursor/rules/autonomous-workflow.md`
- Contributing: `CONTRIBUTING.md`
