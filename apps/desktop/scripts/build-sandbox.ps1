$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$image = if ([string]::IsNullOrWhiteSpace($env:DRAY_CLOUD_IMAGE)) {
    'dray-cloud:latest'
} else {
    $env:DRAY_CLOUD_IMAGE
}
$piPackage = if ([string]::IsNullOrWhiteSpace($env:PI_PACKAGE)) {
    '@earendil-works/pi-coding-agent'
} else {
    $env:PI_PACKAGE
}

Write-Host "Building Dray Cloud sandbox image $image"
& docker build `
    --build-arg "PI_PACKAGE=$piPackage" `
    --tag $image `
    (Join-Path $root 'sandbox')

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
