# Grabs a still from every mp4 in public/ into public/posters/.
#
# The posters are what let the videos load lazily without leaving black
# tiles on the board, so run this after dropping a new capture in and before
# adding its entry to src/lib/media.ts.
#
#   pwsh ./scripts/posters.ps1          # only what is missing
#   pwsh ./scripts/posters.ps1 --force  # redo everything
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$posterDirectory = Join-Path $root 'public/posters'
New-Item -ItemType Directory -Path $posterDirectory -Force | Out-Null
$force = $args -contains '--force' -or $args -contains '-Force'

Get-ChildItem -Path (Join-Path $root 'public') -Filter '*.mp4' -File | ForEach-Object {
    $poster = Join-Path $posterDirectory "$($_.BaseName).jpg"
    if ((Test-Path -LiteralPath $poster) -and -not $force) {
        Write-Host "skip $poster"
        return
    }

    # A second in, not frame zero: these captures open on a still window and an
    # opening frame is often the least representative one in the clip.
    & ffmpeg -y -loglevel error -ss 1 -i $_.FullName -frames:v 1 -q:v 4 $poster
    if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg failed with exit code $LASTEXITCODE for $($_.Name)"
    }
    Write-Host "wrote $poster"
}
