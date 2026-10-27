param([ValidateSet('dev','check','build','start','verify')][string]$Action='dev')
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repository 'factory'
$nodeVersion = (Get-Content -LiteralPath (Join-Path $app '.node-version') -Raw).Trim()
$runtime = if ($env:NVM_HOME) { Join-Path $env:NVM_HOME "v$nodeVersion" } else { Join-Path $env:APPDATA "nvm\v$nodeVersion" }
$node = Join-Path $runtime 'node.exe'
$npm = Join-Path $runtime 'npm.cmd'
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $npm)) {
    throw "Factory needs Node $nodeVersion. Install that version through your Node manager, then rerun npm run $Action."
}
$env:Path = $runtime + ';' + $env:Path
Push-Location $app
try {
    if ($Action -eq 'dev') {
        & $node scripts/setup-local.mjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $npm run dev:local
    } else { & $npm run $Action }
    exit $LASTEXITCODE
} finally { Pop-Location }
