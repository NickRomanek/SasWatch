# Interactive Git Release Script
# Comprehensive versioning with tagging and backup awareness
# Usage: .\scripts\git-release.ps1
# Run from project root directory

function Show-Header {
    Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║     Git Release & Versioning Script    ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Test-GitHubConnection {
    Write-Host "Testing connection to GitHub..." -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri "https://github.com" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        Write-Host "✅ Connection to GitHub successful" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Cannot reach GitHub" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
        return $false
    }
}

function Handle-GitHubAuth {
    Write-Host ""
    Write-Host "GitHub Authentication Help" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "You may need to authenticate with GitHub." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  1. Try pushing now (will prompt for credentials)" -ForegroundColor White
    Write-Host "  2. Install GitHub CLI and login (recommended)" -ForegroundColor White
    Write-Host "  3. Skip push (keep changes local)" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "Enter choice (1-3)"
    
    switch ($choice) {
        "1" {
            Write-Host ""
            Write-Host "Attempting push (will prompt for credentials)..." -ForegroundColor Yellow
            Write-Host "Username: Use your GitHub username" -ForegroundColor Gray
            Write-Host "Password: Use a Personal Access Token (not password)" -ForegroundColor Gray
            Write-Host "Get token: https://github.com/settings/tokens" -ForegroundColor Gray
            Write-Host ""
            return "retry"
        }
        "2" {
            Write-Host ""
            Write-Host "Installing GitHub CLI..." -ForegroundColor Yellow
            try {
                winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements
                Write-Host "✅ GitHub CLI installed" -ForegroundColor Green
                Write-Host "Running: gh auth login" -ForegroundColor Yellow
                gh auth login
                return "retry"
            }
            catch {
                Write-Host "❌ Failed to install GitHub CLI" -ForegroundColor Red
                Write-Host "   Install manually: winget install GitHub.cli" -ForegroundColor Gray
                return "skip"
            }
        }
        "3" {
            return "skip"
        }
        default {
            return "skip"
        }
    }
}

function Show-Summary {
    param(
        [string]$Mode,
        [string]$Version,
        [string]$Type,
        [string]$TagMessage,
        [string]$CommitMessage,
        [bool]$HasChanges,
        [bool]$SchemaChanged
    )
    
    Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Release Summary" -ForegroundColor Cyan
    Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Mode: " -NoNewline -ForegroundColor Gray
    Write-Host $Mode -ForegroundColor $(switch ($Mode) {
        "Full Release" { "Green" }
        "Local Only" { "Yellow" }
        "Dry Run" { "Cyan" }
    })
    Write-Host "  Version: " -NoNewline -ForegroundColor Gray
    Write-Host $Version -ForegroundColor Green
    Write-Host "  Type: " -NoNewline -ForegroundColor Gray
    Write-Host $Type -ForegroundColor White
    Write-Host "  Tag Message: " -NoNewline -ForegroundColor Gray
    Write-Host $TagMessage -ForegroundColor White
    if ($HasChanges) {
        Write-Host "  Commit Message: " -NoNewline -ForegroundColor Gray
        Write-Host $CommitMessage -ForegroundColor White
    }
    if ($SchemaChanged) {
        Write-Host "  ⚠️  Database Schema Changed!" -ForegroundColor Red
    }
    Write-Host ""
}

Show-Header

# Get current status
$currentBranch = git branch --show-current
$status = git status --short

# Get current version/tag
$latestTag = git describe --tags --abbrev=0 2>$null

Write-Host "Current Status:" -ForegroundColor Cyan
Write-Host "  Branch: " -NoNewline -ForegroundColor Gray
Write-Host $currentBranch -ForegroundColor $(switch ($currentBranch) {
    "main" { "Red" }
    "develop" { "Yellow" }
    default { "Green" }
})

if ($latestTag) {
    Write-Host "  Current Version: " -NoNewline -ForegroundColor Gray
    Write-Host $latestTag -ForegroundColor Green
} else {
    Write-Host "  Current Version: " -NoNewline -ForegroundColor Gray
    Write-Host "None (starting fresh)" -ForegroundColor Yellow
}

Write-Host ""

