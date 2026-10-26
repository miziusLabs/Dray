$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\public\install.ps1')

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}

function Assert-Equal($expected, $actual, [string]$message) {
    if ($expected -cne $actual) { throw "$message Expected '$expected', got '$actual'." }
}

function Assert-Throws([scriptblock]$action, [string]$messagePart, [string]$message) {
    $caught = $false
    try { & $action }
    catch {
        $caught = $true
        if ($_.Exception.Message -notlike "*$messagePart*") { throw "$message Unexpected error: $($_.Exception.Message)" }
    }
    if (-not $caught) { throw $message }
}

function New-WebResponseMock([string]$archivePath, [string]$digest, [System.Collections.Generic.List[string]]$requests) {
    return {
        param($Uri, $OutFile)
        $requests.Add([string]$Uri)
        if ($OutFile) {
            Copy-Item -LiteralPath $archivePath -Destination $OutFile
            return
        }
        [pscustomobject]@{ Content = "$digest  dray-x86_64-pc-windows-msvc.zip" }
    }.GetNewClosure()
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('dray-installer-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
$originalPath = $env:Path
try {
    $validFiles = Join-Path $testRoot 'valid-files'
    New-Item -ItemType Directory -Path $validFiles | Out-Null
    Set-Content -LiteralPath (Join-Path $validFiles 'dray.exe') -Value 'fake dray executable' -NoNewline
    Set-Content -LiteralPath (Join-Path $validFiles 'dray-serve.exe') -Value 'fake server executable' -NoNewline
    $validArchive = Join-Path $testRoot 'valid.zip'
    Compress-Archive -Path (Join-Path $validFiles '*') -DestinationPath $validArchive
    $validHash = (Get-FileHash -LiteralPath $validArchive -Algorithm SHA256).Hash.ToLowerInvariant()

    $releaseList = @(
        [pscustomobject]@{ tag_name = 'cli-v1.4.0-beta.2'; draft = $false },
        [pscustomobject]@{ tag_name = 'cli-v1.4.0-beta.1'; draft = $false },
        [pscustomobject]@{ tag_name = 'cli-v1.3.9'; draft = $false },
        [pscustomobject]@{ tag_name = 'cli-v1.5.0'; draft = $true },
        [pscustomobject]@{ tag_name = 'not-a-cli-release'; draft = $false }
    )

    $releaseUri = [System.Collections.Generic.List[string]]::new()
    $getReleaseList = {
        param($Uri)
        $releaseUri.Add([string]$Uri)
        $releaseList
    }.GetNewClosure()
    $requests = [System.Collections.Generic.List[string]]::new()
    $webResponse = New-WebResponseMock $validArchive $validHash $requests
    $calls = [System.Collections.Generic.List[object]]::new()
    $runBinary = {
        param($Path, $Arguments)
        $calls.Add([pscustomobject]@{ Path = [string]$Path; Arguments = @($Arguments) })
        0
    }.GetNewClosure()
    $noPathChanges = { param($Path) }.GetNewClosure()

    $betaInstall = Join-Path $testRoot 'beta-install'
    Install-Dray -InstallDir $betaInstall -Channel beta -Version latest `
        -GetReleaseList $getReleaseList -GetWebResponse $webResponse `
        -RunBinary $runBinary -AddToPath $noPathChanges | Out-Null
    Assert-Equal 'https://api.github.com/repos/miziusLabs/Dray/releases?per_page=100' $releaseUri[0] 'The release lookup used an unexpected URL.'
    Assert-True ($requests[0] -like 'https://github.com/miziusLabs/Dray/releases/download/cli-v1.4.0-beta.2/*') 'Beta did not select the newest beta release.'
    Assert-True (Test-Path -LiteralPath (Join-Path $betaInstall 'dray.exe')) 'The installer did not copy dray.exe.'
    Assert-True (Test-Path -LiteralPath (Join-Path $betaInstall 'dray-serve.exe')) 'The installer did not copy dray-serve.exe.'
    Assert-Equal 2 $calls.Count 'The installer should invoke the skill install and setup commands.'
    Assert-Equal 'skill,install' ($calls[0].Arguments -join ',') 'The installer passed unexpected arguments to skill install.'
    Assert-Equal 'setup' ($calls[1].Arguments -join ',') 'The installer passed unexpected arguments to setup.'
    Assert-Equal $originalPath $env:Path 'The mocked installer changed the process PATH.'

    $stableInstall = Join-Path $testRoot 'stable-install'
    $requests.Clear()
    $calls.Clear()
    Install-Dray -InstallDir $stableInstall -Channel stable -Version latest `
        -GetReleaseList $getReleaseList -GetWebResponse $webResponse `
        -RunBinary $runBinary -AddToPath $noPathChanges | Out-Null
    Assert-True ($requests[0] -like 'https://github.com/miziusLabs/Dray/releases/download/cli-v1.3.9/*') 'Stable did not ignore newer beta and draft releases.'

    $badHash = ('0' * 64)
    $badChecksumRequests = [System.Collections.Generic.List[string]]::new()
    $badChecksumWeb = New-WebResponseMock $validArchive $badHash $badChecksumRequests
    $checksumInstall = Join-Path $testRoot 'checksum-install'
    $calls.Clear()
    Assert-Throws {
        Install-Dray -InstallDir $checksumInstall -Version cli-v1.3.9 `
            -GetWebResponse $badChecksumWeb -RunBinary $runBinary -AddToPath $noPathChanges | Out-Null
    } 'SHA256 verification' 'The installer accepted a checksum mismatch.'
    Assert-True (-not (Test-Path -LiteralPath $checksumInstall)) 'The installer wrote files before checking the checksum.'
    Assert-Equal 0 $calls.Count 'The installer ran a binary after a checksum mismatch.'

    $invalidFiles = Join-Path $testRoot 'invalid-files'
    New-Item -ItemType Directory -Path $invalidFiles | Out-Null
    Set-Content -LiteralPath (Join-Path $invalidFiles 'dray.exe') -Value 'fake executable' -NoNewline
    $invalidArchive = Join-Path $testRoot 'invalid.zip'
    Compress-Archive -Path (Join-Path $invalidFiles '*') -DestinationPath $invalidArchive
    $invalidHash = (Get-FileHash -LiteralPath $invalidArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    $invalidWeb = New-WebResponseMock $invalidArchive $invalidHash ([System.Collections.Generic.List[string]]::new())
    $invalidInstall = Join-Path $testRoot 'invalid-install'
    $calls.Clear()
    Assert-Throws {
        Install-Dray -InstallDir $invalidInstall -Version cli-v1.3.9 `
            -GetWebResponse $invalidWeb -RunBinary $runBinary -AddToPath $noPathChanges | Out-Null
    } 'Archive is missing dray-serve.exe' 'The installer accepted an archive without the server binary.'
    Assert-True (-not (Test-Path -LiteralPath $invalidInstall)) 'The installer wrote files from an invalid archive.'
    Assert-Equal 0 $calls.Count 'The installer ran a binary after archive validation failed.'

    Write-Output 'Windows installer tests passed.'
}
finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $tempRootFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTestRoot.StartsWith($tempRootFull, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolvedTestRoot).StartsWith('dray-installer-test-')) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
