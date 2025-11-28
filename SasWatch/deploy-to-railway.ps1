# Manual Railway Database Schema Deployment Script
# Run this from the SubTracker directory

param(
    [Parameter(Mandatory=$true)]
    [string]$ProxyHost,
    
    [Parameter(Mandatory=$false)]
    [string]$Command = "push"  # "push" or "migrate"
)

$dbUser = "postgres"
$dbName = "railway"

# Get password from Railway CLI or environment variable
$dbPass = $null

# Try to get from Railway CLI first
if (Get-Command railway -ErrorAction SilentlyContinue) {
    try {
        Write-Host "🔍 Getting database password from Railway..." -ForegroundColor Gray
        $railwayVars = railway variables 2>&1 | Out-String
        $passwordLine = $railwayVars | Select-String -Pattern "POSTGRES_PASSWORD\s*=\s*(.+)" | Select-Object -First 1
        if ($passwordLine) {
            $dbPass = ($passwordLine.Line -split "=", 2)[1].Trim()
            Write-Host "   ✓ Retrieved password from Railway" -ForegroundColor Green
        }
    } catch {
        Write-Host "   ⚠ Could not get password from Railway CLI: $_" -ForegroundColor Yellow
    }
}

# Fallback to environment variable
if (-not $dbPass) {
    $dbPass = $env:POSTGRES_PASSWORD
    if ($dbPass) {
        Write-Host "   ✓ Using password from POSTGRES_PASSWORD environment variable" -ForegroundColor Green
    }
}

# Last resort: prompt for password
if (-not $dbPass) {
    Write-Host "   ⚠ Password not found in Railway or environment" -ForegroundColor Yellow
    $securePass = Read-Host -Prompt "Enter Railway PostgreSQL password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
    $dbPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

# Construct the public proxy DATABASE_URL
$railwayDbUrl = "postgresql://${dbUser}:${dbPass}@${ProxyHost}/${dbName}"

Write-Host "🚀 Deploying schema to Railway database..." -ForegroundColor Cyan
Write-Host "   Using proxy: ${ProxyHost}" -ForegroundColor Gray
Write-Host ""

# Set DATABASE_URL and run Prisma command
$env:DATABASE_URL = $railwayDbUrl

if ($Command -eq "migrate") {
    Write-Host "Running: npx prisma migrate deploy" -ForegroundColor Yellow
    npx prisma migrate deploy
} else {
    Write-Host "Running: npx prisma db push --accept-data-loss" -ForegroundColor Yellow
    npx prisma db push --accept-data-loss
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Schema deployed successfully!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Deployment failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

