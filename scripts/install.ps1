$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Utf8Output = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8Output
$OutputEncoding = $Utf8Output

$Package = $env:CODEX_MCP_PACKAGE
if (-not $Package) {
    $Package = "https://github.com/meesii/codex-mcp/releases/latest/download/codex-mcp.tgz"
}

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

function Warn([string]$Message) {
    Write-Status "!" Yellow $Message
}

function Success([string]$Message) {
    Write-Status "✓" Green $Message
}

function Fail([string]$Message) {
    Write-Status "✗" Red "Installation failed: $Message"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js not found. Install Node.js 22 or later first."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm not found. Reinstalling Node.js usually fixes this."
}

$nodeVersionText = (& node -p "process.versions.node").Trim()
try {
    $nodeMajor = ([version]$nodeVersionText).Major
} catch {
    Fail "Cannot identify Node.js version: $nodeVersionText"
}
if ($nodeMajor -lt 22) {
    Fail "Current Node.js version is $(& node -v); version 22 or later is required."
}

$installRoot = Join-Path $env:USERPROFILE ".codex-mcp\npm"
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

if ($env:CODEX_MCP_UPDATE -eq "1") {
    Info "Updating codex-mcp…"
} else {
    Info "Installing codex-mcp…"
}
& npm install --global --prefix $installRoot $Package
if ($LASTEXITCODE -ne 0) {
    Fail "npm installation incomplete. Check the errors above."
}

$cmdPath = Join-Path $installRoot "codex-mcp.cmd"
if (-not (Test-Path -LiteralPath $cmdPath)) {
    Fail "Installation complete, but the codex-mcp command was not found: $cmdPath"
}

$toolsCli = Join-Path $installRoot "node_modules\@meesii\codex-mcp\dist\managed-tools\cli.js"
if (-not (Test-Path -LiteralPath $toolsCli)) {
    Fail "Installation complete, but the runtime tool manager is missing."
}
Info "Preparing required tools…"
& node $toolsCli bootstrap
if ($LASTEXITCODE -ne 0) {
    Fail "Required tool preparation failed. Check your network and rerun installation."
}
Success "Required tools ready"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }
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
$newPath = (@($installRoot) + @($parts)) -join ";"
[Environment]::SetEnvironmentVariable("Path", $newPath, "User")
$env:Path = "$installRoot;$env:Path"

$version = & $cmdPath --version 2>$null
Write-Host ""
Success "codex-mcp $version"
Success "Command directory added to PATH: $installRoot"
Write-Host ""
if ($env:CODEX_MCP_UPDATE -eq "1") {
    Success "Update complete. Configuration, connection password, and Tunnel settings are preserved."
    Warn "Restart any running codex-mcp service; existing processes do not automatically load the updated core tool schema."
} else {
    Info "For first use, run: codex-mcp open"
    Info "Or run in a project directory: codex-mcp start"
    Warn "If other terminals cannot find codex-mcp, reopen them."
}