# ============================================
# Step 0: Choose Release Mode
# ============================================
Write-Host "What would you like to do?" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. " -NoNewline -ForegroundColor Yellow
Write-Host "Full Release (commit + push to GitHub + create tag + push tag)" -ForegroundColor White
Write-Host "  2. " -NoNewline -ForegroundColor Yellow
Write-Host "Local Only (commit locally + create tag locally, no push)" -ForegroundColor White
Write-Host "  3. " -NoNewline -ForegroundColor Yellow
Write-Host "Dry Run (just show what would happen, do nothing)" -ForegroundColor White
Write-Host ""
$modeChoice = Read-Host "Enter choice (1-3)"

switch ($modeChoice) {
    "1" { $mode = "full"; $modeDisplay = "Full Release" }
    "2" { $mode = "local"; $modeDisplay = "Local Only" }
    "3" { $mode = "dryrun"; $modeDisplay = "Dry Run" }
    default {
        Write-Host "Invalid choice. Cancelled." -ForegroundColor Yellow
        exit
    }
}

Write-Host ""

# ============================================
# Step 1: Check for Database Schema Changes (FIRST - Before Committing)
# ============================================
$schemaChanged = $false
$schemaPath = $null

# Check for schema file in different possible locations
if (Test-Path "SubTracker/prisma/schema.prisma") {
    $schemaPath = "SubTracker/prisma/schema.prisma"
    $schemaDiff = git diff HEAD $schemaPath 2>$null
    $schemaInStatus = git status --short | Select-String "schema.prisma"
    if ($schemaDiff -or $schemaInStatus) {
        $schemaChanged = $true
    }
} elseif (Test-Path "prisma/schema.prisma") {
    $schemaPath = "prisma/schema.prisma"
    $schemaDiff = git diff HEAD $schemaPath 2>$null
    $schemaInStatus = git status --short | Select-String "schema.prisma"
    if ($schemaDiff -or $schemaInStatus) {
        $schemaChanged = $true
    }
}

if ($schemaChanged) {
    Write-Host "⚠️  WARNING: Database schema has changed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "You MUST backup your database before deploying!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This script helps with code versioning, but you need to:" -ForegroundColor Cyan
    Write-Host "  1. Backup your database separately (Railway dashboard or pg_dump)" -ForegroundColor White
    Write-Host "  2. Test the migration locally first" -ForegroundColor White
    Write-Host "  3. Use 'npm run db:migrate' (not db:push) for production" -ForegroundColor White
    Write-Host ""
    
    if ($mode -ne "dryrun") {
        $continue = Read-Host "Have you backed up your database? Continue? (y/n)"
        if ($continue -ne "y" -and $continue -ne "Y") {
            Write-Host ""
            Write-Host "Release cancelled. Backup your database first!" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "To backup Railway database:" -ForegroundColor Cyan
            Write-Host "  1. Go to Railway dashboard → Your database service" -ForegroundColor White
            Write-Host "  2. Use backup feature OR connect and run pg_dump" -ForegroundColor White
            exit
        }
        Write-Host ""
    } else {
        Write-Host "(Dry run - no action will be taken)" -ForegroundColor Gray
        Write-Host ""
    }
}

# ============================================
# Step 2: Show Current Changes
# ============================================
if ($status) {
    Write-Host "Uncommitted changes found:" -ForegroundColor Yellow
    git status --short
    Write-Host ""
} else {
    Write-Host "✓ No uncommitted changes" -ForegroundColor Green
    Write-Host ""
}

# ============================================
# Step 3: Determine Version Type
# ============================================
Write-Host "What type of release is this?" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. " -NoNewline -ForegroundColor Yellow
Write-Host "Patch (v0.2.0 -> v0.2.1) - Bug fix, small changes" -ForegroundColor White
Write-Host "  2. " -NoNewline -ForegroundColor Yellow
Write-Host "Minor (v0.2.0 -> v0.3.0) - New feature, backwards compatible" -ForegroundColor White
Write-Host "  3. " -NoNewline -ForegroundColor Yellow
Write-Host "Major (v0.2.0 -> v1.0.0) - Breaking change, major update" -ForegroundColor White
Write-Host ""
$choice = Read-Host "Enter choice (1-3)"

switch ($choice) {
    "1" { $releaseType = "patch" }
    "2" { $releaseType = "minor" }
    "3" { $releaseType = "major" }
    default {
        Write-Host "Invalid choice. Cancelled." -ForegroundColor Yellow
        exit
    }
}

