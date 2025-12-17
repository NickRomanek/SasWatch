# Setup Local Configuration for Activity Agent
# Run this script as Administrator to configure the agent for local testing

param(
    [Parameter(Mandatory=$false)]
    [string]$ApiUrl = "http://localhost:3000/api/track",
    
    [Parameter(Mandatory=$true)]
    [string]$ApiKey
)

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Activity Agent - Local Configuration Setup" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Create registry key
$registryPath = "HKLM:\Software\ActivityAgent"

Write-Host "Creating registry key: $registryPath" -ForegroundColor Yellow
if (-not (Test-Path $registryPath)) {
    New-Item -Path $registryPath -Force | Out-Null
    Write-Host "  Registry key created" -ForegroundColor Green
} else {
    Write-Host "  Registry key already exists" -ForegroundColor Gray
}

# Set configuration values
Write-Host ""
Write-Host "Setting configuration values..." -ForegroundColor Yellow

Set-ItemProperty -Path $registryPath -Name "ApiUrl" -Value $ApiUrl -Type String
Write-Host "  ApiUrl: $ApiUrl" -ForegroundColor Green

Set-ItemProperty -Path $registryPath -Name "ApiKey" -Value $ApiKey -Type String
Write-Host "  ApiKey: ***" -ForegroundColor Green

Set-ItemProperty -Path $registryPath -Name "CheckInterval" -Value 10 -Type DWord
Write-Host "  CheckInterval: 10 seconds" -ForegroundColor Green

Set-ItemProperty -Path $registryPath -Name "EnableBrowser" -Value 1 -Type DWord
Write-Host "  EnableBrowser: Yes" -ForegroundColor Green

Set-ItemProperty -Path $registryPath -Name "EnableNetwork" -Value 1 -Type DWord
Write-Host "  EnableNetwork: Yes" -ForegroundColor Green

Set-ItemProperty -Path $registryPath -Name "EnableApps" -Value 1 -Type DWord
Write-Host "  EnableApps: Yes" -ForegroundColor Green

Set-ItemProperty -Path $registryPath -Name "EnableWindowFocus" -Value 1 -Type DWord
Write-Host "  EnableWindowFocus: Yes" -ForegroundColor Green

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Configuration Complete!" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "You can now run the agent with:" -ForegroundColor White
Write-Host "  cd src/ActivityAgent.Service" -ForegroundColor Gray
Write-Host "  dotnet run" -ForegroundColor Gray
Write-Host ""
Write-Host "To view configuration:" -ForegroundColor White
Write-Host "  Get-ItemProperty -Path $registryPath" -ForegroundColor Gray
Write-Host ""

