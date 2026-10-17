# Packs the game's Windows build for the site: Builds\Windows -> Website\downloads\SchoolRiot_<version>_Windows.zip
# (without the "..._DoNotShip" debug folder). The version comes from site.config.json; the file name must
# match the one in downloads\manifest.json.
#   powershell -ExecutionPolicy Bypass -File Website\scripts\pack-game.ps1
param(
    [string]$Build = (Join-Path $PSScriptRoot "..\..\Builds\Windows")
)
$ErrorActionPreference = "Stop"
$site = Resolve-Path (Join-Path $PSScriptRoot "..")
$config = Get-Content (Join-Path $site "site.config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $config.game.version
$build = Resolve-Path $Build
if (-not (Test-Path (Join-Path $build "SchoolRiot.exe"))) { throw "No SchoolRiot.exe in $build - build the game first." }

$stage = Join-Path $env:TEMP "SchoolRiot_pack"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$folder = Join-Path $stage "SchoolRiot"
New-Item -ItemType Directory -Force $folder | Out-Null
# everything but the debug information Unity marks "DoNotShip"
robocopy $build $folder /E /XD "*DoNotShip*" /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the build failed ($LASTEXITCODE)." }

$downloads = Join-Path $site "downloads"
New-Item -ItemType Directory -Force $downloads | Out-Null
$zip = Join-Path $downloads "SchoolRiot_${version}_Windows.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $folder -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output "Packed: $zip ($size MB)"
