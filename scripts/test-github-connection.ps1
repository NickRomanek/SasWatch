# GitHub Connection Diagnostic Script
# Tests various ways to connect to GitHub to diagnose connection issues

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   GitHub Connection Diagnostics        ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Test 1: Basic network connectivity
Write-Host "Test 1: Basic network connectivity to github.com" -ForegroundColor Yellow
try {
    $ping = Test-Connection -ComputerName github.com -Count 2 -ErrorAction Stop
    Write-Host "  ✓ Can ping github.com" -ForegroundColor Green
    Write-Host "    Average latency: $([math]::Round(($ping | Measure-Object -Property ResponseTime -Average).Average, 0))ms" -ForegroundColor Gray
}
catch {
    Write-Host "  ✗ Cannot ping github.com" -ForegroundColor Red
    Write-Host "    This might indicate:" -ForegroundColor Gray
    Write-Host "    • No internet connection" -ForegroundColor Gray
    Write-Host "    • VPN not connected" -ForegroundColor Gray
    Write-Host "    • Firewall blocking ICMP" -ForegroundColor Gray
}
Write-Host ""

# Test 2: HTTPS connectivity (port 443)
Write-Host "Test 2: HTTPS connectivity (port 443)" -ForegroundColor Yellow
try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $connect = $tcpClient.BeginConnect("github.com", 443, $null, $null)
    $wait = $connect.AsyncWaitHandle.WaitOne(5000, $false)
    if ($wait) {
        $tcpClient.EndConnect($connect)
        Write-Host "  ✓ Port 443 is reachable" -ForegroundColor Green
        $tcpClient.Close()
    }
    else {
        Write-Host "  ✗ Port 443 is blocked or unreachable" -ForegroundColor Red
        Write-Host "    This is the port git uses for HTTPS!" -ForegroundColor Yellow
        $tcpClient.Close()
    }
}
catch {
    Write-Host "  ✗ Cannot connect to port 443" -ForegroundColor Red
    Write-Host "    Git push will not work over HTTPS" -ForegroundColor Yellow
}
Write-Host ""

# Test 3: Git ls-remote (quick test)
Write-Host "Test 3: Git ls-remote (quick connectivity test)" -ForegroundColor Yellow
$env:GIT_TERMINAL_PROMPT = "0"
$lsRemoteStart = Get-Date
git ls-remote --heads origin 2>&1 | Out-Null
$lsRemoteDuration = ((Get-Date) - $lsRemoteStart).TotalSeconds
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Git ls-remote succeeded" -ForegroundColor Green
    Write-Host "    Completed in: $([math]::Round($lsRemoteDuration, 1))s" -ForegroundColor Gray
}
else {
    Write-Host "  ✗ Git ls-remote failed" -ForegroundColor Red
    Write-Host "    Duration: $([math]::Round($lsRemoteDuration, 1))s" -ForegroundColor Gray
}
Write-Host ""

# Test 4: Check git configuration
Write-Host "Test 4: Git configuration" -ForegroundColor Yellow
$remoteUrl = git remote get-url origin 2>$null
if ($remoteUrl) {
    Write-Host "  Remote URL: $remoteUrl" -ForegroundColor White
    if ($remoteUrl -match "^https://") {
        Write-Host "  Protocol: HTTPS (port 443)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  If HTTPS is blocked, you can switch to SSH:" -ForegroundColor Gray
        Write-Host "    1. Set up SSH key: https://docs.github.com/en/authentication" -ForegroundColor Gray
        Write-Host "    2. Change remote: git remote set-url origin git@github.com:NickRomanek/AbowdyV2.git" -ForegroundColor Gray
    }
    elseif ($remoteUrl -match "^git@") {
        Write-Host "  Protocol: SSH (port 22)" -ForegroundColor Cyan
    }
}
Write-Host ""

# Test 5: Check for proxy settings
Write-Host "Test 5: Proxy configuration" -ForegroundColor Yellow
$gitHttpProxy = git config --get http.proxy
$gitHttpsProxy = git config --get https.proxy
$envHttpProxy = $env:HTTP_PROXY
$envHttpsProxy = $env:HTTPS_PROXY

if ($gitHttpProxy -or $gitHttpsProxy -or $envHttpProxy -or $envHttpsProxy) {
    Write-Host "  Proxy settings detected:" -ForegroundColor Cyan
    if ($gitHttpProxy) { Write-Host "    Git http.proxy: $gitHttpProxy" -ForegroundColor Gray }
    if ($gitHttpsProxy) { Write-Host "    Git https.proxy: $gitHttpsProxy" -ForegroundColor Gray }
    if ($envHttpProxy) { Write-Host "    Env HTTP_PROXY: $envHttpProxy" -ForegroundColor Gray }
    if ($envHttpsProxy) { Write-Host "    Env HTTPS_PROXY: $envHttpsProxy" -ForegroundColor Gray }
}
else {
    Write-Host "  No proxy configuration found" -ForegroundColor Green
}
Write-Host ""

# Summary
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Summary & Recommendations" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "If port 443 is blocked:" -ForegroundColor Yellow
Write-Host "  • Check if you're on a corporate network with firewall" -ForegroundColor White
Write-Host "  • Try connecting to VPN if available" -ForegroundColor White
Write-Host "  • Contact IT to allow git operations on port 443" -ForegroundColor White
Write-Host "  • OR switch to SSH (port 22) instead of HTTPS" -ForegroundColor White
Write-Host ""
Write-Host "For now, use 'Local Only' mode in the release script" -ForegroundColor Cyan
Write-Host "You can manually push later when network allows:" -ForegroundColor Cyan
Write-Host "  git push origin main" -ForegroundColor Gray
Write-Host "  git push origin <tag-name>" -ForegroundColor Gray
Write-Host ""
