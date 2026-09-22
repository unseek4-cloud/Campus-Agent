param([switch]$Build)
$ErrorActionPreference = 'Stop'
$backendDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../backend'))
$environmentFile = Join-Path $backendDirectory '.env'
if (Test-Path -LiteralPath $environmentFile) {
    foreach ($line in Get-Content -LiteralPath $environmentFile -Encoding UTF8) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $variableName = $Matches[1]
            $variableValue = $Matches[2].Trim()
            if ($variableValue.Length -ge 2 -and
                (($variableValue.StartsWith('"') -and $variableValue.EndsWith('"')) -or
                 ($variableValue.StartsWith("'") -and $variableValue.EndsWith("'")))) {
                $variableValue = $variableValue.Substring(1, $variableValue.Length - 2)
            }
            # Environment values are data; never evaluate shell expressions from .env.
            [Environment]::SetEnvironmentVariable($variableName, $variableValue, 'Process')
        }
    }
}
Push-Location $backendDirectory
try {
    $applicationJar = 'campus-app/target/campus-app-0.1.0-SNAPSHOT.jar'
    if ($Build -or !(Test-Path -LiteralPath $applicationJar)) {
        & mvn package
        if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    }
    & java -jar $applicationJar
    if ($LASTEXITCODE -ne 0) { throw 'Backend process failed. Check application logs.' }
} finally {
    Pop-Location
}
