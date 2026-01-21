# Cleanup Plan - Codebase Cleanup

## Files to DELETE

### 1. `assets/` folder
- **Reason**: Temporary Cursor workspace images (6 PNG files)
- **Action**: Delete entire folder

### 2. `SubTracker/` directory
- **Reason**: Unused duplicate views directory (not referenced in codebase)
- **Action**: Delete entire directory

### 3. `SETUP-COMPLETE.md`
- **Reason**: Overlaps with `AUTONOMOUS-DEV-SETUP.md` (more comprehensive)
- **Action**: Delete file

### 4. `TEST-SETUP-GUIDE.md`
- **Reason**: Overlaps with `QUICK-START-TESTING.md` (more concise)
- **Action**: Delete file

### 5. `HOW-TO-IMPLEMENT-FEATURE.md`
- **Reason**: Covered by `FIRST-AUTONOMOUS-FEATURE.md` and `.cursor/rules/autonomous-workflow.md`
- **Action**: Delete file

## Files to UPDATE

### 1. `SasWatch/package.json`
- Change `name` from `"subtracker"` to `"saswatch"`
- Update `description` to reflect SasWatch purpose

### 2. `SasWatch/docker-compose.yml`
- Change `container_name` from `subtracker-postgres` to `saswatch-postgres`
- Change `POSTGRES_DB` from `subtracker` to `saswatch`

### 3. `SasWatch/scripts/test-quick-start.ps1`
- Update container name references from `subtracker-postgres` to `saswatch-postgres`

### 4. `SasWatch/scripts/ai-feature-workflow.ps1`
- Update container name references from `subtracker-postgres` to `saswatch-postgres`

### 5. `SasWatch/prisma/schema.prisma`
- Update comment from "SubTracker" to "SasWatch"

### 6. `SasWatch/env.example`
- Update database name reference from `subtracker` to `saswatch`

### 7. `SasWatch/lib/database-multitenant.js`
- Change "SubTracker" to "SasWatch" (line 104)

### 8. `SasWatch/server-multitenant-routes.js`
- Change all "SubTracker" references to "SasWatch" (7 occurrences)

## Summary

- **5 files/directories to delete**
- **8 files to update**
- **All changes maintain functionality while improving consistency**
