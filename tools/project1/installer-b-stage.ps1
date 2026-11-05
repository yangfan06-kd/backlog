param(
    [ValidateSet('Preflight', 'Cancel', 'InstallA', 'RunBlocked', 'Upgrade', 'Failure', 'Uninstall', 'Reinstall')]
    [string]$Action = 'Preflight',
    [switch]$Execute,
    [string]$CandidateA,
    [string]$CandidateB,
    [ValidateSet('Uninstalled', 'InstalledA', 'InstalledB')]
    [string]$ExpectedState = 'Uninstalled'
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'G:/project1'
$repoRoot = Join-Path $projectRoot 'repos/project1-desktop'
$caseRoot = Join-Path $projectRoot 'output/runtime/DS-012/case-20261029-a'
$profile = Join-Path $caseRoot 'profile'
$installedApp = Join-Path $projectRoot 'output/installed/project1-preview/app'
$temp = Join-Path $projectRoot '.tmp/DS-012/b-stage'

# A-stage planning only. This script deliberately never performs a real
# install/uninstall. B-stage requires explicit user authorization and a fresh
# main-agent review, neither of which exists in this run.
if ($Execute) {
    throw 'This tool inspects state only; Setup/Uninstall must be run separately after scope approval.'
}

if (-not $CandidateA -or -not $CandidateB) { throw 'Pass the two reviewed candidate directories explicitly.' }
$releaseA = [IO.Path]::GetFullPath($CandidateA)
$releaseB = [IO.Path]::GetFullPath($CandidateB)
foreach ($candidate in @($releaseA, $releaseB)) {
    if (-not $candidate.StartsWith([IO.Path]::GetFullPath((Join-Path $projectRoot 'output/releases/DS-012')) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate outside DS-012 releases' }
}
$manifestA = Get-Content -LiteralPath (Join-Path $releaseA 'build-manifest.json') -Raw | ConvertFrom-Json
$manifestB = Get-Content -LiteralPath (Join-Path $releaseB 'build-manifest.json') -Raw | ConvertFrom-Json
$setupA = Join-Path $releaseA $manifestA.setup
$setupB = Join-Path $releaseB $manifestB.setup
foreach ($item in @(@{dir=$releaseA;manifest=$manifestA}, @{dir=$releaseB;manifest=$manifestB})) {
    $checks = @(@{file=$item.manifest.setup;hash=$item.manifest.setupSha256}, @{file=$item.manifest.executable;hash=$item.manifest.executableSha256}, @{file='win-unpacked/resources/app.asar';hash=$item.manifest.asarSha256})
    foreach ($check in $checks) {
        if ((Get-FileHash -LiteralPath (Join-Path $item.dir $check.file) -Algorithm SHA256).Hash -ne $check.hash) { throw 'Candidate hash mismatch' }
    }
    $policy = Get-Content -LiteralPath (Join-Path $item.dir 'win-unpacked/resources/project1-runtime.json') -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath($policy.profileRoot) -ne [IO.Path]::GetFullPath($profile)) { throw 'Unexpected payload profile' }
}
$uninstaller = Join-Path $installedApp 'Uninstall Project1Preview.exe'

$identity = '290aebf5-3202-5614-9d01-a47534d2699d'
$registry = @()
foreach ($hiveName in @('CurrentUser', 'LocalMachine')) {
    foreach ($viewName in @('Registry32', 'Registry64')) {
        $hive = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
            [Microsoft.Win32.RegistryHive]::$hiveName,
            [Microsoft.Win32.RegistryView]::$viewName)
        try {
            foreach ($subkey in @("Software\$identity", "Software\Microsoft\Windows\CurrentVersion\Uninstall\$identity")) {
                $key = $hive.OpenSubKey($subkey, $false)
                try {
                    $registry += [ordered]@{ hive = $hiveName; view = $viewName; key = $subkey; exists = $null -ne $key; installLocation = $(if ($key) {$key.GetValue('InstallLocation')}); displayVersion = $(if ($key) {$key.GetValue('DisplayVersion')}) }
                } finally { if ($key) { $key.Dispose() } }
            }
        } finally { $hive.Dispose() }
    }
}
$preflight = [ordered]@{
    action = $Action
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    setupA = $setupA
    setupASha256 = (Get-FileHash $setupA -Algorithm SHA256).Hash.ToLower()
    setupB = $setupB
    setupBSha256 = (Get-FileHash $setupB -Algorithm SHA256).Hash.ToLower()
    installedAppExists = Test-Path -LiteralPath $installedApp
    testProfileExists = Test-Path -LiteralPath $profile
    runningPreviewProcesses = @(Get-Process -Name Project1Preview -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path)
    registry = $registry
    tempRoot = $temp
    defaultProfileReferenced = $false
    actualInstallerAllowedByThisTool = $false
}
if (@($registry | Where-Object {$_.hive -eq 'LocalMachine' -and $_.exists}).Count) { throw 'Unexpected machine-wide project registration' }
if ($ExpectedState -eq 'Uninstalled') {
    if ($preflight.installedAppExists -or @($registry | Where-Object {$_.exists}).Count) { throw 'Expected no installed app/registration' }
    if ($preflight.runningPreviewProcesses.Count) { throw 'Preview process is running; do not modify it' }
} else {
    $expected = if ($ExpectedState -eq 'InstalledA') {$manifestA} else {$manifestB}
    $installedExe = Join-Path $installedApp 'Project1Preview.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Expected real uninstall executable missing' }
    if ((Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash -ne $expected.executableSha256) { throw 'Installed exe does not match candidate' }
    if ((Get-FileHash -LiteralPath (Join-Path $installedApp 'resources/app.asar') -Algorithm SHA256).Hash -ne $expected.asarSha256) { throw 'Installed asar does not match candidate' }
    $locationEntries = @($registry | Where-Object {$_.hive -eq 'CurrentUser' -and $_.exists -and $_.installLocation})
    $versionEntries = @($registry | Where-Object {$_.hive -eq 'CurrentUser' -and $_.exists -and $_.displayVersion})
    if (-not $locationEntries.Count -or -not $versionEntries.Count) { throw 'Current-user install/uninstall registration missing' }
    foreach ($entry in $locationEntries) { if ([IO.Path]::GetFullPath($entry.installLocation).TrimEnd('\') -ne [IO.Path]::GetFullPath($installedApp).TrimEnd('\')) { throw 'Registration points elsewhere' } }
    foreach ($entry in $versionEntries) { if ($entry.displayVersion -ne $expected.version) { throw 'Registered version mismatch' } }
}
$preflight | ConvertTo-Json -Depth 8

$commands = [ordered]@{
    Cancel = "Start-Process '$setupA' -Wait; cancel the installer UI, then verify no app/registration"
    InstallA = "Start-Process '$setupA' -Wait; normal current-user install; record registry/app/profile"
    RunBlocked = "Start-Process '$installedApp/Project1Preview.exe'; create draft, launch Setup, assert prompt, cancel; save+close then retry"
    Upgrade = "Start-Process '$setupB' -Wait; upgrade over A; record old uninstaller and new version"
    Failure = "Start-Process '$setupB' -Wait; only with a prepared test-tree occupied-file rollback fixture; preserve evidence"
    Uninstall = "Start-Process '$uninstaller' -Wait; normal uninstall; assert profile/backups remain"
    Reinstall = "Start-Process '$setupB' -Wait; reinstall, offline open profile, add data, normal close, uninstall"
}
$assertions = @(
    'Before/after each action read both registry views; no HKLM, shortcut, startup, protocol or file association.',
    'The installed program must be the candidate exe/asar hashes, and userData must be under the case profile.',
    'App launch must clear all PROJECT1_* path variables and use the payload test policy; TEMP/TMP are project-local.',
    'No taskkill or forced close; a running app must show retry/cancel and preserve draft.',
    'Uninstall must remove only the test program tree and two HKCU keys; profile and backups remain.',
    'No evidence line is treated as a real install/upgrade/uninstall result without its own before/after record.'
)
$out = [ordered]@{
    preflight = $preflight
    preparedCommands = $commands
    assertions = $assertions
    expectedState = $ExpectedState
    stateAssertionsPassed = $true
    executeRefusedReason = 'Read-only state inspector; actual installation requires separate scope approval'
}
$outPath = Join-Path $caseRoot ('b-stage-state-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '.json')
$out | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outPath -Encoding UTF8
Write-Output "B-stage plan: $outPath"
