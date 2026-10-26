# Installs the Windows CLI and server from a checksummed GitHub release.
# Run with powershell -ExecutionPolicy Bypass -File install.ps1.

function Compare-Release([string]$left, [string]$right) {
    $a = $left -replace '^cli-v', ''
    $b = $right -replace '^cli-v', ''
    $core = ([version]($a -split '-')[0]).CompareTo([version]($b -split '-')[0])
    if ($core -ne 0) { return $core }
    if ($a -eq $b) { return 0 }
    if ($a -notmatch '-') { return 1 }
    if ($b -notmatch '-') { return -1 }
    return ([int]($a -split '\.')[-1]).CompareTo([int]($b -split '\.')[-1])
}

function Install-Dray {
    [CmdletBinding()]
    param(
        [string]$Repo = 'miziusLabs/Dray',
        [string]$InstallDir = $(if ($env:DRAY_INSTALL_DIR) { $env:DRAY_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.local\bin' }),
        [string]$Channel = $(if ($env:DRAY_CHANNEL) { $env:DRAY_CHANNEL } else { 'stable' }),
        [string]$Version = $env:DRAY_VERSION,
        [string]$CurrentVersion = $env:DRAY_CURRENT_VERSION,
        [bool]$Updating = [bool]$env:DRAY_UPDATING,
        [scriptblock]$GetReleaseList = { param($Uri) Invoke-RestMethod $Uri },
        [scriptblock]$GetWebResponse = {
            param($Uri, $OutFile)
            if ($OutFile) {
                Invoke-WebRequest $Uri -OutFile $OutFile -UseBasicParsing | Out-Null
                return
            }
            Invoke-WebRequest $Uri -UseBasicParsing
        },
        [scriptblock]$ExtractArchive = {
            param($Path, $DestinationPath)
            Expand-Archive -LiteralPath $Path -DestinationPath $DestinationPath
        },
        [scriptblock]$RunBinary = {
            param($Path, $Arguments)
            & $Path @Arguments | Out-Host
            $LASTEXITCODE
        },
        [scriptblock]$AddToPath = {
            param($Path)
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            if ($Path -notin ($userPath -split ';')) {
                [Environment]::SetEnvironmentVariable('Path', "$Path;$userPath", 'User')
            }
            if ($Path -notin ($env:Path -split ';')) { $env:Path = "$Path;$env:Path" }
        }
    )

    $ErrorActionPreference = 'Stop'
    if ($Channel -notin @('stable', 'beta')) { throw 'DRAY_CHANNEL must be stable or beta.' }

    if (-not $Version -or $Version -eq 'latest') {
        $releases = & $GetReleaseList "https://api.github.com/repos/$Repo/releases?per_page=100"
        $Version = $null
        foreach ($release in $releases) {
            $tag = $release.tag_name
            if ($release.draft -or $tag -notmatch '^cli-v\d+\.\d+\.\d+(-beta\.\d+)?$') { continue }
            if ($Channel -eq 'stable' -and ($tag -replace '^cli-v', '') -match '-') { continue }
            if (-not $Version -or (Compare-Release $tag $Version) -gt 0) { $Version = $tag }
        }
        if (-not $Version) { throw 'Could not find a Windows CLI release. Set DRAY_VERSION to a release tag.' }
        if ($CurrentVersion -and (Compare-Release $Version $CurrentVersion) -le 0) {
            Write-Output "Keeping installed dray $CurrentVersion."
            $binary = Join-Path $InstallDir 'dray.exe'
            $exitCode = & $RunBinary -Path $binary -Arguments @('skill', 'install')
            if ($null -ne $exitCode -and [int]$exitCode -ne 0) { throw 'Could not install the Dray skill.' }
            return
        }
    }
    if ($Version -notmatch '^cli-v\d+\.\d+\.\d+(-beta\.\d+)?$') { throw 'DRAY_VERSION must be a CLI release tag.' }

    # x64 binaries also run on Windows ARM64 through Windows emulation.
    $archive = 'dray-x86_64-pc-windows-msvc.zip'
    $url = "https://github.com/$Repo/releases/download/$Version/$archive"
    $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('dray-install-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    try {
        $download = Join-Path $tempDir $archive
        & $GetWebResponse $url $download | Out-Null
        $checksum = (& $GetWebResponse "$url.sha256" $null).Content
        $expected = ($checksum.Trim() -split '\s+')[0]
        if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash $download -Algorithm SHA256).Hash -ne $expected) {
            throw 'The downloaded archive failed SHA256 verification.'
        }
        $unpacked = Join-Path $tempDir 'unpacked'
        & $ExtractArchive -Path $download -DestinationPath $unpacked
        foreach ($name in @('dray.exe', 'dray-serve.exe')) {
            if (-not (Test-Path -LiteralPath (Join-Path $unpacked $name) -PathType Leaf)) { throw "Archive is missing $name." }
        }
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        foreach ($name in @('dray.exe', 'dray-serve.exe')) {
            $destination = Join-Path $InstallDir $name
            # Windows allows a running executable to be renamed, but not overwritten.
            $previous = "$destination.previous"
            if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
            if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $previous }
            try { Copy-Item -LiteralPath (Join-Path $unpacked $name) -Destination $destination }
            catch {
                if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $destination }
                throw
            }
        }
        & $AddToPath $InstallDir
        $binary = Join-Path $InstallDir 'dray.exe'
        $exitCode = & $RunBinary -Path $binary -Arguments @('skill', 'install')
        if ($null -ne $exitCode -and [int]$exitCode -ne 0) { throw 'Could not install the Dray skill.' }
        Write-Output "Installed dray $Version in $InstallDir."
        if (-not $Updating) {
            $exitCode = & $RunBinary -Path $binary -Arguments @('setup')
            if ($null -ne $exitCode -and [int]$exitCode -ne 0) { throw 'Dray setup failed.' }
        }
    } finally {
        $resolvedTemp = [IO.Path]::GetFullPath($tempDir)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($resolvedTemp).StartsWith('dray-install-')) {
            Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
        }
    }
}

# Dot-sourcing loads the functions for the isolated installer tests.
if ($MyInvocation.InvocationName -ne '.') { Install-Dray }
