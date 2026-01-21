# Quick Test Setup - Uses Existing Docker Compose
# This script uses your existing docker-compose.yml setup

Write-Host "[TEST] Quick Test Setup" -ForegroundColor Cyan
Write-Host ""

# Check if Docker container is running
$containerRunning = docker ps --filter "name=saswatch-postgres" --format "{{.Names}}" 2>&1
if ($containerRunning -eq "saswatch-postgres") {
    Write-Host "[OK] Found existing PostgreSQL container: saswatch-postgres" -ForegroundColor Green
} else {
    Write-Host "[WARN] PostgreSQL container not running. Starting it..." -ForegroundColor Yellow
    Write-Host ""
    
    # Start using existing docker-compose
    Set-Location $PSScriptRoot\..
    docker-compose -f docker-compose.yml up -d postgres
    
    Write-Host "Waiting for PostgreSQL to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

# Create test database in existing container (if it doesn't exist)
Write-Host ""
Write-Host "[DB] Setting up test database..." -ForegroundColor Cyan

# Check if database exists, create if not
$dbExists = docker exec saswatch-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='saswatch_test'" 2>&1
if ($dbExists -match "1") {
    Write-Host "[OK] Test database already exists" -ForegroundColor Green
} else {
    Write-Host "Creating saswatch_test database..." -ForegroundColor Yellow
    docker exec -i saswatch-postgres psql -U postgres -c "CREATE DATABASE saswatch_test;" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Test database created" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Could not create database (might already exist)" -ForegroundColor Yellow
    }
}

# Set up Prisma schema
Write-Host ""
Write-Host "[SCHEMA] Setting up database schema..." -ForegroundColor Cyan
Set-Location $PSScriptRoot\..

$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/saswatch_test"
npm run db:generate
npm run db:push

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Database schema ready" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Failed to set up schema" -ForegroundColor Red
    exit 1
}

# Run tests
Write-Host ""
Write-Host "[TEST] Running tests..." -ForegroundColor Cyan
Write-Host ""

npm test

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[OK] All tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "[DONE] Setup complete! You're ready for autonomous development." -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "[ERROR] Some tests failed" -ForegroundColor Red
    exit 1
}
