#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-ManageError([string]$Message) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show($Message, 'Manage Codex Subscriptions', 'OK', 'Error')
}

function Test-ControlPort {
    return [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 48123
}

try {
    $stateRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-mux'
    $tokenPath = Join-Path $stateRoot 'control-token'
    if (-not (Test-ControlPort)) {
        & (Join-Path $PSScriptRoot 'Start-CodexSubscriptionRouter.ps1')
    }
    if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
        throw 'The router control token is unavailable. Start the router and try again.'
    }
    $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
    if ($token -notmatch '^[0-9a-fA-F]{64}$') { throw 'The router control token is invalid.' }
    Start-Process -FilePath "http://127.0.0.1:48123/#token=$token" | Out-Null
} catch {
    Show-ManageError $_.Exception.Message
    throw
}
