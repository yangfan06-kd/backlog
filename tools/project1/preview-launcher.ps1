$ErrorActionPreference = 'Stop'
$root = 'G:/project1'
$releaseRoot = $PSScriptRoot
$exe = Join-Path $releaseRoot 'win-unpacked/Project1Preview.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  Write-Error 'Project1Preview.exe was not found. Rebuild the preview package.'
  exit 1
}
$dataRoot = Join-Path $root 'output/runtime/project1-preview'
$userData = Join-Path $dataRoot 'user-data'
$logs = Join-Path $dataRoot 'logs'
$crashes = Join-Path $dataRoot 'crashes'
$temp = Join-Path $dataRoot 'tmp'
$exports = Join-Path $dataRoot 'exports'
# Validate before New-Item: an existing junction could otherwise redirect the
# launcher's writes before the Electron runtime has a chance to reject it.
$absoluteRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
foreach ($candidate in @($userData, $logs, $crashes, $temp, $exports)) {
  $cursor = [IO.Path]::GetFullPath($candidate)
  if (-not $cursor.StartsWith($absoluteRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Preview data must stay inside G:/project1'
  }
  while ($true) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Preview data directories must not use junctions or symbolic links'
      }
    }
    if ($cursor.Equals($absoluteRoot, [StringComparison]::OrdinalIgnoreCase)) { break }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
}
foreach ($dir in @($userData, $logs, $crashes, $temp, $exports)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
$env:PROJECT1_PREVIEW_MODE = '1'
$env:PROJECT1_STORAGE_ROOT = $root
$env:PROJECT1_USER_DATA_DIR = $userData
$env:PROJECT1_LOG_DIR = $logs
$env:PROJECT1_CRASH_DIR = $crashes
$env:TEMP = $temp
$env:TMP = $temp
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Normal
