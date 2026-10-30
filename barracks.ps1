$ErrorActionPreference = 'Stop'
$cliArguments = @($args)
if ($cliArguments.Count -gt 0 -and $cliArguments[0] -in @('run', 'resume', 'signal', 'show', 'validate') -and '--root' -notin $cliArguments) {
    $cliArguments += @('--root', $PSScriptRoot)
}
& dotnet run --project (Join-Path $PSScriptRoot 'src/Barracks/Barracks.csproj') -- @cliArguments
exit $LASTEXITCODE
