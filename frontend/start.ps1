<# CampusAgent unified Vue frontend launcher. All paths are relative to this file. #>
[CmdletBinding()]
param(
    [int]$Port = 0,
    [switch]$FrontendOnly,
    [switch]$NoBrowser,
    [switch]$SkipBackend,
    [switch]$SkipAi
)
$ErrorActionPreference = 'Stop'
$taskFrontend = $PSScriptRoot
$taskRepository = Split-Path -Parent $taskFrontend
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
$taskLogs = Join-Path $taskFrontend 'logs'
New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
function Test-Service([string]$Uri) {
    try { return (Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
    catch { return $false }
}

Push-Location -LiteralPath $taskFrontend
try {
    if (-not (Test-Path -LiteralPath (Join-Path $taskFrontend 'node_modules/vite/bin/vite.js'))) {
        & $taskNpm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    $taskCandidates = if ($Port -gt 0) { @($Port) } else { @(5173, 5500, 5501, 4173) }
    $taskSelected = $null
    foreach ($taskCandidate in $taskCandidates) {
        if (-not (Get-NetTCPConnection -LocalPort $taskCandidate -State Listen -ErrorAction SilentlyContinue)) {
            $taskSelected = $taskCandidate
            break
        }
    }
    if (-not $taskSelected) { throw 'No available frontend port. Use -Port to select another port.' }

    if (-not $FrontendOnly) {
        if (-not $SkipBackend -and -not (Test-Service 'http://127.0.0.1:8080/api/v1/health')) {
            $taskBackend = Join-Path $taskRepository 'scripts/start-backend.ps1'
            Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $taskBackend + '"')) `
                -WorkingDirectory $taskRepository -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $taskLogs 'backend.log') -RedirectStandardError (Join-Path $taskLogs 'backend-error.log') | Out-Null
        }
        if (-not $SkipAi -and -not (Test-Service 'http://127.0.0.1:8000/internal/v1/health')) {
            $taskAiDirectory = Join-Path $taskRepository 'ai-service'
            $taskAiPython = Join-Path $taskAiDirectory '.venv/Scripts/python.exe'
            if (-not (Test-Path -LiteralPath $taskAiPython)) { $taskAiPython = (Get-Command python -ErrorAction Stop).Source }
            Start-Process -FilePath $taskAiPython -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') `
                -WorkingDirectory $taskAiDirectory -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $taskLogs 'ai.log') -RedirectStandardError (Join-Path $taskLogs 'ai-error.log') | Out-Null
        }
    }

    $taskVite = Join-Path $taskFrontend 'node_modules/vite/bin/vite.js'
    $taskServer = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskVite + '"'), '--host', '127.0.0.1', '--port', "$taskSelected", '--strictPort') `
        -WorkingDirectory $taskFrontend -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskLogs 'frontend.log') -RedirectStandardError (Join-Path $taskLogs 'frontend-error.log')
    $taskUrl = "http://127.0.0.1:$taskSelected/"
    try {
        $taskReady = $false
        for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
            if (Test-Service $taskUrl) { $taskReady = $true; break }
            if ($taskServer.HasExited) { break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $taskReady) { throw "Frontend could not start. Inspect $taskLogs." }
        Write-Host "CampusAgent Vue frontend: $taskUrl"
        Write-Host "Logs: $taskLogs"
        Write-Host 'Press Enter to stop the frontend. Backend and AI services continue running.'
        if (-not $NoBrowser) { Start-Process $taskUrl | Out-Null }
        [void](Read-Host)
    } finally {
        if (-not $taskServer.HasExited) { Stop-Process -Id $taskServer.Id -Force -ErrorAction SilentlyContinue }
    }
} finally { Pop-Location }
