param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'OwnedJob.cs')
$job = [Barracks.Qualification.OwnedJob]::new()
function Write-Receipt($receipt) {
    $temporary = $config.receipt + '.tmp'
    $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $config.receipt -Force
}
try {
    $rootId = $job.Start($config.executable, $config.commandLine, $config.cwd)
    $rootProcess = Get-Process -Id $rootId -ErrorAction Stop
    $receipt = @{ jobId=$config.jobId; hostPid=$PID; hostStartUtc=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'); rootPid=$rootId; rootStartUtc=$rootProcess.StartTime.ToUniversalTime().ToString('o'); status='running'; members=@($job.Members()); liveDispatch=$false }
    Write-Receipt $receipt
    $deadline = [DateTime]::UtcNow.AddMilliseconds($config.maxRuntimeMs)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $config.cancelFile)) {
        if ($job.Members().Length -eq 0) { break }
        Start-Sleep -Milliseconds 50
    }
    $receipt.membersBeforeCancel = @($job.Members())
    $receipt.memberIdentity = @($receipt.membersBeforeCancel | ForEach-Object {
        $memberProcess = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($memberProcess) { @{ pid=$memberProcess.Id; name=$memberProcess.ProcessName; startUtc=$memberProcess.StartTime.ToUniversalTime().ToString('o') } }
    })
    $job.Cancel()
    $drainDeadline = [DateTime]::UtcNow.AddSeconds(5)
    while ($job.Members().Length -gt 0 -and [DateTime]::UtcNow -lt $drainDeadline) { Start-Sleep -Milliseconds 25 }
    $receipt.remainingMembers = @($job.Members())
    if ($receipt.remainingMembers.Count -ne 0) { throw 'Owned job did not drain.' }
    $receipt.status = 'cancelled'
    Write-Receipt $receipt
} finally { $job.Dispose() }
