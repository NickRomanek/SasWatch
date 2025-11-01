# Interactive Git Release Script
# Comprehensive versioning with tagging and backup awareness
# Usage: .\scripts\git-release.ps1
# Can be run from any directory - automatically finds repo root

function Show-Header {
    Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║     Git Release & Versioning Script    ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Test-GitHubConnection {
    Write-Host "Testing connection to GitHub..." -ForegroundColor Yellow
    
    # Test 1: HTTP connectivity to github.com (optional check - git connectivity is what matters)
    $httpOk = $false
    try {
        $response = Invoke-WebRequest -Uri "https://github.com" -TimeoutSec 7 -UseBasicParsing -ErrorAction Stop
        $httpOk = $true
        Write-Host "  ✓ HTTP connection to github.com: OK" -ForegroundColor Green
    }
    catch {
        Write-Host "  ℹ HTTP connection to github.com: FAILED (not critical)" -ForegroundColor Yellow
        Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Gray
    }
    
    # Test 2: Git remote connectivity (THIS IS WHAT MATTERS for push to work)
    $gitOk = $false
    try {
        # Check if we can reach the git remote (this tests actual git protocol)
        $remoteUrl = git remote get-url origin 2>$null
        if ($remoteUrl) {
            Write-Host "  ℹ Checking git remote: $remoteUrl" -ForegroundColor Gray
            # Try a simple git command that connects to remote (5 second timeout via git config)
            $env:GIT_TERMINAL_PROMPT = "0"  # Prevent hanging on auth prompts
            $gitOutput = git ls-remote --heads origin 2>&1
            if ($LASTEXITCODE -eq 0) {
                $gitOk = $true
                Write-Host "  ✓ Git remote connectivity: OK (you can push!)" -ForegroundColor Green
            } else {
                Write-Host "  ✗ Git remote connectivity: FAILED" -ForegroundColor Red
                Write-Host "    This might indicate authentication or network issues" -ForegroundColor Gray
            }
        } else {
            Write-Host "  ⚠ No git remote configured" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "  ✗ Git remote connectivity: FAILED" -ForegroundColor Red
        Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Gray
    }
    
    # Test 3: DNS resolution
    $dnsOk = $false
    try {
        $dnsResult = Resolve-DnsName -Name "github.com" -ErrorAction Stop
        if ($dnsResult) {
            $dnsOk = $true
            Write-Host "  ✓ DNS resolution: OK" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ✗ DNS resolution: FAILED" -ForegroundColor Red
        Write-Host "    This might indicate network/VPN issues" -ForegroundColor Gray
    }
    
    Write-Host ""

    # Git connectivity is what we actually need for push to work
    # HTTP test is just a bonus check - prioritize git connectivity
    if ($gitOk) {
        Write-Host "✅ GitHub is reachable via Git" -ForegroundColor Green
        if (-not $httpOk) {
            Write-Host ""
            Write-Host "ℹ️  Note: HTTP test failed but Git connectivity works." -ForegroundColor Cyan
            Write-Host "   This is fine - likely due to firewall/proxy settings." -ForegroundColor Gray
            Write-Host "   Git push will work normally." -ForegroundColor Gray
        }
        Write-Host ""
        return $true
    } elseif ($httpOk -and -not $gitOk) {
        Write-Host "⚠️  HTTP connection works, but git connectivity failed." -ForegroundColor Yellow
        Write-Host "   Git push will likely fail!" -ForegroundColor Red
        Write-Host ""
        Write-Host "   This usually means:" -ForegroundColor Gray
        Write-Host "   • Authentication needed (credentials expired/changed)" -ForegroundColor Gray
        Write-Host "   • Network firewall blocking git protocol (port 443/22)" -ForegroundColor Gray
        Write-Host "   • VPN or proxy configuration issue" -ForegroundColor Gray
        Write-Host ""
        return $false
    } else {
        Write-Host "❌ Cannot reach GitHub" -ForegroundColor Red
        if (-not $dnsOk) {
            Write-Host "   DNS resolution failed - check your network/VPN" -ForegroundColor Yellow
        }
        return $false
    }
}

function Handle-GitHubAuth {
    Write-Host ""
    Write-Host "GitHub Authentication Setup" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Attempting to set up GitHub authentication..." -ForegroundColor Yellow
    Write-Host ""
    
    # First, try GitHub CLI (most reliable)
    $ghInstalled = $false
    try {
        $ghVersion = gh --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            $ghInstalled = $true
            Write-Host "✓ GitHub CLI is already installed" -ForegroundColor Green
        }
    }
    catch {
        # Not installed, continue
    }
    
    if (-not $ghInstalled) {
        Write-Host "Installing GitHub CLI (recommended)..." -ForegroundColor Yellow
        try {
            winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ GitHub CLI installed successfully" -ForegroundColor Green
                $ghInstalled = $true
            } else {
                Write-Host "⚠️  GitHub CLI installation failed (may already be installed)" -ForegroundColor Yellow
                # Try to use it anyway
                try {
                    $ghVersion = gh --version 2>$null
                    if ($LASTEXITCODE -eq 0) {
                        $ghInstalled = $true
                    }
                }
                catch {
                    # Still not available
                }
            }
        }
        catch {
            Write-Host "⚠️  Could not install GitHub CLI automatically" -ForegroundColor Yellow
        }
    }
    
    if ($ghInstalled) {
        Write-Host ""
        Write-Host "Running GitHub CLI authentication..." -ForegroundColor Yellow
        Write-Host "Follow the prompts to authenticate." -ForegroundColor Gray
        Write-Host ""
        gh auth login
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "✅ GitHub CLI authentication completed" -ForegroundColor Green
            return "retry"
        } else {
            Write-Host ""
            Write-Host "⚠️  GitHub CLI authentication was not completed" -ForegroundColor Yellow
        }
    }
    
    # If GitHub CLI didn't work, offer manual credential options
    Write-Host ""
    Write-Host "GitHub CLI authentication is recommended but not available." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Alternative options:" -ForegroundColor Cyan
    Write-Host "  1. Continue anyway (will prompt for credentials during push)" -ForegroundColor White
    Write-Host "  2. Skip authentication (switch to Local Only mode)" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "Enter choice (1-2)"
    
    switch ($choice) {
        "1" {
            Write-Host ""
            Write-Host "Will prompt for credentials when pushing..." -ForegroundColor Gray
            Write-Host "Username: Use your GitHub username" -ForegroundColor Gray
            Write-Host "Password: Use a Personal Access Token (get one: https://github.com/settings/tokens)" -ForegroundColor Gray
            Write-Host ""
            return "retry"
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

# ============================================
# Configure git timeouts (reduce hanging)
# ============================================
# Set a reasonable timeout for git operations (30 seconds)
$env:GIT_HTTP_LOW_SPEED_LIMIT = "1000"
$env:GIT_HTTP_LOW_SPEED_TIME = "30"

# ============================================
# Ensure we're in the git repository root
# ============================================
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = $scriptPath
$maxDepth = 10
$depth = 0

# Find .git directory by going up from script location
while ($depth -lt $maxDepth) {
    if (Test-Path (Join-Path $repoRoot ".git")) {
        break
    }
    $parent = Split-Path -Parent $repoRoot
    if ($parent -eq $repoRoot) {
        # Reached filesystem root
        Write-Host "❌ Could not find .git directory. Please run this script from the repository root." -ForegroundColor Red
        exit 1
    }
    $repoRoot = $parent
    $depth++
}

# Change to repository root
Push-Location $repoRoot
Write-Host "Working directory: $repoRoot" -ForegroundColor Gray
Write-Host ""

try {
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
    Write-Host "  4. " -NoNewline -ForegroundColor Yellow
    Write-Host "Restore from Previous Version" -ForegroundColor White
    Write-Host ""
    $modeChoice = Read-Host "Enter choice (1-4)"

    switch ($modeChoice) {
        "1" { $mode = "full"; $modeDisplay = "Full Release" }
        "2" { $mode = "local"; $modeDisplay = "Local Only" }
        "3" { $mode = "dryrun"; $modeDisplay = "Dry Run" }
        "4" { $mode = "restore"; $modeDisplay = "Restore Version" }
        default {
            Write-Host "Invalid choice. Cancelled." -ForegroundColor Yellow
            Pop-Location
            exit
        }
    }

    Write-Host ""

    # ============================================
    # Restore Mode - Handle Separately
    # ============================================
    if ($mode -eq "restore") {
        Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host "Restore from Previous Version" -ForegroundColor Cyan
        Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host ""

        # Get last 10 tags with their commit dates
        $tags = git tag --sort=-creatordate --format='%(refname:short)|%(creatordate:short)|%(subject)' 2>$null

        if (-not $tags) {
            Write-Host "❌ No tags found in this repository" -ForegroundColor Red
            Write-Host ""
            Write-Host "You need to create at least one release first." -ForegroundColor Yellow
            Pop-Location
            exit
        }

        # Parse and display tags
        $tagList = @()
        $tags | Select-Object -First 10 | ForEach-Object {
            $parts = $_ -split '\|'
            $tagList += [PSCustomObject]@{
                Tag = $parts[0]
                Date = $parts[1]
                Message = if ($parts.Length -gt 2) { $parts[2] } else { "" }
            }
        }

        Write-Host "Available versions (showing last 10):" -ForegroundColor Yellow
        Write-Host ""
        for ($i = 0; $i -lt $tagList.Count; $i++) {
            $tag = $tagList[$i]
            $num = $i + 1
            Write-Host "  $num. " -NoNewline -ForegroundColor Yellow
            Write-Host "$($tag.Tag)" -NoNewline -ForegroundColor Green
            Write-Host " - " -NoNewline -ForegroundColor Gray
            Write-Host "$($tag.Date)" -NoNewline -ForegroundColor Cyan
            if ($tag.Message) {
                Write-Host " ($($tag.Message))" -ForegroundColor Gray
            } else {
                Write-Host ""
            }
        }
        Write-Host ""
        Write-Host "  0. Cancel" -ForegroundColor Yellow
        Write-Host ""

        $versionChoice = Read-Host "Select version to restore (0-$($tagList.Count))"

        if ($versionChoice -eq "0" -or [string]::IsNullOrWhiteSpace($versionChoice)) {
            Write-Host "Restore cancelled." -ForegroundColor Yellow
            Pop-Location
            exit
        }

        $versionIndex = [int]$versionChoice - 1
        if ($versionIndex -lt 0 -or $versionIndex -ge $tagList.Count) {
            Write-Host "Invalid choice. Cancelled." -ForegroundColor Yellow
            Pop-Location
            exit
        }

        $selectedTag = $tagList[$versionIndex].Tag

        Write-Host ""
        Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host "⚠️  WARNING: Restore Operation" -ForegroundColor Yellow
        Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "You are about to restore to version: " -NoNewline -ForegroundColor White
        Write-Host "$selectedTag" -ForegroundColor Green
        Write-Host "Date: " -NoNewline -ForegroundColor White
        Write-Host "$($tagList[$versionIndex].Date)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "This will:" -ForegroundColor Yellow
        Write-Host "  • Checkout the code from version $selectedTag" -ForegroundColor Gray
        Write-Host "  • Put your repository in 'detached HEAD' state" -ForegroundColor Gray
        Write-Host "  • You can explore this version safely" -ForegroundColor Gray
        Write-Host ""
        Write-Host "If you have uncommitted changes, they will be lost!" -ForegroundColor Red
        Write-Host ""

        # Check for uncommitted changes
        $statusCheck = git status --short
        if ($statusCheck) {
            Write-Host "⚠️  You have uncommitted changes:" -ForegroundColor Red
            git status --short
            Write-Host ""
            Write-Host "Options:" -ForegroundColor Cyan
            Write-Host "  1. Continue anyway (changes will be lost)" -ForegroundColor White
            Write-Host "  2. Cancel and commit changes first" -ForegroundColor White
            Write-Host ""
            $continueChoice = Read-Host "Enter choice (1-2)"

            if ($continueChoice -ne "1") {
                Write-Host "Restore cancelled. Please commit or stash your changes first." -ForegroundColor Yellow
                Pop-Location
                exit
            }
        }

        $confirm = Read-Host "Continue with restore? (y/n)"
        if ($confirm -ne "y" -and $confirm -ne "Y") {
            Write-Host "Restore cancelled." -ForegroundColor Yellow
            Pop-Location
            exit
        }

        Write-Host ""
        Write-Host "Checking out version $selectedTag..." -ForegroundColor Yellow
        git checkout $selectedTag

        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "════════════════════════════════════════" -ForegroundColor Green
            Write-Host "✅ Restore Complete!" -ForegroundColor Green
            Write-Host "════════════════════════════════════════" -ForegroundColor Green
            Write-Host ""
            Write-Host "You are now at version: " -NoNewline -ForegroundColor Cyan
            Write-Host "$selectedTag" -ForegroundColor Green
            Write-Host ""
            Write-Host "Your repository is in 'detached HEAD' state." -ForegroundColor Yellow
            Write-Host "This is safe for viewing/testing this version." -ForegroundColor Gray
            Write-Host ""
            Write-Host "To go back to the latest code:" -ForegroundColor Cyan
            Write-Host "  git checkout $currentBranch" -ForegroundColor Gray
            Write-Host ""
            Write-Host "To create a new branch from this version:" -ForegroundColor Cyan
            Write-Host "  git checkout -b new-branch-name" -ForegroundColor Gray
            Write-Host ""
        } else {
            Write-Host ""
            Write-Host "❌ Restore failed" -ForegroundColor Red
            Write-Host ""
        }

        Pop-Location
        exit
    }

    # ============================================
    # Step 0.5: Test GitHub Connection (for Full Release only)
    # ============================================
    if ($mode -eq "full") {
        Write-Host "Testing GitHub connection..." -ForegroundColor Yellow
        $connectionOk = Test-GitHubConnection
        
        if (-not $connectionOk) {
            Write-Host ""
            Write-Host "⚠️  Cannot connect to GitHub" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "Automatically trying GitHub authentication setup..." -ForegroundColor Cyan
            Write-Host ""
            
            # Automatically try authentication
            $authAction = Handle-GitHubAuth
            if ($authAction -eq "skip") {
                Write-Host ""
                Write-Host "Authentication skipped." -ForegroundColor Yellow
            } else {
                Write-Host ""
                Write-Host "Retesting GitHub connection..." -ForegroundColor Yellow
                $connectionOk = Test-GitHubConnection
                if ($connectionOk) {
                    Write-Host "✅ Connection successful after authentication!" -ForegroundColor Green
                    Write-Host ""
                }
            }
            
            # If still not connected, offer options
            if (-not $connectionOk) {
                Write-Host ""
                Write-Host "Connection still failing after authentication attempt." -ForegroundColor Yellow
                Write-Host ""
                Write-Host "Possible causes:" -ForegroundColor Cyan
                Write-Host "  • No internet connection" -ForegroundColor Gray
                Write-Host "  • VPN not connected" -ForegroundColor Gray
                Write-Host "  • Firewall blocking GitHub (port 443/22)" -ForegroundColor Gray
                Write-Host "  • Proxy settings blocking git protocol" -ForegroundColor Gray
                Write-Host "  • GitHub is down (check: https://www.githubstatus.com)" -ForegroundColor Gray
                Write-Host ""
                Write-Host "Quick checks:" -ForegroundColor Cyan
                Write-Host "  1. Try: ping github.com" -ForegroundColor Gray
                Write-Host "  2. Check: git remote -v (verify remote URL)" -ForegroundColor Gray
                Write-Host "  3. Test: git ls-remote origin (tests git connectivity)" -ForegroundColor Gray
                Write-Host ""
                Write-Host "Options:" -ForegroundColor Cyan
                Write-Host "  1. Continue anyway (will try to push later)" -ForegroundColor White
                Write-Host "  2. Switch to Local Only mode" -ForegroundColor White
                Write-Host "  3. Cancel" -ForegroundColor White
                Write-Host ""
                $connectionChoice = Read-Host "Enter choice (1-3)"
                
                switch ($connectionChoice) {
                    "1" {
                        Write-Host "Continuing with Full Release mode..." -ForegroundColor Yellow
                        Write-Host ""
                    }
                    "2" {
                        Write-Host "Switching to Local Only mode..." -ForegroundColor Yellow
                        $mode = "local"
                        $modeDisplay = "Local Only"
                        Write-Host ""
                    }
                    "3" {
                        Write-Host "Release cancelled." -ForegroundColor Yellow
                        Pop-Location
                        exit
                    }
                    default {
                        Write-Host "Invalid choice. Switching to Local Only mode..." -ForegroundColor Yellow
                        $mode = "local"
                        $modeDisplay = "Local Only"
                        Write-Host ""
                    }
                }
            }
        }
        # If connectionOk is true, we already printed success message in Test-GitHubConnection
    }

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
        if ($mode -ne "dryrun") {
            Write-Host "Options:" -ForegroundColor Cyan
            Write-Host "  1. Continue (you've backed up)" -ForegroundColor White
            Write-Host "  2. Cancel and backup now" -ForegroundColor White
            Write-Host ""
            $continue = Read-Host "Enter choice (1-2)"
            if ($continue -ne "1") {
                Write-Host "Release cancelled. Backup your database first!" -ForegroundColor Yellow
                Write-Host ""
                Write-Host "Backup options:" -ForegroundColor Cyan
                Write-Host "  1. Go to Railway dashboard → Your database service" -ForegroundColor White
                Write-Host "  2. Use backup feature OR connect and run pg_dump" -ForegroundColor White
                Pop-Location
                exit
            }
            Write-Host ""
        } else {
            Write-Host "(Dry run - no action will be taken)" -ForegroundColor Gray
            Write-Host ""
        }
    }

    # ============================================
    # Step 2: Show Changes (if any)
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
            Pop-Location
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
            Pop-Location
            exit
        }
    }

    # ============================================
    # Step 5: Calculate New Version
    # ============================================
    # Reuse $latestTag from initial status check
    $currentVersion = "0.0.0"
    if ($latestTag) {
        $currentVersion = $latestTag -replace '^v', ''
    } else {
        # If no tags, start at 0.0.0 to correctly bump to 0.1.0, 0.0.1 etc.
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

    # Auto-generate tag message
    $tagMessage = "Release $newVersion"

    Write-Host "New version: $newVersion" -ForegroundColor Green
    Write-Host ""

    # ============================================
    # Step 6: Show Summary and Confirm
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
    } else { # Dry Run
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
        Pop-Location
        exit
    }

    Write-Host ""
    $confirm = Read-Host "Continue? (y/n)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Release cancelled." -ForegroundColor Yellow
        Pop-Location
        exit
    }

    # ============================================
    # Step 7: Commit Changes Locally (if any)
    # ============================================
    if ($status) {
        Write-Host ""
        Write-Host "Staging changes..." -ForegroundColor Yellow
        git add .
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Failed to stage changes" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        
        Write-Host "Committing locally..." -ForegroundColor Yellow
        git commit -m $commitMsg
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Failed to commit" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host "✅ Changes committed locally" -ForegroundColor Green
        Write-Host ""
    }

    # ============================================
    # Step 8: Create Tag Locally
    # ============================================
    Write-Host "Creating tag: $newVersion" -ForegroundColor Yellow
    git tag -a $newVersion -m $tagMessage
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to create tag" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host "✅ Tag created locally" -ForegroundColor Green
    Write-Host ""

    # ============================================
    # Step 9: Push Commits and Tag (ONLY for Full Release mode)
    # ============================================
    # Note: Push only happens for "Full Release" (option 1)
    # "Local Only" (option 2) and "Dry Run" (option 3) skip this entire section
    # Connection was already tested in Step 0.5
    if ($mode -eq "full") {
        if ($status) {
            Write-Host "Pushing commits to GitHub..." -ForegroundColor Yellow
            git push origin $currentBranch

            if ($LASTEXITCODE -ne 0) {
                Write-Host "❌ Push failed" -ForegroundColor Red
                Write-Host ""
                Write-Host "This usually happens due to:" -ForegroundColor Yellow
                Write-Host "  • Network/VPN disconnected" -ForegroundColor Gray
                Write-Host "  • Firewall blocking git operations" -ForegroundColor Gray
                Write-Host "  • GitHub temporarily unreachable" -ForegroundColor Gray
                Write-Host ""
                Write-Host "Options:" -ForegroundColor Cyan
                Write-Host "  1. Keep changes local (recommended - you can push manually later)" -ForegroundColor White
                Write-Host "  2. Try authentication setup" -ForegroundColor White
                Write-Host "  3. Retry push now" -ForegroundColor White
                Write-Host ""
                $pushChoice = Read-Host "Enter choice (1-3)"

                switch ($pushChoice) {
                    "1" {
                        Write-Host ""
                        Write-Host "✅ Release saved locally" -ForegroundColor Green
                        Write-Host ""
                        Write-Host "Push manually when ready with:" -ForegroundColor Cyan
                        Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                        Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                        Write-Host ""
                        Pop-Location
                        exit 0
                    }
                    "2" {
                        $authAction = Handle-GitHubAuth
                        if ($authAction -eq "retry") {
                            Write-Host ""
                            Write-Host "Retrying push..." -ForegroundColor Yellow
                            git push origin $currentBranch

                            if ($LASTEXITCODE -ne 0) {
                                Write-Host "❌ Push still failed" -ForegroundColor Red
                                Write-Host ""
                                Write-Host "Changes and tag are saved locally. Push manually with:" -ForegroundColor Yellow
                                Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                                Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                                Pop-Location
                                exit 1
                            }
                            Write-Host "✅ Commits pushed to GitHub" -ForegroundColor Green
                        } else {
                            Write-Host ""
                            Write-Host "Changes and tag are saved locally. Push manually with:" -ForegroundColor Yellow
                            Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                            Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                            Pop-Location
                            exit 0
                        }
                    }
                    "3" {
                        Write-Host ""
                        Write-Host "Retrying push..." -ForegroundColor Yellow
                        git push origin $currentBranch

                        if ($LASTEXITCODE -ne 0) {
                            Write-Host "❌ Push still failed" -ForegroundColor Red
                            Write-Host ""
                            Write-Host "Changes and tag are saved locally. Push manually with:" -ForegroundColor Yellow
                            Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                            Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                            Pop-Location
                            exit 1
                        }
                        Write-Host "✅ Commits pushed to GitHub" -ForegroundColor Green
                    }
                    default {
                        Write-Host ""
                        Write-Host "Changes and tag are saved locally. Push manually with:" -ForegroundColor Yellow
                        Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                        Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                        Pop-Location
                        exit 0
                    }
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
            Write-Host "Options:" -ForegroundColor Cyan
            Write-Host "  1. Keep tag local (you can push manually later)" -ForegroundColor White
            Write-Host "  2. Retry push now" -ForegroundColor White
            Write-Host ""
            $tagPushChoice = Read-Host "Enter choice (1-2)"

            if ($tagPushChoice -eq "2") {
                Write-Host ""
                Write-Host "Retrying tag push..." -ForegroundColor Yellow
                git push origin $newVersion

                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✅ Tag pushed successfully!" -ForegroundColor Green
                } else {
                    Write-Host "❌ Tag push still failed" -ForegroundColor Red
                }
            }

            Write-Host ""
            Write-Host "Tag is saved locally. Push manually when ready with:" -ForegroundColor Yellow
            Write-Host "  git push origin $newVersion" -ForegroundColor Gray
            Write-Host ""
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
}
finally {
    # Always restore original directory
    Pop-Location
}
