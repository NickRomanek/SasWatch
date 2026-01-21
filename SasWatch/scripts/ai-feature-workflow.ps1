# AI Feature Development Workflow
# Use this script when working with Cursor Agent Mode to implement features

param(
    [string]$FeatureName = "",
    [switch]$TestOnly = $false,
    [switch]$Coverage = $false
)

Write-Host "🤖 AI Feature Development Workflow" -ForegroundColor Cyan
Write-Host ""

if ($FeatureName) {
    Write-Host "Feature: $FeatureName" -ForegroundColor Yellow
    Write-Host ""
}

# Ensure test database is ready
Write-Host "📦 Checking test database..." -ForegroundColor Cyan
$containerRunning = docker ps --filter "name=saswatch-postgres" --format "{{.Names}}" 2>&1
if ($containerRunning -ne "saswatch-postgres") {
    Write-Host "Starting PostgreSQL container..." -ForegroundColor Yellow
    Set-Location $PSScriptRoot\..
    docker-compose -f docker-compose.yml up -d postgres
    Start-Sleep -Seconds 3
}

# Set test database URL
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/saswatch_test"

if ($TestOnly) {
    Write-Host "🧪 Running tests only..." -ForegroundColor Cyan
    npm test
    exit $LASTEXITCODE
}

if ($Coverage) {
    Write-Host "📊 Running tests with coverage..." -ForegroundColor Cyan
    npm run test:coverage
    Write-Host ""
    Write-Host "Coverage report: coverage/index.html" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

# Full workflow: lint check, tests, then ready for AI
Write-Host "🔍 Pre-flight checks..." -ForegroundColor Cyan

# Check if Prisma client is generated
if (-not (Test-Path "node_modules/.prisma/client")) {
    Write-Host "Generating Prisma client..." -ForegroundColor Yellow
    npm run db:generate
}

# Run tests
Write-Host ""
Write-Host "🧪 Running tests..." -ForegroundColor Cyan
npm test

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ All checks passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🚀 Ready for AI development:" -ForegroundColor Cyan
    Write-Host "   1. Open Cursor" -ForegroundColor White
    Write-Host "   2. Press Cmd/Ctrl + K (Agent Mode)" -ForegroundColor White
    Write-Host "   3. Describe your feature" -ForegroundColor White
    Write-Host "   4. AI will implement with tests" -ForegroundColor White
    Write-Host ""
    Write-Host "💡 Tip: Use 'npm test' after AI makes changes to verify" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "❌ Tests failed - fix issues before proceeding" -ForegroundColor Red
    exit 1
}
