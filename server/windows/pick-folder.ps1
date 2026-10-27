param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'FolderPicker.cs')
  $chosen = [BarracksFolderPicker]::Choose($env:BARRACKS_PICKER_INITIAL_FOLDER, $ValidateOnly.IsPresent)
  @{ path = $chosen } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
