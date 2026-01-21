# Setup Test Database Script
# This script helps set up the test database for running tests

Write-Host "🔧 Setting up test database..." -ForegroundColor Cyan

# Check if Docker is available
$dockerAvailable = $false
try {
    $dockerVersion = docker --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $dockerAvailable = $true
        Write-Host "✅ Docker is available" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Docker not found" -ForegroundColor Yellow
}

# Check if PostgreSQL is running locally
$pgRunning = $false
try {
    $pgCheck = Get-Service -Name "*postgresql*" -ErrorAction SilentlyContinue
    if ($pgCheck) {
        $pgRunning = $true
        Write-Host "✅ PostgreSQL service found" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  PostgreSQL service not found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Choose an option:" -ForegroundColor Cyan
Write-Host "1. Use Docker (recommended - easiest)" -ForegroundColor White
Write-Host "2. Use local PostgreSQL (if installed)" -ForegroundColor White
Write-Host "3. Skip - I'll set it up manually" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Enter choice (1-3)"

if ($choice -eq "1") {
    if (-not $dockerAvailable) {
        Write-Host "❌ Docker is not available. Please install Docker Desktop first." -ForegroundColor Red
        Write-Host "   Download from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host ""
    Write-Host "🐳 Starting PostgreSQL in Docker..." -ForegroundColor Cyan
    
    # Check if container already exists
    $existing = docker ps -a --filter "name=saswatch-test-db" --format "{{.Names}}" 2>&1
    if ($existing -eq "saswatch-test-db") {
        Write-Host "Container exists, starting it..." -ForegroundColor Yellow
        docker start saswatch-test-db
    } else {
        Write-Host "Creating new container..." -ForegroundColor Yellow
        docker run -d `
            --name saswatch-test-db `
            -e POSTGRES_PASSWORD=postgres `
            -e POSTGRES_DB=saswatch_test `
            -p 5432:5432 `
            postgres:15-alpine
        
        Write-Host "Waiting for PostgreSQL to start..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
    
    Write-Host "✅ Test database is ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. cd SasWatch" -ForegroundColor White
    Write-Host "  2. `$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/saswatch_test'" -ForegroundColor White
    Write-Host "  3. npm run db:push" -ForegroundColor White
    Write-Host "  4. npm test" -ForegroundColor White
    
} elseif ($choice -eq "2") {
    if (-not $pgRunning) {
        Write-Host "❌ PostgreSQL service not found. Please install PostgreSQL first." -ForegroundColor Red
        Write-Host "   Or use option 1 (Docker) instead." -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host ""
    Write-Host "📝 Setting up local PostgreSQL database..." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "You'll need to run these commands manually:" -ForegroundColor Yellow
    Write-Host "  createdb saswatch_test" -ForegroundColor White
    Write-Host "  # Or using psql:" -ForegroundColor Gray
    Write-Host "  psql -U postgres -c 'CREATE DATABASE saswatch_test;'" -ForegroundColor White
    Write-Host ""
    Write-Host "Then:" -ForegroundColor Cyan
    Write-Host "  cd SasWatch" -ForegroundColor White
    Write-Host "  `$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/saswatch_test'" -ForegroundColor White
    Write-Host "  npm run db:push" -ForegroundColor White
    Write-Host "  npm test" -ForegroundColor White
    
} else {
    Write-Host ""
    Write-Host "📖 Manual setup instructions:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Set up PostgreSQL database named 'saswatch_test'" -ForegroundColor White
    Write-Host "2. Set DATABASE_URL environment variable:" -ForegroundColor White
    Write-Host "   `$env:DATABASE_URL='postgresql://user:password@localhost:5432/saswatch_test'" -ForegroundColor Gray
    Write-Host "3. Run: cd SasWatch && npm run db:push" -ForegroundColor White
    Write-Host "4. Run: npm test" -ForegroundColor White
    Write-Host ""
    Write-Host "See TEST-SETUP-GUIDE.md for detailed instructions." -ForegroundColor Yellow
}
