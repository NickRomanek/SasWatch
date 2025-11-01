# Versioning Guide - Quick Start

## Overview

Your project now has a comprehensive versioning system using Git tags. This allows you to:
- Track versions (v0.1.0, v0.2.0, v0.2.1, etc.)
- Restore to any previous version (code only, not database)
- Deploy to Railway automatically when you push

## Quick Start

**One command to rule them all:**

```powershell
.\scripts\git-release.ps1
```

That's it! The script will guide you through everything interactively.

## What the Script Does

1. ✅ **Checks for database schema changes** - Warns you to backup first
2. ✅ **Shows your changes** - What files you've modified
3. ✅ **Asks version type** - Patch (bug fix), Minor (feature), Major (breaking)
4. ✅ **Gets your messages** - Commit message and release description
5. ✅ **Calculates new version** - Automatically bumps version number
6. ✅ **Commits & tags** - Creates commit and version tag
7. ✅ **Pushes to GitHub** - (or keeps local, your choice)

## Three Release Modes

When you run the script, choose:

1. **Full Release** - Everything pushes to GitHub (for production)
2. **Local Only** - Keeps everything local, no push (for testing)
3. **Dry Run** - Shows what would happen, does nothing

## Example Session

```
PS> .\scripts\git-release.ps1

╔════════════════════════════════════════╗
║     Git Release & Versioning Script    ║
╚════════════════════════════════════════╝

Branch: main

What would you like to do?
  1. Full Release (commit + push to GitHub + create tag + push tag)
  2. Local Only (commit locally + create tag locally, no push)
  3. Dry Run (just show what would happen, do nothing)

Enter choice (1-3): 1

[... continues with interactive prompts ...]

✅ Release Complete!
Version: v0.2.1
Railway will auto-deploy from main branch
```

## Restoring Previous Versions

To restore your code to any previous version:

```powershell
# See all versions
git tag

# Restore to a version (e.g., v0.2.0)
git checkout v0.2.0

# Go back to latest
git checkout main
```

**Important:** This restores CODE only. Database changes must be handled with database backups/migrations separately.

## Version Numbering

- **Patch** (v0.2.0 → v0.2.1) - Bug fixes, small changes
- **Minor** (v0.2.0 → v0.3.0) - New features, backwards compatible  
- **Major** (v0.2.0 → v1.0.0) - Breaking changes

## Database Safety

The script automatically detects when you change `prisma/schema.prisma` and warns you to backup your database first.

**The script does NOT backup your database** - you must:
1. Use Railway dashboard backup feature, OR
2. Connect to database and run `pg_dump`

## Your Workflow

1. **Make changes** to your code
2. **Run script**: `.\scripts\git-release.ps1`
3. **Choose mode** (Full/Local/Dry Run)
4. **Answer prompts**
5. **Done!** Railway auto-deploys if you used Full Release

## Files Created

- `scripts/git-release.ps1` - Main versioning script
- `scripts/README-GIT-RELEASE.md` - Detailed reference guide

## Need Help?

See `scripts/README-GIT-RELEASE.md` for:
- Detailed usage examples
- Troubleshooting
- Advanced commands
- Version restoration guide

---

**Ready to version your code!** 🚀

