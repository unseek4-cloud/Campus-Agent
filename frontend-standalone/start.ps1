<#
================================================================
 CampusAgent standalone frontend launcher (portable)

 Serves this folder (index.html / app.js / styles.css / data.js)
 over HTTP and, when available, reuses the repository's own
 backend and AI service launchers.

 Usage:
   pwsh -File start.ps1                 # serve UI, try to start whole stack
   pwsh -File start.ps1 -FrontendOnly   # serve UI only, start nothing else
   pwsh -File start.ps1 -Port 5500      # force a port
   pwsh -File start.ps1 -NoBrowser      # do not open a browser

 Why HTTP and not a double-clicked index.html:
   the page talks to the backend with same-site cookies (CAMPUS_AUTH,
   XSRF-TOKEN). Under file:// there is no origin, cookies are dropped and
   the backend CORS check rejects the request, so login can never succeed.

 Portable by design: every path is derived from this script's location.
 No absolute developer paths are stored in this repository.
================================================================
#>
[CmdletBinding()]
param(
    [int]$Port = 0,
    [switch]$FrontendOnly,
    [switch]$NoBrowser,
    [switch]$SkipBackend,
    [switch]$SkipAi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $here

function Write-Section([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok([string]$text)      { Write-Host "   [ok]   $text" -ForegroundColor Green }
function Write-Warn2([string]$text)   { Write-Host "   [warn] $text" -ForegroundColor Yellow }
function Write-Info([string]$text)    { Write-Host "   [info] $text" -ForegroundColor DarkGray }

function Test-Listening([int]$port) {
    try {
        return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)
    } catch {
        return $false
    }
}

function Test-Url([string]$url) {
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    } catch {
        return $false
    }
}

# ---------- 1. locate a static file server (Python standard library) ----------
Write-Section 'Static file server'
$python = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
        try {
            $version = & $command.Source -c "import sys;print('%d.%d'%sys.version_info[:2])" 2>$null
            if ($LASTEXITCODE -eq 0 -and $version) {
                $python = @{ Exe = $command.Source; Args = @(); Version = "$version" }
                if ($candidate -eq 'py') { $python.Args = @('-3') }
                break
            }
        } catch { }
    }
}
if (-not $python) {
    Write-Warn2 'No Python 3 found on PATH.'
    Write-Info 'Install Python 3, or serve this folder with any static server, e.g.:'
    Write-Info "  npx --yes serve -l 5500 `"$here`""
    Write-Info '  VS Code Live Server -> open index.html (port 5500/5501)'
    exit 1
}
Write-Ok ("python {0} -> {1}" -f $python.Version, $python.Exe)

# ---------- 2. pick a free port ----------
Write-Section 'Frontend port'
$candidatePorts = if ($Port -gt 0) { @($Port) } else { @(5500, 5501, 3000, 4173) }
$servePort = $null
foreach ($candidate in $candidatePorts) {
    if (-not (Test-Listening $candidate)) { $servePort = $candidate; break }
    Write-Info "port $candidate is busy, trying next"
    if ($Port -gt 0) { Write-Warn2 "requested port $Port is already in use"; exit 2 }
}
if (-not $servePort) {
    Write-Warn2 'No free port among 5500 / 5501 / 3000 / 4173. Pass -Port <n>.'
    exit 2
}
$pageUrl = "http://localhost:$servePort/"
Write-Ok "will serve on $pageUrl"

# ---------- 3. optional backend + AI service ----------
$starting = New-Object System.Collections.ArrayList
$backendReady = Test-Url 'http://127.0.0.1:8080/api/v1/health'
$aiReady = Test-Url 'http://127.0.0.1:8000/internal/v1/health'

if (-not $FrontendOnly) {
    Write-Section 'Repository services'

    # --- backend ---
    if ($SkipBackend) {
        Write-Info 'backend start skipped (-SkipBackend)'
    } elseif ($backendReady) {
        Write-Ok 'backend already answering on :8080'
    } else {
        $backendScript = Join-Path $repoRoot 'scripts/start-backend.ps1'
        $backendEnv = Join-Path $repoRoot 'backend/.env'
        if (-not (Test-Path -LiteralPath $backendScript)) {
            Write-Warn2 "not found: $backendScript"
            Write-Info 'start the backend yourself, or use -FrontendOnly.'
        } elseif (-not (Test-Path -LiteralPath $backendEnv)) {
            Write-Warn2 'backend/.env is missing; the backend cannot create sessions without it.'
            Write-Info "copy backend/.env.example to backend/.env and fill DB_* + JWT_SECRET, then rerun."
        } else {
            Write-Info 'starting backend in a separate window (first run builds with Maven)...'
            Start-Process -FilePath 'powershell' -ArgumentList @(
                '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $backendScript
            ) -WorkingDirectory $repoRoot | Out-Null
            [void]$starting.Add('backend')
        }
    }

    # --- AI service ---
    if ($SkipAi) {
        Write-Info 'AI service start skipped (-SkipAi)'
    } elseif ($aiReady) {
        Write-Ok 'AI service already answering on :8000'
    } else {
        $aiDirectory = Join-Path $repoRoot 'ai-service'
        $aiEntry = Join-Path $aiDirectory 'app/main.py'
        if (-not (Test-Path -LiteralPath $aiEntry)) {
            Write-Warn2 "not found: $aiEntry"
            Write-Info 'Q&A and policy search will report the AI service as unavailable.'
        } elseif (-not $python) {
            Write-Warn2 'no Python available to start the AI service'
        } else {
            $aiCommand = "`$env:HF_HUB_OFFLINE='1'; `$env:TRANSFORMERS_OFFLINE='1'; " +
                         "`$env:PYTHONIOENCODING='utf-8'; Set-Location -LiteralPath '$aiDirectory'; " +
                         "& '$($python.Exe)' $($python.Args -join ' ') -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
            Write-Info 'starting AI service in a separate window (first run may download models)...'
            Start-Process -FilePath 'powershell' -ArgumentList @(
                '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $aiCommand
            ) -WorkingDirectory $aiDirectory | Out-Null
            [void]$starting.Add('ai')
        }
    }
}