# ============================================
# Step 4: Get Commit Message (if there are changes)
# ============================================
$commitMsg = ""
if ($status) {
    Write-Host ""
    $commitMsg = Read-Host "Enter commit message (describe your changes)"
    if ([string]::IsNullOrWhiteSpace($commitMsg)) {
        Write-Host "Cancelled - no commit message provided" -ForegroundColor Yellow
        exit
    }
}

# ============================================
# Step 5: Get Tag/Release Message
# ============================================
Write-Host ""
$tagMessage = Read-Host "Enter release description (or press Enter for default)"
if ([string]::IsNullOrWhiteSpace($tagMessage)) {
    $tagMessage = "Release $releaseType version"
}

# ============================================
# Step 6: Calculate New Version
# ============================================
$latestTag = git describe --tags --abbrev=0 2>$null
$currentVersion = "0.0.0"

if ($latestTag) {
    $currentVersion = $latestTag -replace '^v', ''
    Write-Host "`nCurrent version: $latestTag" -ForegroundColor Cyan
} else {
    Write-Host "`nNo existing tags found. Starting fresh at v0.1.0" -ForegroundColor Yellow
    $currentVersion = "0.0.0"
}

# Parse and bump version
$versionParts = $currentVersion.Split('.')
$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]
$patch = [int]$versionParts[2]

switch ($releaseType) {
    "patch" { $patch++ }
    "minor" { $minor++; $patch = 0 }
    "major" { $major++; $minor = 0; $patch = 0 }
}

$newVersion = "v$major.$minor.$patch"

Write-Host "New version: $newVersion" -ForegroundColor Green
Write-Host ""

# ============================================
# Step 7: Show Summary and Confirm
# ============================================
Show-Summary -Mode $modeDisplay -Version $newVersion -Type $releaseType `
    -TagMessage $tagMessage -CommitMessage $commitMsg `
    -HasChanges ([bool]$status) -SchemaChanged $schemaChanged

Write-Host ""
if ($mode -eq "full") {
    Write-Host "This will:" -ForegroundColor Yellow
    Write-Host "  • Commit changes locally (if any)" -ForegroundColor Gray
    Write-Host "  • Create tag locally: $newVersion" -ForegroundColor Gray
    Write-Host "  • Push commits to GitHub" -ForegroundColor Gray
    Write-Host "  • Push tag to GitHub" -ForegroundColor Gray
    Write-Host "  • Railway will auto-deploy from $currentBranch" -ForegroundColor Gray
} elseif ($mode -eq "local") {
    Write-Host "This will:" -ForegroundColor Yellow
    Write-Host "  • Commit changes locally (if any)" -ForegroundColor Gray
    Write-Host "  • Create tag locally: $newVersion" -ForegroundColor Gray
    Write-Host "  • NOT push to GitHub" -ForegroundColor Gray
} else {
    Write-Host "This will:" -ForegroundColor Yellow
    Write-Host "  • Show commands that would be executed" -ForegroundColor Gray
    Write-Host "  • NOT make any changes" -ForegroundColor Gray
}

Write-Host ""
$confirm = Read-Host "Continue? (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Release cancelled." -ForegroundColor Yellow
    exit
}

# ============================================
# Step 8: Execute Based on Mode
# ============================================

