param(
    [ValidateSet('Check', 'Install', 'Start', 'Uninstall')]
    [string]$Mode = 'Check',
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'G:/project1'
$packageDir = $PSScriptRoot
$manifestPath = Join-Path $packageDir 'build-manifest.json'
$installedApp = Join-Path $projectRoot 'output/installed/project1-preview/app'
$installedExe = Join-Path $installedApp 'Project1Preview.exe'
$installedUninstaller = Join-Path $installedApp 'Uninstall Project1Preview.exe'
$tempRoot = $null
$defaultProfile = Join-Path $projectRoot 'output/runtime/project1-preview'
$validationProfiles = @{
    'DS-012' = (Join-Path $projectRoot 'output/runtime/DS-012/DS-013-validation/profile')
    'DS-014' = (Join-Path $projectRoot 'output/runtime/DS-014/validation/profile')
    'DS-017' = (Join-Path $projectRoot 'output/runtime/DS-017/validation/profile')
    'DS-018' = (Join-Path $projectRoot 'output/runtime/DS-018/validation/profile')
    'DS-019' = (Join-Path $projectRoot 'output/runtime/DS-019/validation/profile')
}

function Fail([string]$message) {
    Write-Host $message -ForegroundColor Red
    exit 1
}

function Assert-NoReparseAncestors([string]$target) {
    $resolved = [IO.Path]::GetFullPath($target).TrimEnd('\')
    $cursor = $resolved
    while ($true) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "路径包含目录链接/重解析点：$cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    $rootFull = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "路径不在 G:/project1：$resolved"
    }
}

function Read-Manifest {
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        Fail "缺少安装包清单：$manifestPath"
    }
    return Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-Sha256([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { Fail "文件不存在：$file" }
    $stream = [IO.File]::OpenRead($file)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Get-Policy([string]$jsonFile) {
    Assert-NoReparseAncestors $jsonFile
    if (-not (Test-Path -LiteralPath $jsonFile)) { Fail "缺少运行策略：$jsonFile" }
    return Get-Content -LiteralPath $jsonFile -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Assert-DailyPolicy($policy) {
    if ($policy.formatVersion -ne 1 -or
        [IO.Path]::GetFullPath($policy.storageRoot) -ne [IO.Path]::GetFullPath($projectRoot) -or
        [IO.Path]::GetFullPath($policy.profileRoot) -ne [IO.Path]::GetFullPath($defaultProfile)) {
        Fail '日用包运行策略必须指向默认试用 profile；已停止。'
    }
}

function Assert-ValidationPolicy($policy, [string]$task) {
    if (-not $validationProfiles.ContainsKey($task)) {
        Fail "未知的验证任务：$task；已停止。"
    }
    $expected = $validationProfiles[$task]
    if ($policy.formatVersion -ne 1 -or
        [IO.Path]::GetFullPath($policy.storageRoot) -ne [IO.Path]::GetFullPath($projectRoot) -or
        [IO.Path]::GetFullPath($policy.profileRoot) -ne [IO.Path]::GetFullPath($expected)) {
        Fail "验证包运行策略必须指向 $task 的固定验证 profile；已停止。"
    }
}

function Clear-InheritedProjectEnvironment {
    Get-ChildItem Env: | Where-Object { $_.Name -like 'PROJECT1_*' } | ForEach-Object {
        Remove-Item -LiteralPath ("Env:" + $_.Name) -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue
}

function Set-ProjectTemp {
    Assert-NoReparseAncestors $tempRoot
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    $env:TEMP = $tempRoot
    $env:TMP = $tempRoot
    $env:TMPDIR = $tempRoot
}

function Assert-Hash([string]$file, [string]$expected) {
    Assert-NoReparseAncestors $file
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-Sha256 $file) -ne $expected) {
        Fail "文件校验不匹配，已停止：$file"
    }
}

function Assert-InstalledIdentity {
    Assert-Hash $installedExe $manifest.executableSha256
    Assert-Hash (Join-Path $installedApp 'resources/app.asar') $manifest.asarSha256
    $policyPath = Join-Path $installedApp 'resources/project1-runtime.json'
    Assert-Hash $policyPath $manifest.runtimePolicySha256
    Assert-DailyPolicy (Get-Policy $policyPath)
    Assert-Hash $installedUninstaller $manifest.uninstallerSha256
}

Assert-NoReparseAncestors $packageDir
Assert-NoReparseAncestors $manifestPath
$manifest = Read-Manifest
if ($manifest.intendedUse -notin @('daily', 'validation') -or
    $manifest.name -ne 'project1-preview' -or $manifest.appId -ne 'local.project1.preview') {
    Fail '安装包用途或身份不正确，已停止。'
}
$task = if ($manifest.task) { [string]$manifest.task } else { 'DS-012' }
if ($task -notin @('DS-012', 'DS-014', 'DS-017', 'DS-018', 'DS-019')) { Fail "未知的安装任务：$task；已停止。" }
$tempRoot = if ($task -in @('DS-017', 'DS-018', 'DS-019')) {
    Join-Path $projectRoot ".tmp/$task/entry"
} else {
    Join-Path $projectRoot '.tmp/DS-013/entry'
}
$isValidation = $manifest.intendedUse -eq 'validation'
$packagePolicyPath = Join-Path $packageDir 'win-unpacked/resources/project1-runtime.json'
$packagePolicy = Get-Policy $packagePolicyPath
Assert-Hash $packagePolicyPath $manifest.runtimePolicySha256
if ($isValidation) { Assert-ValidationPolicy $packagePolicy $task } else { Assert-DailyPolicy $packagePolicy }
Assert-Hash (Join-Path $packageDir 'win-unpacked/resources/app.asar') $manifest.asarSha256

$setup = Join-Path $packageDir $manifest.setup
Assert-NoReparseAncestors $setup
$setupHash = Get-Sha256 $setup
if ($setupHash -ne $manifest.setupSha256) {
    Fail '安装程序哈希与清单不匹配；已停止，不会猜其他文件。'
}
$packageExe = Join-Path $packageDir 'win-unpacked/Project1Preview.exe'
Assert-NoReparseAncestors $packageExe
$packageExeHash = Get-Sha256 $packageExe
if ($packageExeHash -ne $manifest.executableSha256) {
    Fail '包内程序哈希与清单不匹配；已停止。'
}

$expectedWritableProfile = if ($isValidation) { $validationProfiles[$task] } else { $defaultProfile }
Write-Host ("模式：{0}" -f $Mode)
Write-Host ("用途：{0}" -f $(if ($isValidation) { '验证用（测试 profile）' } else { '日用内测（默认 profile）' }))
Write-Host ("预期数据目录：{0}" -f $expectedWritableProfile)
Write-Host ("安装程序：{0}" -f $setup)
Write-Host ("固定程序：{0}" -f $installedExe)

if ($Mode -eq 'Check' -or $CheckOnly) {
    $installedExists = Test-Path -LiteralPath $installedExe
    Write-Host ("安装程序哈希：{0}" -f $setupHash)
    Write-Host ("包内程序哈希：{0}" -f $packageExeHash)
    Write-Host ("已安装程序存在：{0}" -f $installedExists)
    if ($isValidation) {
        Write-Host '验证包只用于测试 profile；不要用它读取/覆盖默认试用数据。'
        Write-Host ("验证启动目标：{0}" -f $packageExe)
    } else {
        Write-Host ("启动目标：{0}" -f $installedExe)
        Write-Host ("卸载目标：{0}" -f $installedUninstaller)
    }
    exit 0
}

if ($Mode -eq 'Install') {
    if ($isValidation) { Fail '验证包不允许安装；请使用验证启动入口。' }
    Clear-InheritedProjectEnvironment
    Set-ProjectTemp
    Write-Host '正在启动安装程序；请在窗口中确认当前用户安装。'
    $result = Start-Process -FilePath $setup -WorkingDirectory $packageDir -WindowStyle Normal -Wait -PassThru
    if ($result.ExitCode -eq 0) { Assert-InstalledIdentity; Write-Host '安装完成。' } else { Write-Host ("安装已取消或未完成，退出码：{0}" -f $result.ExitCode) -ForegroundColor Yellow }
    exit $result.ExitCode
}

if ($Mode -eq 'Start') {
    if ($isValidation) {
        Clear-InheritedProjectEnvironment
        Set-ProjectTemp
        Write-Host '验证用：从包内 win-unpacked 启动，数据只写入验证 profile。'
        Start-Process -FilePath $packageExe -WorkingDirectory (Split-Path -Parent $packageExe) -WindowStyle Normal | Out-Null
        exit 0
    }
    Assert-NoReparseAncestors $installedApp
    if (-not (Test-Path -LiteralPath $installedExe)) { Fail '尚未安装。请先运行“安装.cmd”。' }
    Assert-InstalledIdentity
    Clear-InheritedProjectEnvironment
    Set-ProjectTemp
    Write-Host '正在打开项目进展（内测版）。'
    Start-Process -FilePath $installedExe -WorkingDirectory $installedApp -WindowStyle Normal | Out-Null
    exit 0
}

if ($Mode -eq 'Uninstall') {
    if ($isValidation) { Fail '验证包不提供卸载入口。' }
    Assert-NoReparseAncestors $installedApp
    if (-not (Test-Path -LiteralPath $installedUninstaller)) { Fail '尚未找到固定卸载程序；程序可能未安装。' }
    Assert-InstalledIdentity
    Clear-InheritedProjectEnvironment
    Set-ProjectTemp
    Write-Host '正在打开卸载程序；不会删除数据目录或备份。'
    $result = Start-Process -FilePath $installedUninstaller -WorkingDirectory $packageDir -WindowStyle Normal -Wait -PassThru
    Write-Host '卸载结果以卸载窗口的完成页为准；数据和备份保留。'
    exit $result.ExitCode
}
