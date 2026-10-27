# Run from any directory. Sends immediately, then every 20 minutes until Ctrl+C.
# Uses Codex's existing-session queue; leaves the Lead's model and permissions intact.
[CmdletBinding()]
param(
    [string]$ThreadId = '01a15694-01a0-7ef2-b598-22ced6a404b0',
    [ValidateRange(1, 10080)]
    [int]$IntervalMinutes = 20,
    [string]$Message = 'check in',
    [string]$CodexPath,
    [switch]$Once,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Message)) { throw 'Message must contain text.' }
if ([string]::IsNullOrWhiteSpace($ThreadId)) { throw 'ThreadId must contain a session ID or exact name.' }

if (-not $CodexPath) {
    $command = Get-Command codex.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        $command = Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($command) {
        $CodexPath = $command.Source
    } elseif (Test-Path -LiteralPath 'C:\Program Files\nodejs\codex.cmd') {
        $CodexPath = 'C:\Program Files\nodejs\codex.cmd'
    } else {
        throw 'Codex CLI was not found. Supply -CodexPath with the full path to codex.cmd or codex.exe.'
    }
}

# One loop per thread in this Windows login session.
$mutexName = 'Local\SaltwakeCheckIn-' + ($ThreadId -replace '[^a-zA-Z0-9-]', '_')
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw "A check-in loop for $ThreadId is already running." }

    Write-Host "Saltwake Lead: $ThreadId"
    Write-Host "Interval: $IntervalMinutes minutes. Press Ctrl+C to stop."
    do {
        $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        if ($DryRun) {
            Write-Host "[$stamp] Dry run: would queue '$Message' using $CodexPath"
        } else {
            & $CodexPath queue --thread $ThreadId --message $Message
            if ($LASTEXITCODE -ne 0) {
                throw "Codex queue failed (exit $LASTEXITCODE). Loop stopped; check the app/CLI connection before restarting."
            }
            Write-Host "[$stamp] Check-in queued."
        }
        if ($Once) { break }
        # Short sleeps keep Ctrl+C responsive. No catch-up burst after sleep/resume.
        $next = [DateTime]::UtcNow.AddMinutes($IntervalMinutes)
        while ([DateTime]::UtcNow -lt $next) { Start-Sleep -Seconds 1 }
    } while ($true)
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
