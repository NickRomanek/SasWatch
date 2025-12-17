# Build Script for Activity Agent
# Builds the agent for production deployment

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    
    [Parameter(Mandatory=$false)]
    [switch]$Clean
)

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Activity Agent - Build Script" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Clean if requested
if ($Clean) {
    Write-Host "Cleaning previous builds..." -ForegroundColor Yellow
    dotnet clean --configuration $Configuration
    Write-Host "  Clean complete" -ForegroundColor Green
    Write-Host ""
}

# Restore packages
Write-Host "Restoring NuGet packages..." -ForegroundColor Yellow
dotnet restore
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Package restore failed" -ForegroundColor Red
    exit 1
}
Write-Host "  Restore complete" -ForegroundColor Green
Write-Host ""

# Build solution
Write-Host "Building solution ($Configuration)..." -ForegroundColor Yellow
dotnet build --configuration $Configuration --no-restore
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "  Build complete" -ForegroundColor Green
Write-Host ""

# Publish self-contained executable
Write-Host "Publishing self-contained executable..." -ForegroundColor Yellow
$publishPath = ".\publish"
dotnet publish src/ActivityAgent.Service/ActivityAgent.Service.csproj `
    --configuration $Configuration `
    --runtime win-x64 `
    --self-contained true `
    --output $publishPath `
    /p:PublishSingleFile=true `
    /p:IncludeNativeLibrariesForSelfExtract=true `
    /p:EnableCompressionInSingleFile=true

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Publish failed" -ForegroundColor Red
    exit 1
}
Write-Host "  Publish complete" -ForegroundColor Green
Write-Host ""

# Show output
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Build Successful!" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output location:" -ForegroundColor White
Write-Host "  $publishPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Main executable:" -ForegroundColor White
Write-Host "  $publishPath\ActivityAgent.Service.exe" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Test the executable locally" -ForegroundColor Gray
Write-Host "  2. Create MSI installer (WiX)" -ForegroundColor Gray
Write-Host "  3. Sign the executable and MSI" -ForegroundColor Gray
Write-Host "  4. Deploy via Intune" -ForegroundColor Gray
Write-Host ""

