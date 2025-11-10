# Manual Railway Database Schema Deployment Script
# Run this from the SubTracker directory

param(
    [Parameter(Mandatory=$true)]
    [string]$ProxyHost,
    
    [Parameter(Mandatory=$false)]
    [string]$Command = "push"  # "push" or "migrate"
)

$dbUser = "postgres"
$dbPass = "ACQXfJYugutGjJrcNSGKmOZInwszmUzc"
$dbName = "railway"

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

