param(
    [ValidateSet('Hash', 'Seed')][string]$Action = 'Hash',
    [Parameter(ValueFromPipeline = $true)][string]$Password
)
$ErrorActionPreference = 'Stop'
$backendDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../backend'))
$jar = Join-Path $backendDirectory 'campus-app/target/campus-app-0.1.0-SNAPSHOT.jar'
if (!(Test-Path -LiteralPath $jar)) { throw 'Build first: cd backend; mvn package' }
$toolClass = 'com.campusagent.identity.tools.PasswordHashTool'
$savedVariables = @{}
try {
    if ($Action -eq 'Seed') {
        $envFile = Join-Path $backendDirectory '.env'
        if (Test-Path -LiteralPath $envFile) {
            foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
                if ($line -match '^\s*(DB_URL|DB_USERNAME|DB_PASSWORD)\s*=(.*)$') {
                    $name = $Matches[1]; $value = $Matches[2].Trim()
                    $savedVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
                    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
                    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
                }
            }
        }
        $savedVariables['CAMPUS_ALLOW_LOCAL_SEED'] = $env:CAMPUS_ALLOW_LOCAL_SEED
        $env:CAMPUS_ALLOW_LOCAL_SEED = 'true'
        $toolClass = 'com.campusagent.identity.tools.LocalAccountSeed'
    }
    if ($Action -eq 'Hash' -and $PSBoundParameters.ContainsKey('Password')) {
        $Password | & java "-Dloader.main=$toolClass" -cp $jar org.springframework.boot.loader.launch.PropertiesLauncher
        $Password = $null
    } else {
        & java "-Dloader.main=$toolClass" -cp $jar org.springframework.boot.loader.launch.PropertiesLauncher
    }
    if ($LASTEXITCODE -ne 0) { throw 'Account helper failed. For Seed, start the backend once to apply V5 first.' }
} finally {
    foreach ($name in $savedVariables.Keys) { [Environment]::SetEnvironmentVariable($name, $savedVariables[$name], 'Process') }
}
