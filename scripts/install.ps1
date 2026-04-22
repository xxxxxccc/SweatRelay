# SweatRelay CLI installer for Windows.
#
#   irm https://raw.githubusercontent.com/xxxxxccc/SweatRelay/main/scripts/install.ps1 | iex
#
# Env vars:
#   $env:SWEATRELAY_VERSION  Specific tag (e.g. v0.1.0) or "nightly". Default: latest release.
#   $env:SWEATRELAY_INSTALL  Install dir. Default: $env:LOCALAPPDATA\Programs\SweatRelay
#   $env:SWEATRELAY_REPO     owner/repo override. Default: xxxxxccc/SweatRelay

$ErrorActionPreference = 'Stop'

$Repo = if ($env:SWEATRELAY_REPO) { $env:SWEATRELAY_REPO } else { 'xxxxxccc/SweatRelay' }
$Version = $env:SWEATRELAY_VERSION
$InstallDir = if ($env:SWEATRELAY_INSTALL) {
    $env:SWEATRELAY_INSTALL
} else {
    Join-Path $env:LOCALAPPDATA 'Programs\SweatRelay'
}

function Info($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

if ([Environment]::Is64BitOperatingSystem -eq $false) {
    Fail "Only 64-bit Windows is supported."
}

if (-not $Version) {
    Info "Resolving latest release..."
    $api = "https://api.github.com/repos/$Repo/releases/latest"
    $Version = (Invoke-RestMethod $api).tag_name
    if (-not $Version) { Fail "Could not resolve latest version; set SWEATRELAY_VERSION." }
}

$Asset = 'sweatrelay-windows-x64.exe'
$Url = "https://github.com/$Repo/releases/download/$Version/$Asset"
$Tmp = Join-Path $env:TEMP 'sweatrelay-installer.exe'

Info "Downloading $Url"
Invoke-WebRequest -Uri $Url -OutFile $Tmp -UseBasicParsing

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$Target = Join-Path $InstallDir 'sweatrelay.exe'
Move-Item -Force $Tmp $Target

Info "Installed: $Target"
& $Target --version

# Add to user PATH if not already
$UserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable('PATH', "$UserPath;$InstallDir", 'User')
    Write-Host "Added $InstallDir to user PATH. Open a new terminal for changes to take effect." -ForegroundColor Yellow
}
