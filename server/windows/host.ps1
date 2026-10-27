param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'OwnedJob.cs')
$job = [Barracks.Runtime.OwnedJob]::new($config.jobName)
function Write-Receipt($receipt) {
    $temporary = $config.receipt + '.tmp'
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $config.receipt -Force
}
try {
    $owner = Get-Process -Id $config.ownerPid -ErrorAction Stop
    if ($owner.StartTime.ToUniversalTime().Ticks.ToString() -ne $config.ownerStartTicks) { throw 'Owner identity changed before launch.' }
    $rootId = $job.Start($config.node, $config.commandLine, $config.cwd)
    $rootProcess = Get-Process -Id $rootId -ErrorAction Stop
    $receipt = @{ jobName=$config.jobName; hostPid=$PID; hostStartUtc=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'); rootPid=$rootId; rootStartUtc=$rootProcess.StartTime.ToUniversalTime().ToString('o'); status='running'; remainingMembers=@(); memberIdentity=@() }
    $deadline = $null
    if ($null -ne $config.maxRuntimeMs) { $deadline = [DateTime]::UtcNow.AddMilliseconds($config.maxRuntimeMs) }
    while ($true) {
        $receipt.memberIdentity = @($job.Members() | ForEach-Object {
            $member = Get-Process -Id $_ -ErrorAction SilentlyContinue
            if ($member) {
                $started = $null
                try { if ($null -ne $member.StartTime) { $started=$member.StartTime.ToUniversalTime().ToString('o') } } catch {}
                @{ pid=$member.Id; startUtc=$started; name=$member.ProcessName }
            }
        })
        Write-Receipt $receipt
        $owner.Refresh()
        if ($owner.HasExited) { $receipt.status='owner-lost'; break }
        if (Test-Path -LiteralPath $config.cancelFile) { $receipt.status='cancelled'; break }
        if ($job.RootExited) { $receipt.status='exited'; $receipt.exitCode=$job.ExitCode; break }
        if ($null -ne $deadline -and [DateTime]::UtcNow -gt $deadline) { $receipt.status='timed-out'; break }
        Start-Sleep -Milliseconds 100
    }
    $job.Cancel()
    $drainDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while ($job.Members().Length -gt 0 -and [DateTime]::UtcNow -lt $drainDeadline) { Start-Sleep -Milliseconds 25 }
    $receipt.remainingMembers = @($job.Members())
    $receipt.drained = $receipt.remainingMembers.Count -eq 0
    $receipt.endedAt = [DateTime]::UtcNow.ToString('o')
    Write-Receipt $receipt
    if (-not $receipt.drained) { throw 'Owned process job did not drain.' }
} catch {
    @{status='host-error';error=$_.Exception.Message;endedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $config.errorFile -Encoding UTF8
    exit 1
} finally { $job.Dispose() }
