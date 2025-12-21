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
    param([int]$Retries = 2)
    
    Write-Host "Testing connection to GitHub..." -ForegroundColor Yellow
    
    # Test 1: HTTP connectivity to github.com (with retries)
    $httpOk = $false
    $httpError = $null
    for ($i = 0; $i -le $Retries; $i++) {
        if ($i -gt 0) {
            Write-Host "  Retrying HTTP connection (attempt $($i + 1)/$($Retries + 1))..." -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
        try {
            $response = Invoke-WebRequest -Uri "https://github.com" -TimeoutSec 20 -UseBasicParsing -ErrorAction Stop
            $httpOk = $true
            Write-Host "  ✓ HTTP connection to github.com: OK" -ForegroundColor Green
            break
        }
        catch {
            $httpError = $_.Exception.Message
            if ($i -eq $Retries) {
                Write-Host "  ℹ HTTP connection to github.com: FAILED (not critical)" -ForegroundColor Yellow
                Write-Host "    Error: $httpError" -ForegroundColor Gray
            }
        }
    }
    
    # Test 2: Git remote connectivity (THIS IS WHAT MATTERS for push to work) - with retries
    $gitOk = $false
    $remoteUrl = git remote get-url origin 2>$null
    if ($remoteUrl) {
        Write-Host "  ℹ Checking git remote: $remoteUrl" -ForegroundColor Gray
        
        for ($i = 0; $i -le $Retries; $i++) {
            if ($i -gt 0) {
                Write-Host "  Retrying git connectivity (attempt $($i + 1)/$($Retries + 1))..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
            }
            
            try {
                # Prevent hanging on auth prompts during test
                $env:GIT_TERMINAL_PROMPT = "0"
                $gitOutput = git ls-remote --heads origin 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $gitOk = $true
                    Write-Host "  ✓ Git remote connectivity: OK (you can push!)" -ForegroundColor Green
                    break
                } else {
                    if ($i -eq $Retries) {
                        Write-Host "  ✗ Git remote connectivity: FAILED (after $($Retries + 1) attempts)" -ForegroundColor Red
                        Write-Host "    This might indicate authentication or network issues" -ForegroundColor Gray
                        if ($gitOutput) {
                            Write-Host "    Git output: $($gitOutput -join ', ')" -ForegroundColor Gray
                        }
                    }
                }
            }
            catch {
                if ($i -eq $Retries) {
                    Write-Host "  ✗ Git remote connectivity: FAILED" -ForegroundColor Red
                    Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Gray
                }
            }
        }
    } else {
        Write-Host "  ⚠ No git remote configured" -ForegroundColor Yellow
    }
    
    # Test 3: DNS resolution (if HTTP failed, this helps diagnose)
    $dnsOk = $false
    if (-not $httpOk) {
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
        Write-Host "Checking if GitHub CLI is available..." -ForegroundColor Yellow
        # First, try checking PATH more thoroughly
        $ghPath = Get-Command gh -ErrorAction SilentlyContinue
        if ($ghPath) {
            $ghInstalled = $true
            Write-Host "✓ GitHub CLI found in PATH" -ForegroundColor Green
        } else {
            Write-Host "Installing GitHub CLI (recommended)..." -ForegroundColor Yellow
            try {
                # Check if winget is available
                $wingetAvailable = Get-Command winget -ErrorAction SilentlyContinue
                if ($wingetAvailable) {
                    winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "✅ GitHub CLI installed successfully" -ForegroundColor Green
                        # Refresh PATH and check again
                        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
                        $ghPath = Get-Command gh -ErrorAction SilentlyContinue
                        if ($ghPath) {
                            $ghInstalled = $true
                        }
                    }
                }
                
                # Final check - maybe it's installed but not in PATH yet
                if (-not $ghInstalled) {
                    $ghVersion = gh --version 2>$null
                    if ($LASTEXITCODE -eq 0) {
                        $ghInstalled = $true
                        Write-Host "✓ GitHub CLI is available" -ForegroundColor Green
                    }
                }
            }
            catch {
                Write-Host "⚠️  Could not verify GitHub CLI installation" -ForegroundColor Yellow
            }
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
        [bool]$SchemaChanged,
        [bool]$SchemaSyncRan = $false,
        [string]$SchemaSyncInfo = ""
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
        if ($SchemaSyncRan) {
            if ($SchemaSyncInfo -match "Local:") {
                Write-Host "     Database Updates:" -ForegroundColor Green
                if ($SchemaSyncInfo -match "Local: True") {
                    Write-Host "       ✓ Local database updated" -ForegroundColor Green
                }
                if ($SchemaSyncInfo -match "Railway: True") {
                    Write-Host "       ✓ Railway database updated" -ForegroundColor Green
                }
                if ($SchemaSyncInfo -match "Local: False" -and $SchemaSyncInfo -match "Railway: False") {
                    Write-Host "       ⚠ No databases were updated" -ForegroundColor Yellow
                }
            } else {
                Write-Host "     Prisma command: $SchemaSyncInfo" -ForegroundColor Green
            }
        } elseif ($SchemaSyncInfo) {
            Write-Host "     Prisma: $SchemaSyncInfo" -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

function Get-PrismaProjectRoot {
    if (Test-Path "SasWatch/prisma/schema.prisma") {
        return "SasWatch"
    }
    elseif (Test-Path "prisma/schema.prisma") {
        return "."
    }
    return $null
}

function Convert-RailwayInternalUrl {
    param(
        [string]$RailwayUrl,
        [ref]$RailwayProxyHost,
        [string]$EnvFile
    )

    if ([string]::IsNullOrWhiteSpace($RailwayUrl)) {
        return $RailwayUrl
    }

    if ($RailwayUrl -notmatch "postgres\.railway\.internal") {
        return $RailwayUrl
    }

    Write-Host "⚠️  Internal Railway hostname detected!" -ForegroundColor Yellow
    Write-Host "   Internal hostnames (postgres.railway.internal) won't work from your local machine." -ForegroundColor Yellow
    Write-Host "   You need to use the PUBLIC proxy URL instead." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   To find your public proxy URL:" -ForegroundColor Cyan
    Write-Host "   1. Go to Railway dashboard → Your database service" -ForegroundColor White
    Write-Host "   2. Look for 'Public Networking' section" -ForegroundColor White
    Write-Host "   3. Copy the proxy hostname (e.g., shortline.proxy.rlwy.net:45995)" -ForegroundColor White
    Write-Host ""

    if ($RailwayUrl -match "postgresql://([^:]+):([^@]+)@postgres\.railway\.internal:(\d+)/(.+)") {
        $user = $matches[1]
        $pass = $matches[2]
        $port = $matches[3]
        $db = $matches[4]

        $proxyHost = $RailwayProxyHost.Value
        if ([string]::IsNullOrWhiteSpace($proxyHost)) {
            $proxyHost = Read-Host "   Enter proxy hostname (e.g., shortline.proxy.rlwy.net:45995)"
            if ([string]::IsNullOrWhiteSpace($proxyHost)) {
                throw "Proxy hostname is required to connect to the Railway database from your local machine."
            }

            if (Test-Path $EnvFile) {
                $saveProxy = Read-Host "   Save proxy hostname to .env for future use? (y/n)"
                if ($saveProxy -eq "y" -or $saveProxy -eq "Y") {
                    $envContent = Get-Content $EnvFile
                    $hasProxyHost = $envContent | Select-String "^RAILWAY_PROXY_HOST="
                    if ($hasProxyHost) {
                        $envContent = $envContent | ForEach-Object {
                            if ($_ -match "^RAILWAY_PROXY_HOST=") {
                                "RAILWAY_PROXY_HOST=$proxyHost"
                            } else {
                                $_
                            }
                        }
                    } else {
                        $envContent += ""
                        $envContent += "# Railway Database Proxy (for local schema updates)"
                        $envContent += "RAILWAY_PROXY_HOST=$proxyHost"
                    }
                    $envContent | Set-Content $EnvFile
                    Write-Host "   ✓ Saved proxy hostname to .env" -ForegroundColor Green
                }
            }
        } else {
            Write-Host "   Converted to proxy URL using stored hostname" -ForegroundColor Green
        }

        $RailwayProxyHost.Value = $proxyHost.Trim()
        $proxyHostSafe = $RailwayProxyHost.Value
        Write-Host "   Using: postgresql://${user}:***@${proxyHostSafe}/${db}" -ForegroundColor Green
        return "postgresql://${user}:${pass}@${proxyHostSafe}/${db}"
    }

    return $RailwayUrl
}

function Invoke-PrismaDatabaseUpdate {
    param(
        [string]$ProjectPath,
        [string]$DatabaseTarget,  # "local" or "railway"
        [string]$CommandType,     # "migrate" or "push"
        [string]$MigrationName    # Optional: migration name (if provided, won't prompt)
    )

    $npmExecutable = if ($IsWindows) { "npx.cmd" } else { "npx" }

    if (-not (Get-Command $npmExecutable -ErrorAction SilentlyContinue)) {
        throw "❌ Unable to locate 'npx'. Install Node.js or ensure npx is in PATH."
    }

    $pushedLocation = $false
    if ($ProjectPath -and $ProjectPath -ne ".") {
        Push-Location $ProjectPath
        $pushedLocation = $true
    }

    try {
        # Save original DATABASE_URL
        $originalDbUrl = $env:DATABASE_URL

        # Set DATABASE_URL based on target
        if ($DatabaseTarget -eq "local") {
            # Use local database from .env or default
            $envFile = Join-Path $ProjectPath ".env"
            $localDbUrl = $null
            if (Test-Path $envFile) {
                $envContent = Get-Content $envFile
                $localLine = $envContent | Select-String "^DATABASE_URL="
                if ($localLine) {
                    $localDbUrl = ($localLine.Line -split "=", 2)[1].Trim()
                }
            }
            
            if ($localDbUrl -and $localDbUrl -notmatch "railway|proxy\.rlwy" -and $localDbUrl -match "^postgresql://|^postgres://") {
                $env:DATABASE_URL = $localDbUrl
            } else {
                # Default local database
                $env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/subtracker?schema=public"
            }
            Write-Host "📦 Updating LOCAL database..." -ForegroundColor Cyan
            Write-Host "   Database: $($env:DATABASE_URL.Substring(0, [Math]::Min(50, $env:DATABASE_URL.Length)))..." -ForegroundColor Gray
        } elseif ($DatabaseTarget -eq "railway") {
            # Get Railway database URL
            Write-Host "🔍 Detecting Railway database URL..." -ForegroundColor Cyan
            $railwayDbUrl = $null
            $railwayProxyHost = $null
            $envFile = Join-Path $ProjectPath ".env"
            
            # First, check .env for stored proxy URL (RAILWAY_DATABASE_URL_PROXY or RAILWAY_PROXY_HOST)
            if (Test-Path $envFile) {
                $envContent = Get-Content $envFile
                
                # Check for stored proxy URL
                $proxyUrlLine = $envContent | Select-String "^RAILWAY_DATABASE_URL_PROXY="
                if ($proxyUrlLine) {
                    $railwayDbUrl = ($proxyUrlLine.Line -split "=", 2)[1].Trim()
                    if ($railwayDbUrl -match "^postgresql://|^postgres://") {
                        Write-Host "   Found stored proxy URL in .env" -ForegroundColor Gray
                    } else {
                        $railwayDbUrl = $null
                    }
                }
                
                # Check for stored proxy hostname only
                if (-not $railwayDbUrl) {
                    $proxyHostLine = $envContent | Select-String "^RAILWAY_PROXY_HOST="
                    if ($proxyHostLine) {
                        $railwayProxyHost = ($proxyHostLine.Line -split "=", 2)[1].Trim()
                        Write-Host "   Found stored proxy hostname in .env" -ForegroundColor Gray
                    }
                }
                
                # Check for any Railway URL in .env (prefer proxy over internal)
                if (-not $railwayDbUrl) {
                    $proxyLine = $envContent | Select-String "DATABASE_URL.*proxy\.rlwy"
                    if ($proxyLine) {
                        $railwayDbUrl = ($proxyLine.Line -split "=", 2)[1].Trim()
                    }
                }
            }
            
            # Try to get from Railway CLI (handles multi-line DATABASE_URL)
            $railwayCredentials = $null
            if (-not $railwayDbUrl -and (Get-Command railway -ErrorAction SilentlyContinue)) {
                try {
                    $railwayVars = railway variables 2>&1 | Out-String
                    
                    # Handle multi-line DATABASE_URL - find the section and reconstruct
                    $dbUrlSection = $railwayVars | Select-String -Pattern "DATABASE_URL" -Context 0, 5
                    if ($dbUrlSection) {
                        $lines = $dbUrlSection.Line
                        $nextLines = $dbUrlSection.Context.PostContext
                        
                        # Try to extract full URL from the section
                        $fullSection = ($lines + ($nextLines -join " ")) -join " "
                        if ($fullSection -match "postgresql://([^:]+):([^@]+)@([^/\s]+)/([^\s]+)") {
                            $user = $matches[1]
                            $pass = $matches[2]
                            $host = $matches[3]
                            $db = $matches[4]
                            $railwayDbUrl = "postgresql://${user}:${pass}@${host}/${db}"
                            # Store credentials for later use if we have proxy hostname
                            $railwayCredentials = @{
                                User = $user
                                Pass = $pass
                                Db = $db
                            }
                        }
                    }
                } catch {
                    # Railway CLI might not be configured
                }
            }
            
            # If we have stored proxy hostname but no URL yet, try to construct from credentials
            if (-not $railwayDbUrl -and $railwayProxyHost) {
                # Try to get credentials from Railway CLI if we don't have them yet
                if (-not $railwayCredentials -and (Get-Command railway -ErrorAction SilentlyContinue)) {
                    try {
                        $railwayVars = railway variables 2>&1 | Out-String
                        $dbUrlSection = $railwayVars | Select-String -Pattern "DATABASE_URL" -Context 0, 5
                        if ($dbUrlSection) {
                            $fullSection = ($dbUrlSection.Line + ($dbUrlSection.Context.PostContext -join " ")) -join " "
                            if ($fullSection -match "postgresql://([^:]+):([^@]+)@([^/\s]+)/([^\s]+)") {
                                $railwayCredentials = @{
                                    User = $matches[1]
                                    Pass = $matches[2]
                                    Db = $matches[4]
                                }
                            }
                        }
                    } catch {
                        # Railway CLI might not be configured
                    }
                }
                
                # Construct URL from proxy hostname + credentials
                if ($railwayCredentials) {
                    $railwayDbUrl = "postgresql://$($railwayCredentials.User):$($railwayCredentials.Pass)@${railwayProxyHost}/$($railwayCredentials.Db)"
                    Write-Host "   ✓ Constructed URL from stored proxy hostname + Railway credentials" -ForegroundColor Green
                }
            }
            
            $proxyHostRef = [ref]$railwayProxyHost
            $railwayDbUrl = Convert-RailwayInternalUrl -RailwayUrl $railwayDbUrl -RailwayProxyHost $proxyHostRef -EnvFile $envFile
            $railwayProxyHost = $proxyHostRef.Value
            
            # If still no URL, prompt user
            if (-not $railwayDbUrl) {
                Write-Host "⚠️  Railway DATABASE_URL not found. Please provide it:" -ForegroundColor Yellow
                Write-Host "   Option 1: Full URL (e.g., postgresql://user:pass@shortline.proxy.rlwy.net:45995/railway)" -ForegroundColor Cyan
                Write-Host "   Option 2: Just proxy hostname (e.g., shortline.proxy.rlwy.net:45995) - we'll get credentials from Railway" -ForegroundColor Cyan
                $userInput = Read-Host "Railway DATABASE_URL or proxy hostname"
                
                # Check if user entered just hostname:port (no postgresql:// prefix)
                if ($userInput -notmatch "^postgresql://|^postgres://") {
                    # User entered just hostname:port, try to get credentials
                    if ($railwayCredentials) {
                        # Use credentials we already have
                        $railwayDbUrl = "postgresql://$($railwayCredentials.User):$($railwayCredentials.Pass)@${userInput}/$($railwayCredentials.Db)"
                        Write-Host "   ✓ Constructed URL from hostname + cached Railway credentials" -ForegroundColor Green
                    } elseif (Get-Command railway -ErrorAction SilentlyContinue) {
                        try {
                            Write-Host "   Getting credentials from Railway..." -ForegroundColor Gray
                            $railwayVars = railway variables 2>&1 | Out-String
                            $dbUrlSection = $railwayVars | Select-String -Pattern "DATABASE_URL" -Context 0, 5
                            if ($dbUrlSection) {
                                $fullSection = ($dbUrlSection.Line + ($dbUrlSection.Context.PostContext -join " ")) -join " "
                                if ($fullSection -match "postgresql://([^:]+):([^@]+)@([^/\s]+)/([^\s]+)") {
                                    $user = $matches[1]
                                    $pass = $matches[2]
                                    $db = $matches[4]
                                    $railwayDbUrl = "postgresql://${user}:${pass}@${userInput}/${db}"
                                    Write-Host "   ✓ Constructed URL from hostname + Railway credentials" -ForegroundColor Green
                                } else {
                                    throw "Could not extract credentials from Railway. Please provide full URL."
                                }
                            } else {
                                throw "Could not find DATABASE_URL in Railway. Please provide full URL."
                            }
                        } catch {
                            Write-Host "   ❌ Could not get credentials from Railway: $_" -ForegroundColor Red
                            throw "Please provide the full DATABASE_URL (postgresql://user:pass@host:port/db)"
                        }
                    } else {
                        throw "Railway CLI not found. Please provide the full DATABASE_URL (postgresql://user:pass@host:port/db)"
                    }
                    
                    # Save proxy hostname to .env for future use
                    if ($railwayDbUrl -and (Test-Path $envFile)) {
                        $envContent = Get-Content $envFile
                        $hasProxyHost = $envContent | Select-String "^RAILWAY_PROXY_HOST="
                        if (-not $hasProxyHost) {
                            $envContent += ""
                            $envContent += "# Railway Database Proxy (for local schema updates)"
                            $envContent += "RAILWAY_PROXY_HOST=$userInput"
                            $envContent | Set-Content $envFile
                            Write-Host "   ✓ Saved proxy hostname to .env for future use" -ForegroundColor Green
                        }
                    }
                } else {
                    # User entered full URL
                    $railwayDbUrl = $userInput
                }
                
                # Convert internal URL to proxy if needed
                $proxyHostRef = [ref]$railwayProxyHost
                $railwayDbUrl = Convert-RailwayInternalUrl -RailwayUrl $railwayDbUrl -RailwayProxyHost $proxyHostRef -EnvFile $envFile
                $railwayProxyHost = $proxyHostRef.Value
            }
            
            if ($railwayDbUrl -and $railwayDbUrl -match "^postgresql://|^postgres://") {
                $env:DATABASE_URL = $railwayDbUrl.Trim()
                Write-Host "☁️  Updating RAILWAY database..." -ForegroundColor Cyan
                Write-Host "   Database: $($railwayDbUrl.Substring(0, [Math]::Min(60, $railwayDbUrl.Length)))..." -ForegroundColor Gray
            } else {
                throw "Railway DATABASE_URL is invalid or missing. Expected format: postgresql://..."
            }
        }

        # Execute the command
        if ($CommandType -eq "migrate") {
            if ($DatabaseTarget -eq "railway") {
                Write-Host "Running: $npmExecutable prisma migrate deploy" -ForegroundColor Gray
                & $npmExecutable prisma migrate deploy
                $deployExitCode = $LASTEXITCODE
                if ($deployExitCode -ne 0) {
                    Write-Host "⚠️  Prisma migrate deploy failed (exit code $deployExitCode)." -ForegroundColor Yellow
                    Write-Host "   Attempting fallback: prisma db push --accept-data-loss" -ForegroundColor Yellow
                    & $npmExecutable prisma db push --accept-data-loss
                    $pushExitCode = $LASTEXITCODE
                    if ($pushExitCode -ne 0) {
                        throw "Prisma migrate deploy failed (exit code $deployExitCode) and fallback prisma db push also failed (exit code $pushExitCode)."
                    }
                    return "prisma db push (fallback from migrate deploy)"
                }
                return "prisma migrate deploy"
            } else {
                if ([string]::IsNullOrWhiteSpace($MigrationName)) {
                    do {
                        $MigrationName = Read-Host "Migration name (kebab-case recommended)"
                        if ([string]::IsNullOrWhiteSpace($MigrationName)) {
                            Write-Host "Migration name cannot be empty." -ForegroundColor Yellow
                        }
                    } until (-not [string]::IsNullOrWhiteSpace($MigrationName))
                }

                Write-Host "Running: $npmExecutable prisma migrate dev --name $MigrationName" -ForegroundColor Gray
                & $npmExecutable prisma migrate dev --name $MigrationName
                $migrateExitCode = $LASTEXITCODE
                if ($migrateExitCode -ne 0) {
                    if ($migrateExitCode -eq 130) {
                        Write-Host "⚠️  Prisma migrate detected schema drift or aborted (exit code 130)." -ForegroundColor Yellow
                        Write-Host "   Attempting fallback: prisma db push --accept-data-loss" -ForegroundColor Yellow
                        & $npmExecutable prisma db push --accept-data-loss
                        $pushExitCode = $LASTEXITCODE
                        if ($pushExitCode -ne 0) {
                            throw "Prisma migrate failed (exit code 130) and fallback prisma db push also failed (exit code $pushExitCode)."
                        }
                        return "prisma db push (fallback from migrate dev)"
                    }
                    throw "Prisma migrate failed (exit code $migrateExitCode)."
                }
                return "prisma migrate dev --name $MigrationName"
            }
        } else {
            Write-Host "Running: $npmExecutable prisma db push --accept-data-loss" -ForegroundColor Gray
            & $npmExecutable prisma db push --accept-data-loss
            if ($LASTEXITCODE -ne 0) {
                throw "Prisma db push failed (exit code $LASTEXITCODE)."
            }
            return "prisma db push"
        }
    }
    finally {
        # Restore original DATABASE_URL
        if ($originalDbUrl) {
            $env:DATABASE_URL = $originalDbUrl
        }
        
        if ($pushedLocation) {
            Pop-Location
        }
    }
}

function Invoke-PrismaSchemaSync {
    param(
        [string]$ProjectPath
    )

    $result = @{
        Ran = $false
        Command = ""
        Notes = ""
        LocalUpdated = $false
        RailwayUpdated = $false
    }

    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Database Schema Update" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""

    # Ask which command type to use
    Write-Host "Select how you'd like to sync the database schema:" -ForegroundColor Yellow
    Write-Host "  1. Generate migration (npx prisma migrate dev --name <name>)" -ForegroundColor White
    Write-Host "  2. Push schema directly (npx prisma db push)" -ForegroundColor White
    Write-Host "  3. Skip database updates (I will handle manually)" -ForegroundColor White
    Write-Host ""

    do {
        $commandChoice = Read-Host "Enter choice (1-3)"
    } until ($commandChoice -in @("1", "2", "3"))

    if ($commandChoice -eq "3") {
        Write-Host "Skipping database updates." -ForegroundColor Yellow
        $result.Notes = "Skipped (user choice)"
        return $result
    }

    $commandType = if ($commandChoice -eq "1") { "migrate" } else { "push" }

    # Detect if migration files are present; if not, fall back to db push
    $migrationsPath = Join-Path $ProjectPath "prisma/migrations"
    $hasMigrations = $false
    if (Test-Path $migrationsPath) {
        $migrationDirs = Get-ChildItem -Path $migrationsPath -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($migrationDirs) {
            $hasMigrations = $true
        }
    }

    if ($commandType -eq "migrate" -and -not $hasMigrations) {
        Write-Host ""
        Write-Host "⚠️  No Prisma migration files found in '$migrationsPath'." -ForegroundColor Yellow
        Write-Host "   Falling back to 'prisma db push' for this release." -ForegroundColor Yellow
        $commandType = "push"
    }

    # Ask for migration name once if using migrate command
    $migrationName = $null
    if ($commandType -eq "migrate") {
        Write-Host ""
        do {
            $migrationName = Read-Host "Migration name (kebab-case recommended)"
            if ([string]::IsNullOrWhiteSpace($migrationName)) {
                Write-Host "Migration name cannot be empty." -ForegroundColor Yellow
            }
        } until (-not [string]::IsNullOrWhiteSpace($migrationName))
    }

    # Ask about local database
    Write-Host ""
    Write-Host "Update LOCAL database?" -ForegroundColor Yellow
    Write-Host "  This will update your local development database." -ForegroundColor Gray
    $updateLocal = Read-Host "Update local database? (y/n)"

    if ($updateLocal -eq "y" -or $updateLocal -eq "Y") {
        try {
            $command = Invoke-PrismaDatabaseUpdate -ProjectPath $ProjectPath -DatabaseTarget "local" -CommandType $commandType -MigrationName $migrationName
            Write-Host "✅ Local database updated successfully!" -ForegroundColor Green
            $result.LocalUpdated = $true
            if ($result.Command) {
                $result.Command += " (local), "
            } else {
                $result.Command = "$command (local), "
            }
        } catch {
            Write-Host "❌ Failed to update local database: $_" -ForegroundColor Red
            Write-Host "Continue with Railway update? (y/n)" -ForegroundColor Yellow
            $continue = Read-Host
            if ($continue -ne "y" -and $continue -ne "Y") {
                throw "Database update cancelled due to local database failure."
            }
        }
    }

    # Ask about Railway database
    Write-Host ""
    Write-Host "Update RAILWAY database?" -ForegroundColor Yellow
    Write-Host "  This will update your production database on Railway." -ForegroundColor Gray
    Write-Host "  ⚠️  Make sure you've backed up your production database!" -ForegroundColor Red
    Write-Host "  ℹ️  Use the PUBLIC proxy URL (e.g., shortline.proxy.rlwy.net:45995)" -ForegroundColor Cyan
    Write-Host "     NOT the internal hostname (postgres.railway.internal)" -ForegroundColor Cyan
    $updateRailway = Read-Host "Update Railway database? (y/n)"

    if ($updateRailway -eq "y" -or $updateRailway -eq "Y") {
        try {
            $command = Invoke-PrismaDatabaseUpdate -ProjectPath $ProjectPath -DatabaseTarget "railway" -CommandType $commandType -MigrationName $migrationName
            Write-Host "✅ Railway database updated successfully!" -ForegroundColor Green
            $result.RailwayUpdated = $true
            if ($result.Command) {
                $result.Command += "$command (railway)"
            } else {
                $result.Command = "$command (railway)"
            }
        } catch {
            Write-Host "❌ Failed to update Railway database: $_" -ForegroundColor Red
            throw "Railway database update failed. Please fix the issue before proceeding."
        }
    }

    if ($result.LocalUpdated -or $result.RailwayUpdated) {
        $result.Ran = $true
        if (-not $result.Command) {
            $result.Command = "Database updates skipped"
        }
        $result.Notes = "Local: $($result.LocalUpdated), Railway: $($result.RailwayUpdated)"
    } else {
        $result.Notes = "No databases updated"
    }

    Write-Host ""
    return $result
}

Show-Header

# Determine platform
# In PowerShell 6+, $IsWindows is an automatic read-only variable
# In PowerShell 5.1, we need to determine it manually
# We'll use a script-scoped variable to avoid conflicts
if ($PSVersionTable.PSVersion.Major -ge 6) {
    # PowerShell 6+ - $IsWindows is automatic, just use it
    # No assignment needed, it's available globally
} else {
    # PowerShell 5.1 - create our own variable
    Set-Variable -Name IsWindows -Value ($env:OS -eq "Windows_NT") -Scope Script
}

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

    # Get current version/tag (filter to only version tags like v1.0.0 or 1.0.0)
    # This filters out tags like "agent-v1" that don't match the version pattern
    $versionTags = git tag -l | Where-Object { $_ -match '^v?\d+\.\d+\.\d+$' }
    if ($versionTags) {
        # Sort by version number and get the latest
        $latestTag = $versionTags | Sort-Object { 
            $ver = $_ -replace '^v', ''
            try { [version]$ver } catch { [version]"0.0.0" }
        } | Select-Object -Last 1
    } else {
        # No version tags found, use git describe as fallback
        $latestTag = git describe --tags --abbrev=0 2>$null
        # If the fallback tag doesn't match version pattern, ignore it
        if ($latestTag -and $latestTag -notmatch '^v?\d+\.\d+\.\d+$') {
            $latestTag = $null
        }
    }

    Write-Host "Current Status:" -ForegroundColor Cyan
    Write-Host "  Branch: " -NoNewline -ForegroundColor Gray

    # Handle detached HEAD state
    if ([string]::IsNullOrWhiteSpace($currentBranch)) {
        $currentBranch = "detached HEAD"
        Write-Host $currentBranch -ForegroundColor Red
        Write-Host ""
        Write-Host "⚠️  You are in detached HEAD state!" -ForegroundColor Yellow
        Write-Host "   Please return to a branch before creating a release:" -ForegroundColor Yellow
        Write-Host "   git checkout main" -ForegroundColor Gray
        Write-Host ""
        Pop-Location
        exit 1
    }

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
        Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host "Restore Options" -ForegroundColor Cyan
        Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Selected version: " -NoNewline -ForegroundColor White
        Write-Host "$selectedTag" -ForegroundColor Green
        Write-Host "Date: " -NoNewline -ForegroundColor White
        Write-Host "$($tagList[$versionIndex].Date)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "How would you like to restore?" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  1. " -NoNewline -ForegroundColor Yellow
        Write-Host "View Only (detached HEAD - safe, no changes to branch)" -ForegroundColor White
        Write-Host "     • Checkout code to view/test this version" -ForegroundColor Gray
        Write-Host "     • Repository in 'detached HEAD' state" -ForegroundColor Gray
        Write-Host "     • Easily return to latest with 'git checkout main'" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  2. " -NoNewline -ForegroundColor Yellow
        Write-Host "Full Rollback (DESTRUCTIVE - resets branch to this version)" -ForegroundColor Red
        Write-Host "     • Resets '$currentBranch' branch to this version" -ForegroundColor Gray
        Write-Host "     • Deletes all commits after $selectedTag" -ForegroundColor Gray
        Write-Host "     • Force pushes to GitHub (overwrites remote)" -ForegroundColor Gray
        Write-Host "     ⚠️  THIS CANNOT BE UNDONE!" -ForegroundColor Red
        Write-Host ""
        Write-Host "  0. Cancel" -ForegroundColor Yellow
        Write-Host ""
        $restoreMethod = Read-Host "Enter choice (0-2)"

        if ($restoreMethod -eq "0" -or [string]::IsNullOrWhiteSpace($restoreMethod)) {
            Write-Host "Restore cancelled." -ForegroundColor Yellow
            Pop-Location
            exit
        }

        if ($restoreMethod -ne "1" -and $restoreMethod -ne "2") {
            Write-Host "Invalid choice. Cancelled." -ForegroundColor Yellow
            Pop-Location
            exit
        }

        Write-Host ""
        Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host "⚠️  WARNING: Restore Operation" -ForegroundColor Yellow
        Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "You are about to restore to version: " -NoNewline -ForegroundColor White
        Write-Host "$selectedTag" -ForegroundColor Green
        Write-Host ""

        if ($restoreMethod -eq "2") {
            Write-Host "This will:" -ForegroundColor Red
            Write-Host "  • RESET $currentBranch branch to $selectedTag" -ForegroundColor Gray
            Write-Host "  • DELETE all commits after $selectedTag" -ForegroundColor Gray
            Write-Host "  • FORCE PUSH to GitHub (overwrites remote history)" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Commits that will be LOST:" -ForegroundColor Red
            git log --oneline $selectedTag..HEAD 2>$null
            Write-Host ""
            Write-Host "⚠️  THIS IS PERMANENT AND CANNOT BE UNDONE!" -ForegroundColor Red
        } else {
            Write-Host "This will:" -ForegroundColor Yellow
            Write-Host "  • Checkout the code from version $selectedTag" -ForegroundColor Gray
            Write-Host "  • Put your repository in 'detached HEAD' state" -ForegroundColor Gray
            Write-Host "  • You can explore this version safely" -ForegroundColor Gray
        }
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

        if ($restoreMethod -eq "2") {
            # Full Rollback - Hard Reset
            Write-Host "Resetting $currentBranch to $selectedTag..." -ForegroundColor Yellow
            git reset --hard $selectedTag

            if ($LASTEXITCODE -ne 0) {
                Write-Host "❌ Reset failed" -ForegroundColor Red
                Pop-Location
                exit 1
            }

            Write-Host "✅ Branch reset to $selectedTag" -ForegroundColor Green
            Write-Host ""
            Write-Host "Pushing to GitHub (force push)..." -ForegroundColor Yellow
            git push --force origin $currentBranch

            if ($LASTEXITCODE -ne 0) {
                Write-Host "❌ Force push failed" -ForegroundColor Red
                Write-Host ""
                Write-Host "Local branch has been reset, but GitHub was not updated." -ForegroundColor Yellow
                Write-Host "You can manually force push with:" -ForegroundColor Cyan
                Write-Host "  git push --force origin $currentBranch" -ForegroundColor Gray
                Write-Host ""
                Pop-Location
                exit 1
            }

            Write-Host "✅ Pushed to GitHub" -ForegroundColor Green
            Write-Host ""
            Write-Host "════════════════════════════════════════" -ForegroundColor Green
            Write-Host "✅ Rollback Complete!" -ForegroundColor Green
            Write-Host "════════════════════════════════════════" -ForegroundColor Green
            Write-Host ""
            Write-Host "Branch: " -NoNewline -ForegroundColor Cyan
            Write-Host "$currentBranch" -ForegroundColor White
            Write-Host "Version: " -NoNewline -ForegroundColor Cyan
            Write-Host "$selectedTag" -ForegroundColor Green
            Write-Host ""
            Write-Host "Your repository has been rolled back to $selectedTag" -ForegroundColor Gray
            Write-Host "All commits after this version have been deleted." -ForegroundColor Gray
            Write-Host "Railway will auto-deploy this version." -ForegroundColor Gray
            Write-Host ""

        } else {
            # View Only - Detached HEAD
            Write-Host "Checking out version $selectedTag..." -ForegroundColor Yellow
            git checkout $selectedTag

            if ($LASTEXITCODE -ne 0) {
                Write-Host "❌ Checkout failed" -ForegroundColor Red
                Pop-Location
                exit 1
            }

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
                Write-Host "⚠️  INTERMITTENT CONNECTIVITY DETECTED" -ForegroundColor Yellow
                Write-Host "   If this worked earlier, it's likely a network/VPN issue." -ForegroundColor Gray
                Write-Host ""
                Write-Host "Possible causes:" -ForegroundColor Cyan
                Write-Host "  • VPN disconnected or unstable" -ForegroundColor Gray
                Write-Host "  • Corporate firewall blocking GitHub intermittently" -ForegroundColor Gray
                Write-Host "  • Network proxy timeout or rate limiting" -ForegroundColor Gray
                Write-Host "  • Windows Firewall or antivirus interference" -ForegroundColor Gray
                Write-Host "  • GitHub is down (check: https://www.githubstatus.com)" -ForegroundColor Gray
                Write-Host ""
                Write-Host "Quick fixes to try:" -ForegroundColor Cyan
                Write-Host "  1. Reconnect your VPN" -ForegroundColor Gray
                Write-Host "  2. Disable Windows Firewall temporarily (test)" -ForegroundColor Gray
                Write-Host "  3. Check proxy settings: git config --global http.proxy" -ForegroundColor Gray
                Write-Host "  4. Try from a different network (mobile hotspot)" -ForegroundColor Gray
                Write-Host ""
                Write-Host "Manual connectivity tests:" -ForegroundColor Cyan
                Write-Host "  • ping github.com" -ForegroundColor Gray
                Write-Host "  • git remote -v (verify remote URL)" -ForegroundColor Gray
                Write-Host "  • git ls-remote origin (tests git connectivity)" -ForegroundColor Gray
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
    $schemaSyncRan = $false
    $schemaSyncInfo = ""

    # Check for schema file in different possible locations
    if (Test-Path "SasWatch/prisma/schema.prisma") {
        $schemaPath = "SasWatch/prisma/schema.prisma"
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

    if ($schemaChanged) {
        if ($mode -eq "dryrun") {
            $schemaSyncInfo = "Dry run - Prisma commands not executed"
        } elseif ($mode -ne "dryrun") {
            $prismaRoot = Get-PrismaProjectRoot
            if ($null -eq $prismaRoot) {
                Write-Host "⚠️  Prisma project path not found; skipping automatic schema sync." -ForegroundColor Yellow
                $schemaSyncInfo = "Auto sync skipped (schema path not found)"
            } else {
                try {
                    $syncResult = Invoke-PrismaSchemaSync -ProjectPath $prismaRoot
                    $schemaSyncRan = $syncResult.Ran
                    if ($syncResult.Ran) {
                        $schemaSyncInfo = $syncResult.Command
                        if ($syncResult.Notes) {
                            $schemaSyncInfo = "$schemaSyncInfo ($($syncResult.Notes))"
                        }
                    } else {
                        $schemaSyncInfo = $syncResult.Notes
                    }
                }
                catch {
                    Write-Host $_.Exception.Message -ForegroundColor Red
                    Write-Host "Release cancelled due to Prisma command failure." -ForegroundColor Red
                    Pop-Location
                    exit 1
                }
            }
        }
    }

    # Refresh git status after Prisma sync (migration files may have been created)
    if ($schemaSyncRan) {
        $status = git status --short
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
        # Validate version format (should be x.y.z)
        if ($currentVersion -notmatch '^\d+\.\d+\.\d+$') {
            Write-Host "Warning: Latest tag '$latestTag' doesn't match version format. Starting from 0.0.0" -ForegroundColor Yellow
            $currentVersion = "0.0.0"
        }
    } else {
        # If no tags, start at 0.0.0 to correctly bump to 0.1.0, 0.0.1 etc.
        $currentVersion = "0.0.0"
    }

    # Parse and bump version
    $versionParts = $currentVersion.Split('.')
    if ($versionParts.Length -ne 3) {
        Write-Host "Error: Invalid version format '$currentVersion'. Expected x.y.z" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    try {
        $major = [int]$versionParts[0]
        $minor = [int]$versionParts[1]
        $patch = [int]$versionParts[2]
    } catch {
        Write-Host "Error: Failed to parse version '$currentVersion': $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }

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
        -HasChanges ([bool]$status) -SchemaChanged $schemaChanged `
        -SchemaSyncRan $schemaSyncRan -SchemaSyncInfo $schemaSyncInfo

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
        Write-Host "Pushing to GitHub..." -ForegroundColor Yellow

        # Push commits and tag together in a single operation (more reliable)
        if ($status) {
            # Have commits to push along with tag
            git push origin $currentBranch --follow-tags
        } else {
            # No commits, just push the tag
            git push origin $newVersion
        }

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
            Write-Host "  2. Retry push now" -ForegroundColor White
            Write-Host ""
            $pushChoice = Read-Host "Enter choice (1-2)"

            if ($pushChoice -eq "2") {
                Write-Host ""
                Write-Host "Retrying push..." -ForegroundColor Yellow

                if ($status) {
                    git push origin $currentBranch --follow-tags
                } else {
                    git push origin $newVersion
                }

                if ($LASTEXITCODE -ne 0) {
                    Write-Host "❌ Push still failed" -ForegroundColor Red
                    Write-Host ""
                    Write-Host "Changes and tag are saved locally. Push manually with:" -ForegroundColor Yellow
                    if ($status) {
                        Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                    }
                    Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                    Pop-Location
                    exit 1
                } else {
                    Write-Host "✅ Push successful on retry!" -ForegroundColor Green
                }
            } else {
                Write-Host ""
                Write-Host "✅ Release saved locally" -ForegroundColor Green
                Write-Host ""
                Write-Host "Push manually when ready with:" -ForegroundColor Cyan
                if ($status) {
                    Write-Host "  git push origin $currentBranch" -ForegroundColor Gray
                }
                Write-Host "  git push origin $newVersion" -ForegroundColor Gray
                Write-Host ""
                Pop-Location
                exit 0
            }
        } else {
            Write-Host "✅ Pushed to GitHub successfully!" -ForegroundColor Green
        }

        # Success message
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
