param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateNotNullOrEmpty()]
  [string[]]$Url,

  [string]$OutputDir = ".\\downloads\\flac",

  [string]$YtDlpPath = "C:\Users\Vino\Downloads\yt-dlp.exe",

  [string]$FfmpegPath = "C:\Users\Vino\Downloads\ffmpeg-2026-02-18-git-52b676bb29-essentials_build\bin\ffmpeg.exe",

  [string]$FfprobePath = "C:\Users\Vino\Downloads\ffmpeg-2026-02-18-git-52b676bb29-essentials_build\bin\ffprobe.exe",

  [string]$NodePath = "C:\Program Files\nodejs\node.exe",

  [ValidateSet("0", "1", "2", "3", "4", "5", "6", "7", "8", "9")]
  [string]$AudioQuality = "0",

  [switch]$Single,
  [switch]$Playlist,

  # Backward-compatible alias. Prefer -Playlist.
  [switch]$AllowPlaylist,
  [int]$PlaylistStart,
  [int]$PlaylistEnd,
  [switch]$KeepVideo,
  [switch]$EmbedThumbnail,
  [switch]$WriteInfoJson,
  [switch]$WriteDescription,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-FileExists {
  param(
    [Parameter(Mandatory = $true)][string]$PathValue,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    throw "$Label not found: $PathValue"
  }
}

function Normalize-OutputPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PathValue)
  New-Item -Path $resolved -ItemType Directory -Force | Out-Null
  return $resolved
}

function Assert-ValidUrls {
  param([Parameter(Mandatory = $true)][string[]]$Values)

  foreach ($value in $Values) {
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "Found empty URL value in -Url."
    }
    if ($value -notmatch "^https?://") {
      throw "Invalid URL (must start with http/https): $value"
    }
    if ($value -notmatch "youtu\.be|youtube\.com") {
      Write-Warning "URL does not look like YouTube and may fail: $value"
    }
  }
}

Assert-FileExists -PathValue $YtDlpPath -Label "yt-dlp"
Assert-FileExists -PathValue $FfmpegPath -Label "ffmpeg"
Assert-FileExists -PathValue $FfprobePath -Label "ffprobe"
Assert-FileExists -PathValue $NodePath -Label "node"
Assert-ValidUrls -Values $Url

if ($Single -and $Playlist) {
  throw "Use either -Single or -Playlist, not both."
}

$playlistMode = $false
if ($Playlist -or $AllowPlaylist) {
  $playlistMode = $true
}
$modeLabel = if ($playlistMode) { "playlist" } else { "single" }

if ($PlaylistStart -lt 0) {
  throw "-PlaylistStart must be >= 1."
}
if ($PlaylistEnd -lt 0) {
  throw "-PlaylistEnd must be >= 1."
}
if ($PlaylistStart -gt 0 -and $PlaylistEnd -gt 0 -and $PlaylistEnd -lt $PlaylistStart) {
  throw "-PlaylistEnd cannot be smaller than -PlaylistStart."
}
if (($PlaylistStart -gt 0 -or $PlaylistEnd -gt 0) -and -not $playlistMode) {
  throw "-PlaylistStart/-PlaylistEnd can only be used with -Playlist (or -AllowPlaylist)."
}

$resolvedOutputDir = Normalize-OutputPath -PathValue $OutputDir
$ffmpegDir = Split-Path -Path $FfmpegPath -Parent
$ffprobeDir = Split-Path -Path $FfprobePath -Parent

if ($ffmpegDir -ne $ffprobeDir) {
  Write-Warning "ffprobe is not in the same folder as ffmpeg. Using ffmpeg folder first: $ffmpegDir"
}

# yt-dlp resolves ffprobe from ffmpeg folder / PATH.
$env:PATH = "$ffmpegDir;$env:PATH"

$ytVersion = & $YtDlpPath --version
$ffmpegVersion = (& $FfmpegPath -version | Select-Object -First 1)

Write-Host "Using yt-dlp:  $YtDlpPath"
Write-Host "yt-dlp version: $ytVersion"
Write-Host "Using ffmpeg:  $FfmpegPath"
Write-Host "ffmpeg version: $ffmpegVersion"
Write-Host "Using ffprobe: $FfprobePath"
Write-Host "Using node:    $NodePath"
Write-Host "Output dir:    $resolvedOutputDir"
Write-Host "Mode:          $modeLabel"

$ytArgs = @(
  "--extract-audio",
  "--audio-format", "flac",
  "--audio-quality", $AudioQuality,
  "--format", "bestaudio/best",
  "--js-runtimes", "node:$NodePath",
  "--ffmpeg-location", $ffmpegDir,
  "--paths", $resolvedOutputDir,
  "--output", "%(playlist|Singles)s/%(upload_date>%Y-%m-%d)s - %(artist,channel,uploader|Unknown Artist)s - %(title|Unknown Title)s [%(id)s].%(ext)s",
  "--windows-filenames",
  "--newline",
  "--progress",
  "--concurrent-fragments", "4",
  "--add-metadata",
  "--no-mtime"
)

if (-not $playlistMode) {
  $ytArgs += "--no-playlist"
}
else {
  $ytArgs += "--yes-playlist"
  if ($PlaylistStart -gt 0) {
    $ytArgs += @("--playlist-start", "$PlaylistStart")
  }
  if ($PlaylistEnd -gt 0) {
    $ytArgs += @("--playlist-end", "$PlaylistEnd")
  }
}

if (-not $KeepVideo) {
  $ytArgs += "--no-keep-video"
}

if ($EmbedThumbnail) {
  $ytArgs += "--embed-thumbnail"
}

if ($WriteInfoJson) {
  $ytArgs += "--write-info-json"
}

if ($WriteDescription) {
  $ytArgs += "--write-description"
}

if ($DryRun) {
  $ytArgs += @(
    "--simulate",
    "--print", "before_dl:TITLE=%(title)s"
  )
}

$ytArgs += "--"
$ytArgs += $Url

Write-Host ""
Write-Host "Starting download + conversion to FLAC..."
Write-Host ""

& $YtDlpPath @ytArgs
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
  throw "yt-dlp failed with exit code: $exitCode"
}

Write-Host ""
if ($DryRun) {
  Write-Host "Dry run complete. No file downloaded."
}
else {
  Write-Host "Done. FLAC files saved to: $resolvedOutputDir"
}
