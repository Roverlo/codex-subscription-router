#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-LaunchError([string]$Message) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show($Message, 'Codex Subscription Router', 'OK', 'Error')
}

function Test-ControlPort {
    return [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 48123
}

try {
    $installRoot = $PSScriptRoot
    $app = Join-Path $installRoot 'app\ChatGPT.exe'
    $mux = Join-Path $installRoot 'codex-mux.exe'
    $realCodex = Join-Path $installRoot 'app\resources\codex.exe'
    foreach ($path in @($app, $mux, $realCodex)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Installation is incomplete: $path" }
    }

    $stateRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-mux'
    $profile = Join-Path $stateRoot 'windows-profile'
    if (Test-ControlPort) {
        $listener = Get-NetTCPConnection -LocalPort 48123 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if (-not $owner -or -not $owner.ExecutablePath -or -not $owner.ExecutablePath.Equals($mux, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'TCP port 48123 is already used by another program.'
        }
    }

    $env:CODEX_CLI_PATH = $mux
    $env:CODEX_MUX_REAL_CODEX = $realCodex
    $env:CODEX_MUX_HOME = $stateRoot
    $env:CODEX_MUX_CONTROL_PORT = '48123'
    $env:CODEX_ELECTRON_USER_DATA_PATH = $profile
    Start-Process -FilePath $app -ArgumentList ('--user-data-dir="{0}"' -f $profile) | Out-Null

    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if (Test-ControlPort) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'The router did not become ready within 30 seconds.'
} catch {
    Show-LaunchError $_.Exception.Message
    throw
}