if ($mode -eq "dryrun") {
    Write-Host ""
    Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
    Write-Host "DRY RUN - No changes will be made" -ForegroundColor Yellow
    Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Would have executed:" -ForegroundColor Cyan
    Write-Host ""
    if ($status) {
        Write-Host "  git add ." -ForegroundColor Gray
        Write-Host "  git commit -m `"$commitMsg`"" -ForegroundColor Gray
    }
    Write-Host "  git tag -a $newVersion -m `"$tagMessage`"" -ForegroundColor Gray
    if ($mode -eq "full") {
        if ($status) {
            Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
        }
        Write-Host "  git push origin $newVersion" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "✅ Dry run complete - no changes made" -ForegroundColor Green
    Write-Host ""
    Write-Host "To restore to this version later:" -ForegroundColor Cyan
    Write-Host "  git checkout $newVersion" -ForegroundColor Gray
    exit
}

# ============================================
# Step 9: Commit Changes Locally (if any)
# ============================================
if ($status) {
    Write-Host ""
    Write-Host "Staging changes..." -ForegroundColor Yellow
    git add .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to stage changes" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Committing locally..." -ForegroundColor Yellow
    git commit -m $commitMsg
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to commit" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Changes committed locally" -ForegroundColor Green
    Write-Host ""
}

# ============================================
# Step 10: Create Tag Locally
# ============================================
Write-Host "Creating tag: $newVersion" -ForegroundColor Yellow
git tag -a $newVersion -m $tagMessage

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to create tag" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Tag created locally" -ForegroundColor Green
Write-Host ""

# ============================================
# Step 11: Push Commits and Tag (ONLY for Full Release mode)
# ============================================
# Note: Connection test and push only happen for "Full Release" (option 1)
# "Local Only" (option 2) and "Dry Run" (option 3) skip this entire section
if ($mode -eq "full") {
    # Test GitHub connection before attempting push
    Write-Host ""
    $connectionOk = Test-GitHubConnection
    Write-Host ""
    
    if (-not $connectionOk) {
        Write-Host "⚠️  Cannot connect to GitHub" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Possible causes:" -ForegroundColor Cyan
        Write-Host "  • No internet connection" -ForegroundColor Gray
        Write-Host "  • VPN not connected" -ForegroundColor Gray
        Write-Host "  • Firewall blocking GitHub" -ForegroundColor Gray
        Write-Host "  • GitHub is down" -ForegroundColor Gray
        Write-Host ""
        $retry = Read-Host "Try anyway? (y/n)"
        if ($retry -ne "y" -and $retry -ne "Y") {
            Write-Host ""
            Write-Host "Changes and tag are local. Push manually later with:" -ForegroundColor Yellow
            Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
            Write-Host "  git push origin $newVersion" -ForegroundColor Gray
            exit 1
        }
        Write-Host ""
    }
    
    if ($status) {
        Write-Host "Pushing commits to GitHub..." -ForegroundColor Yellow
        git push origin $currentBranch
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Push failed" -ForegroundColor Red
            $authAction = Handle-GitHubAuth
            
            if ($authAction -eq "retry") {
                Write-Host ""
                Write-Host "Retrying push..." -ForegroundColor Yellow
                git push origin $currentBranch
                
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "❌ Push still failed" -ForegroundColor Red
                    Write-Host ""
                    Write-Host "Changes and tag are local. Push manually with:" -ForegroundColor Yellow
                    Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                    Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                    exit 1
                }
                Write-Host "✅ Commits pushed to GitHub" -ForegroundColor Green
            } else {
                Write-Host ""
                Write-Host "Skipping push. Changes and tag are local:" -ForegroundColor Yellow
                Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                exit 1
            }
        } else {
            Write-Host "✅ Commits pushed to GitHub" -ForegroundColor Green
        }
    }
    
    Write-Host "Pushing tag to GitHub..." -ForegroundColor Yellow
    git push origin $newVersion
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "════════════════════════════════════════" -ForegroundColor Green
        Write-Host "✅ Release Complete!" -ForegroundColor Green
        Write-Host "════════════════════════════════════════" -ForegroundColor Green
        Write-Host ""
        Write-Host "Version: " -NoNewline -ForegroundColor Cyan
        Write-Host $newVersion -ForegroundColor Green
        Write-Host "Branch: " -NoNewline -ForegroundColor Cyan
        Write-Host $currentBranch -ForegroundColor White
        Write-Host ""
        Write-Host "Railway will auto-deploy from $currentBranch branch" -ForegroundColor Gray
        Write-Host ""
        Write-Host "To restore this version later:" -ForegroundColor Cyan
        Write-Host "  git checkout $newVersion" -ForegroundColor Gray
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "❌ Failed to push tag" -ForegroundColor Red
        Write-Host ""
        Write-Host "Tag created locally. You can push manually with:" -ForegroundColor Yellow
        Write-Host "  git push origin $newVersion" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Or retry authentication:" -ForegroundColor Cyan
        Write-Host "  gh auth login" -ForegroundColor Gray
    }
} else {
    Write-Host ""
    Write-Host "════════════════════════════════════════" -ForegroundColor Green
    Write-Host "✅ Release Complete (Local Only)!" -ForegroundColor Green
    Write-Host "════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Version: " -NoNewline -ForegroundColor Cyan
    Write-Host $newVersion -ForegroundColor Green
    Write-Host "Tag created locally (not pushed)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To push later, run:" -ForegroundColor Cyan
    Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
    Write-Host "  git push origin $newVersion" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To restore this version later:" -ForegroundColor Cyan
    Write-Host "  git checkout $newVersion" -ForegroundColor Gray
    Write-Host ""
}

