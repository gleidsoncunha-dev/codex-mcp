$ErrorActionPreference = "Stop"
$Utf8Output = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8Output
$OutputEncoding = $Utf8Output

function Write-Status([string]$Marker, [ConsoleColor]$Color, [string]$Message) {
    $text = "$Marker $Message"
    if (Test-Path Env:NO_COLOR) {
        Write-Host $text
    } else {
        Write-Host $text -ForegroundColor $Color
    }
}

function Info([string]$Message) {
    Write-Status "ℹ" Cyan $Message
}

function Success([string]$Message) {
    Write-Status "✓" Green $Message
}

$installRoot = Join-Path $env:USERPROFILE ".codex-mcp\npm"
$managedBin = Join-Path $env:USERPROFILE ".codex-mcp\bin"

if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
}
if (Test-Path -LiteralPath $managedBin) {
    Remove-Item -LiteralPath $managedBin -Recurse -Force
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
    $installRootNormalized = $installRoot.TrimEnd('\')
    $parts = $userPath -split ";" | Where-Object {
        $_ -and
        $_.Trim() -ne "" -and
        -not [string]::Equals(
            $_.Trim().TrimEnd('\'),
            $installRootNormalized,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    }
    [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
}

Success "codex-mcp application removed."
Write-Host ""
Info "Your configuration, connection password, and Tunnel settings are preserved in: $env:USERPROFILE\.codex-mcp"
Info "These settings can be reused when you reinstall codex-mcp."