if ($starting.Count -gt 0) {
    Write-Info ("waiting up to 60s for: {0}" -f ($starting -join ', '))
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        $backendReady = Test-Url 'http://127.0.0.1:8080/api/v1/health'
        $aiReady = Test-Url 'http://127.0.0.1:8000/internal/v1/health'
        $pending = @()
        if ($starting -contains 'backend' -and -not $backendReady) { $pending += 'backend' }
        if ($starting -contains 'ai' -and -not $aiReady) { $pending += 'ai' }
        if ($pending.Count -eq 0) { break }
    }
    if ($starting -contains 'backend') {
        if ($backendReady) { Write-Ok 'backend is up on :8080' }
        else { Write-Warn2 'backend did not answer within 60s; check its window for errors.' }
    }
    if ($starting -contains 'ai') {
        if ($aiReady) { Write-Ok 'AI service is up on :8000' }
        else { Write-Warn2 'AI service did not answer within 60s; it may still be downloading models.' }
    }
}

# ---------- 4. serve the frontend ----------
Write-Section 'Serving frontend'
$pythonExe = $python.Exe
$pythonArgs = @($python.Args)
$server = Start-Process -FilePath $pythonExe -ArgumentList ($pythonArgs + @(
    '-m', 'http.server', "$servePort", '--bind', '127.0.0.1'
)) -WorkingDirectory $here -PassThru -WindowStyle Hidden
Write-Ok ("python http.server pid {0}" -f $server.Id)

$ready = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 700
    if (Test-Url $pageUrl) { $ready = $true; break }
    if ($server.HasExited) { break }
}
if (-not $ready) {
    Write-Warn2 "could not reach $pageUrl"
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    exit 3
}
Write-Ok "$pageUrl is answering"

if (-not $NoBrowser) {
    try { Start-Process $pageUrl | Out-Null } catch { Write-Info "open $pageUrl manually" }
}

function Test-EnterPressed {
    # Returns $true once the user presses Enter, $false while still waiting.
    # Never throws: stdin may be redirected (NUL, a file, or a CI pipe).
    if ([Console]::IsInputRedirected) {
        try { return [Console]::In.ReadLine() -ne $null } catch { return $false }
    }
    try { return [Console]::KeyAvailable } catch { return $false }
}

# ---------- 5. runtime summary ----------
Write-Host ''
Write-Host '----------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ("  page      : {0}" -f $pageUrl)
Write-Host ("  backend   : {0}" -f $(if ($backendReady) { 'http://localhost:8080  (up)' } else { 'http://localhost:8080  (down)' }))
Write-Host ("  ai service: {0}" -f $(if ($aiReady) { 'http://localhost:8000  (up)' } else { 'http://localhost:8000  (down)' }))
Write-Host ("  served by : python http.server, folder {0}" -f $here)
Write-Host '----------------------------------------------------------------' -ForegroundColor DarkGray
if ($starting.Count -gt 0) {
    Write-Host '  Service windows opened by this script close with this window;' -ForegroundColor DarkGray
    Write-Host '  services that were already running are left untouched.' -ForegroundColor DarkGray
}
if (-not $backendReady) {
    Write-Host '  Login needs the backend. If it rejects this page with 403,' -ForegroundColor Yellow
    Write-Host ("  add http://localhost:{0} to AUTH_ALLOWED_ORIGINS in backend/.env and restart it." -f $servePort) -ForegroundColor Yellow
    Write-Host '  Details: frontend-standalone/README.md section 3.' -ForegroundColor Yellow
}

# ---------- 6. stop on exit (only what this script started) ----------
function Stop-Started {
    if (-not $script:server -or $script:server.HasExited) { return }
    Stop-Process -Id $script:server.Id -Force -ErrorAction SilentlyContinue
    Write-Host "`nfrontend server stopped." -ForegroundColor DarkGray
}
$script:server = $server

Write-Host '  Press Enter to stop, or just close this window.' -ForegroundColor DarkGray

try {
    while (-not $server.HasExited) {
        if (Test-EnterPressed) { break }
        Start-Sleep -Milliseconds 250
    }
} finally {
    Stop-Started
}
