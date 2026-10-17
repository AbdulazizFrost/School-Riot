# Uploads the site from this computer to the server and installs or updates it there (over SSH).
#   First time:  powershell -ExecutionPolicy Bypass -File Website\deploy\deploy.ps1 -Server 1.2.3.4 -Setup -Domain schoolriot.duckdns.org -Email you@mail.com -Game
#   Updates:     powershell -ExecutionPolicy Bypass -File Website\deploy\deploy.ps1 -Server 1.2.3.4
#   -Game        also uploads the game's archive from Website\downloads (big: a few minutes)
#   -User        the server's login (root by default; another user needs sudo)
#   -Key         the SSH key file (default: ~\.ssh\schoolriot_ed25519, or your usual key when that is missing)
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$User = "root",
    [string]$Key = (Join-Path $HOME ".ssh\schoolriot_ed25519"),
    [switch]$Setup,
    [string]$Domain = "",
    [string]$Email = "",
    [switch]$Game
)
$ErrorActionPreference = "Stop"
$site = Resolve-Path (Join-Path $PSScriptRoot "..")
$parent = Split-Path $site -Parent
$sshArgs = @("-o", "StrictHostKeyChecking=accept-new")
if (Test-Path $Key) { $sshArgs += @("-i", $Key) }
$target = "$User@$Server"
$sudo = if ($User -eq "root") { "" } else { "sudo " }

# the site without its local database, uploads and the big archives
$archive = Join-Path $env:TEMP "school-riot-site.tgz"
if (Test-Path $archive) { Remove-Item $archive -Force }
tar -czf $archive --exclude "Website/data" --exclude "Website/downloads/*.zip" -C $parent Website
if ($LASTEXITCODE -ne 0) { throw "Packing the site failed." }
Write-Output ("Site packed: {0:N1} MB" -f ((Get-Item $archive).Length / 1MB))

scp @sshArgs $archive "${target}:/tmp/school-riot-site.tgz"
if ($LASTEXITCODE -ne 0) { throw "Upload failed (is the server reachable, is the key added?)." }

$script = if ($Setup) { "setup.sh $Domain $Email" } else { "update.sh" }
$remote = "rm -rf /tmp/school-riot-site && mkdir -p /tmp/school-riot-site && tar -xzf /tmp/school-riot-site.tgz -C /tmp/school-riot-site && ${sudo}bash /tmp/school-riot-site/Website/deploy/$script"
ssh -t @sshArgs $target $remote
if ($LASTEXITCODE -ne 0) { throw "The installation on the server reported a problem (see above)." }

if ($Game) {
    $zips = Get-ChildItem (Join-Path $site "downloads") -Filter "*.zip"
    foreach ($z in $zips) {
        Write-Output "Uploading $($z.Name) ($([math]::Round($z.Length / 1MB)) MB)..."
        scp @sshArgs $z.FullName "${target}:/tmp/$($z.Name)"
        if ($LASTEXITCODE -ne 0) { throw "Uploading the game failed." }
        ssh @sshArgs $target "${sudo}install -m 0644 -o root -g root /tmp/$($z.Name) /opt/school-riot/downloads/$($z.Name) && rm -f /tmp/$($z.Name)"
    }
    Write-Output "Game archive on the server: the download page shows it within a few seconds."
}
Write-Output "Done."
