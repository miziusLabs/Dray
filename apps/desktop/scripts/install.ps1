# Build the app and install it over the copy in /Applications.
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $root 'src-tauri/tauri.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$destinationDirectory = if ([string]::IsNullOrWhiteSpace($env:DEST_DIR)) {
    '/Applications'
} else {
    $env:DEST_DIR
}

$name = [string]$config.productName
$bundleId = [string]$config.identifier
$destination = Join-Path $destinationDirectory "$name.app"

function Say {
    param([Parameter(Mandatory = $true)][string] $Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail {
    param([Parameter(Mandatory = $true)][string] $Message)
    [Console]::Error.WriteLine("error: $Message")
    exit 1
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,
        [Parameter(Mandatory = $false)]
        [string[]] $Arguments = @()
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

$scriptArguments = @($args)
Say "Building $name"
Push-Location $root
try {
    & pnpm tauri build @scriptArguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

# `--target` moves the bundle under target/<triple>/, so find it rather than
# hardcoding target/release.
$targetDirectory = Join-Path $root 'src-tauri/target'
$source = Get-ChildItem -LiteralPath $targetDirectory -Filter "$name.app" -Directory -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '[\\/]bundle[\\/]macos[\\/]' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($null -eq $source) {
    Fail "no $name.app under src-tauri/target after build"
}
$sourcePath = $source.FullName
Say "Built $sourcePath"

function Test-AppRunning {
    if ($null -eq (Get-Command pgrep -ErrorAction SilentlyContinue)) {
        return $false
    }
    $null = & pgrep -f "$destination/Contents/MacOS/"
    return $LASTEXITCODE -eq 0
}

# Replacing the bundle under a running process leaves it half-swapped.
$wasRunning = Test-AppRunning
if ($wasRunning) {
    Say "Quitting running $name"
    try {
        & osascript -e "tell application id \"$bundleId\" to quit" *> $null
    } catch {
        # The process check below is authoritative if AppleScript is unavailable.
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Test-AppRunning)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (Test-AppRunning) {
        try {
            & pkill -f "$destination/Contents/MacOS/" *> $null
        } catch {
            # The install will fail rather than replacing a locked bundle.
        }
    }
    Start-Sleep -Milliseconds 500
}

$backupRoot = $null
$backup = $null
if (Test-Path -LiteralPath $destination -PathType Container) {
    $backupRoot = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backup = Join-Path $backupRoot "$name.app"
    Say 'Backing up existing install'
    Move-Item -LiteralPath $destination -Destination $backup
}

# ditto over Copy-Item: it preserves the bundle's metadata and code signature.
Say "Installing to $destination"
try {
    Invoke-External 'ditto' @($sourcePath, $destination)
    if ($null -ne $backupRoot) {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force
        $backupRoot = $null
    }
} catch {
    if ($null -ne $backup) {
        if (Test-Path -LiteralPath $destination) {
            Remove-Item -LiteralPath $destination -Recurse -Force
        }
        Move-Item -LiteralPath $backup -Destination $destination
        Fail "install failed; restored the previous $name.app"
    }
    Fail 'install failed'
}

# Gatekeeper keeps the pre-swap bundle cached otherwise, so the first launch fails.
if ($null -ne (Get-Command xattr -ErrorAction SilentlyContinue)) {
    & xattr -dr com.apple.quarantine $destination *> $null
}

Say "Installed $name $($config.version) to $destination"
$openAfter = $env:OPEN_AFTER -eq '1'
if ($wasRunning -or $openAfter) {
    Say 'Relaunching'
    & open $destination
}
