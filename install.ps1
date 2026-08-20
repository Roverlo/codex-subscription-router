#Requires -Version 5.1

[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupportedPackageVersion = '26.814.5517.0'
$SupportedAsarSha256 = 'A872EAD5CF8F651185FCBC972247CE0D7884FDDEDD1F0118A044F0801E33A82D'
$SupportedCodexSha256 = '539D351A0F87D4186673A3BD65A480B2E87EBEB7324045019A2D23729770C092'
$ProjectRoot = $PSScriptRoot
$UserHome = [Environment]::GetFolderPath('UserProfile')
$StateRoot = Join-Path $UserHome '.codex-mux'
$Destination = Join-Path $env:LOCALAPPDATA 'Programs\Codex Subscription Router'

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message"
}

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing prerequisite: $Name"
    }
}

function Get-OfficialApp {
    $package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $package) {
        throw 'Install the official Codex app from Microsoft Store first.'
    }
    $appRoot = Join-Path $package.InstallLocation 'app'
    $asar = Join-Path $appRoot 'resources\app.asar'
    $codex = Join-Path $appRoot 'resources\codex.exe'
    $desktop = Join-Path $appRoot 'ChatGPT.exe'
    foreach ($path in @($asar, $codex, $desktop)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Official Codex package is incomplete: $path"
        }
    }
    if ($package.Version.ToString() -ne $SupportedPackageVersion) {
        throw "Unsupported official Codex package $($package.Version); expected $SupportedPackageVersion. Refusing an unverified copy."
    }
    $asarHash = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash
    $codexHash = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $codex -Algorithm SHA256).Hash
    if ($asarHash -ne $SupportedAsarSha256 -or $codexHash -ne $SupportedCodexSha256) {
        throw 'Official Codex files do not match the reviewed Windows build. Refusing an unverified copy.'
    }
    foreach ($path in @($desktop, $codex)) {
        if ((Get-AuthenticodeSignature -LiteralPath $path).Status -ne 'Valid') {
            throw "Official OpenAI signature is not valid: $path"
        }
    }
    return [pscustomobject]@{
        Package = $package
        AppRoot = $appRoot
        Asar = $asar
        AsarHash = $asarHash
        CodexHash = $codexHash
    }
}

function Assert-GoVersion {
    Assert-Command 'go.exe'
    $version = (& go env GOVERSION).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^go(?<major>\d+)\.(?<minor>\d+)') {
        throw "Could not read Go version: $version"
    }
    if ([int]$Matches.major -lt 1 -or ([int]$Matches.major -eq 1 -and [int]$Matches.minor -lt 26)) {
        throw "Go 1.26 or newer is required; found $version."
    }
    return $version
}

function Assert-NodeDependencies {
    Assert-Command 'node.exe'
    $version = (& node.exe -p 'process.versions.node').Trim()
    if ($LASTEXITCODE -ne 0 -or [version]$version -lt [version]'22.12.0') {
        throw "Node.js 22.12 or newer is required; found $version."
    }
    $projectPackage = Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
    $expected = $projectPackage.devDependencies.'@electron/asar'
    $installedManifest = Join-Path $ProjectRoot 'node_modules\@electron\asar\package.json'
    if (-not (Test-Path -LiteralPath $installedManifest -PathType Leaf)) {
        throw 'Missing locked build dependency. Run npm ci --ignore-scripts, then retry.'
    }
    $actual = (Get-Content -LiteralPath $installedManifest -Raw | ConvertFrom-Json).version
    if ($actual -ne $expected) {
        throw "Installed @electron/asar is $actual; expected $expected. Run npm ci --ignore-scripts."
    }
    return $version
}

function Set-PrivateStateAcl([string]$Path) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /reset /Q | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not reset access to $Path"
    }
    & icacls.exe $Path /inheritance:r /grant:r "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' /Q | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restrict access to $Path"
    }
    if (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1) {
        & icacls.exe (Join-Path $Path '*') /reset /T /C /Q | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not repair inherited access below $Path"
        }
    }
}

function Get-OrCreateControlToken([string]$Root) {
    $path = Join-Path $Root 'control-token'
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $token = (Get-Content -LiteralPath $path -Raw).Trim()
        if ($token -notmatch '^[0-9a-fA-F]{64}$') {
            throw 'The existing control token is invalid; refusing to replace it automatically.'
        }
        return $token
    }
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    Set-Content -LiteralPath $path -Value $token -Encoding Ascii -NoNewline
    return $token
}

function Stop-InstalledProcesses([string]$Root) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $targets = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    }
    foreach ($process in $targets) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $remaining = Get-CimInstance Win32_Process | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
        }
        if (-not $remaining) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Could not stop the existing router installation under $Root"
}

function Copy-OfficialApp([string]$Source, [string]$Target) {
    New-Item -ItemType Directory -Path $Target | Out-Null
    $nativePreferenceExists = Test-Path variable:PSNativeCommandUseErrorActionPreference
    if ($nativePreferenceExists) {
        $savedNativePreference = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
    }
    try {
        & robocopy.exe $Source $Target /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP
        $copyExitCode = $LASTEXITCODE
    } finally {
        if ($nativePreferenceExists) { $PSNativeCommandUseErrorActionPreference = $savedNativePreference }
    }
    if ($copyExitCode -gt 7) {
        throw "Copying the official Codex app failed with robocopy exit code $copyExitCode."
    }
}

