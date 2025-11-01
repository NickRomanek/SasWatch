# Git Release Script - Quick Reference

## Overview

The `git-release.ps1` script is a comprehensive versioning tool that helps you:
- Commit changes with proper messages
- Create semantic version tags (v0.1.0, v0.2.0, etc.)
- Restore to any previous version
- Handle database schema change warnings

## Usage

```powershell
# From project root directory
.\scripts\git-release.ps1
```

Just run it - no parameters needed! It will ask you everything interactively.

## Features

### Three Release Modes

1. **Full Release** - Commits, pushes to GitHub, creates and pushes tag (for production)
2. **Local Only** - Commits locally and creates tag locally, doesn't push (for testing)
3. **Dry Run** - Shows what would happen without making any changes

### Database Safety

The script automatically detects when you've changed `prisma/schema.prisma` and warns you to backup your database before proceeding. **This script helps with code versioning, but you must backup your database separately.**

### Semantic Versioning

- **Patch** (v0.2.0 → v0.2.1) - Bug fixes, small changes
- **Minor** (v0.2.0 → v0.3.0) - New features, backwards compatible
- **Major** (v0.2.0 → v1.0.0) - Breaking changes, major updates

## Workflow Example

```
1. Make your code changes
2. Run: .\scripts\git-release.ps1
3. Choose mode (Full/Local/Dry Run)
4. Choose version type (Patch/Minor/Major)
5. Enter commit message
6. Enter release description
7. Confirm and done!
```

## Restoring from Backup

To restore your code to a previous version (excluding database):

```powershell
# See all available versions
git tag

# Restore to a specific version
git checkout v0.2.0

# Or checkout by tag name
git checkout v0.3.1

# To go back to latest
git checkout main
```

**Note:** This restores code only. Database changes must be handled separately with database backups/migrations.

## Important Notes

- **Database Backups**: This script does NOT backup your database. You must backup separately using Railway dashboard or `pg_dump` before schema changes.

- **Railway Deployment**: Railway auto-deploys from your `main` branch. When you push commits and tags, Railway will automatically deploy.

- **Local Testing**: Use "Local Only" mode to test your release process without pushing to GitHub.

## Quick Commands Reference

```powershell
# Create release
.\scripts\git-release.ps1

# List all version tags
git tag

# See current version
git describe --tags --abbrev=0

# Restore to a version
git checkout v0.2.0

# See what changed between versions
git diff v0.2.0 v0.2.1

# Push local tag to GitHub (if you used Local Only mode)
git push origin v0.2.0
```

## Troubleshooting

**Problem:** Script says "No existing tags found"
- **Solution:** This is fine! It will start at v0.1.0

**Problem:** Can't push to GitHub
- **Solution:** Check your internet connection and GitHub credentials

**Problem:** Schema warning but I didn't change the database
- **Solution:** The script checks if schema.prisma file was modified. Make sure you committed previous schema changes.

**Problem:** Want to undo a tag
- **Solution:** 
  ```powershell
  # Delete local tag
  git tag -d v0.2.1
  # Delete remote tag
  git push origin --delete v0.2.1
  ```