function New-Shortcut([string]$Path, [string]$Script, [string]$Icon) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Script
    $shortcut.WorkingDirectory = Split-Path -Parent $Script
    $shortcut.IconLocation = "$Icon,0"
    $shortcut.Save()
}

if ($env:OS -ne 'Windows_NT') {
    throw 'This installer supports Windows only. Use install.sh on macOS.'
}
foreach ($file in @('go.mod', 'ui\account-menu.js', 'scripts\patch_windows_asar.mjs', 'windows\Start-CodexSubscriptionRouter.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $file) -PathType Leaf)) {
        throw "Run install.ps1 from a complete Codex Subscription Router source checkout; missing $file"
    }
}
Assert-Command 'robocopy.exe'
Assert-Command 'icacls.exe'

Write-Step 'Checking prerequisites and the official Windows build'
$goVersion = Assert-GoVersion
$nodeVersion = Assert-NodeDependencies
$official = Get-OfficialApp
Write-Host "Official package: $($official.Package.PackageFullName)"
Write-Host "Go toolchain: $goVersion"
Write-Host "Node.js: $nodeVersion"
& node.exe (Join-Path $ProjectRoot 'scripts\patch_windows_asar.mjs') --asar $official.Asar --check
if ($LASTEXITCODE -ne 0) { throw 'Windows profile-menu compatibility check failed.' }
if ($CheckOnly) {
    Write-Host "Compatibility check passed. Destination: $Destination"
    return
}

Write-Step 'Building codex-mux'
$stage = Join-Path ([IO.Path]::GetTempPath()) ("codex-router-install-" + [guid]::NewGuid().ToString('N'))
$activated = $false
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    Push-Location $ProjectRoot
    try {
        & go build -trimpath -o (Join-Path $stage 'codex-mux.exe') .\cmd\codex-mux
        if ($LASTEXITCODE -ne 0) { throw 'go build failed.' }
    } finally {
        Pop-Location
    }

    Write-Step 'Copying the verified official app'
    Copy-OfficialApp $official.AppRoot (Join-Path $stage 'app')
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'windows\Start-CodexSubscriptionRouter.ps1') -Destination $stage

    Write-Step 'Integrating subscriptions into the copied profile menu'
    Set-PrivateStateAcl $StateRoot
    $controlToken = Get-OrCreateControlToken $StateRoot
    $savedPatchToken = [Environment]::GetEnvironmentVariable('CODEX_MUX_PATCH_TOKEN', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('CODEX_MUX_PATCH_TOKEN', $controlToken, 'Process')
        & node.exe (Join-Path $ProjectRoot 'scripts\patch_windows_asar.mjs') --asar (Join-Path $stage 'app\resources\app.asar')
        if ($LASTEXITCODE -ne 0) { throw 'Windows renderer patch failed.' }
    } finally {
        [Environment]::SetEnvironmentVariable('CODEX_MUX_PATCH_TOKEN', $savedPatchToken, 'Process')
    }
    $patchedAsarHash = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath (Join-Path $stage 'app\resources\app.asar') -Algorithm SHA256).Hash
    [ordered]@{
        routerVersion = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'VERSION') -Raw).Trim()
        installedAt = (Get-Date).ToUniversalTime().ToString('o')
        officialPackage = $official.Package.PackageFullName
        officialAppAsarSha256 = $official.AsarHash
        patchedAppAsarSha256 = $patchedAsarHash
        codexSha256 = $official.CodexHash
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'windows-build.json') -Encoding UTF8

    Write-Step 'Activating the independent installation'
    Stop-InstalledProcesses $Destination
    $backup = $null
    if (Test-Path -LiteralPath $Destination) {
        $backupRoot = Join-Path $StateRoot 'backups'
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        $backup = Join-Path $backupRoot ("windows-app-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -LiteralPath $Destination -Destination $backup
    }
    try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        Move-Item -LiteralPath $stage -Destination $Destination
        $activated = $true
    } catch {
        if ($backup -and -not (Test-Path -LiteralPath $Destination) -and (Test-Path -LiteralPath $backup)) {
            Move-Item -LiteralPath $backup -Destination $Destination
        }
        throw
    }

    Write-Step 'Creating shortcuts'
    $startScript = Join-Path $Destination 'Start-CodexSubscriptionRouter.ps1'
    $icon = Join-Path $Destination 'app\ChatGPT.exe'
    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Codex Subscription Router'
    New-Shortcut (Join-Path $startMenu 'Codex Subscription Router.lnk') $startScript $icon
    $staleManagerShortcut = Join-Path $startMenu 'Manage Codex Subscriptions.lnk'
    if (Test-Path -LiteralPath $staleManagerShortcut) {
        Remove-Item -LiteralPath $staleManagerShortcut -Force
    }
    New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Subscription Router.lnk') $startScript $icon

    if (-not $NoLaunch) {
        Write-Step 'Launching Codex Subscription Router'
        & $startScript
    }
    Write-Host "`nInstalled successfully: $Destination"
    if ($backup) { Write-Host "Previous installation backup: $backup" }
} finally {
    if (-not $activated -and (Test-Path -LiteralPath $stage)) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
