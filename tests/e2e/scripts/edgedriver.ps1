# Fetches the msedgedriver that matches this machine's WebView2 Runtime, which tauri-driver needs, and caches it
# by version under tests/e2e/.drivers. In GitHub Actions it also sets MSEDGEDRIVER for later steps.
# Usage: pwsh tests/e2e/scripts/edgedriver.ps1 [-Destination <folder>]

param([string]$Destination = (Join-Path $PSScriptRoot '..\.drivers'))

$ErrorActionPreference = 'Stop'

# The WebView2 Runtime's client id in the Edge updater's registry keys.
$client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$keys = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client",
  "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$client"
)
$version = $keys |
  ForEach-Object { (Get-ItemProperty -Path $_ -Name pv -ErrorAction SilentlyContinue).pv } |
  Where-Object { $_ -and $_ -ne '0.0.0.0' } |
  Select-Object -First 1
if (-not $version) { throw 'The WebView2 Runtime is not installed.' }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'ARM64' { 'arm64' } 'x86' { 'win32' } default { 'win64' } }
$folder = Join-Path $Destination $version
$driver = Join-Path $folder 'msedgedriver.exe'

if (-not (Test-Path $driver)) {
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $zip = Join-Path $folder 'edgedriver.zip'
  $hosts = @('https://msedgedriver.microsoft.com', 'https://msedgedriver.azureedge.net')
  $downloaded = $false
  foreach ($base in $hosts) {
    try {
      Invoke-WebRequest -Uri "$base/$version/edgedriver_$arch.zip" -OutFile $zip
      $downloaded = $true
      break
    } catch {
      Write-Warning "Couldn't download msedgedriver $version from ${base}: $_"
    }
  }
  if (-not $downloaded) { throw "No msedgedriver $version for $arch." }
  Expand-Archive -Path $zip -DestinationPath $folder -Force
  Remove-Item $zip
}

if ($env:GITHUB_ENV) { "MSEDGEDRIVER=$driver" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8 }
Write-Output "msedgedriver $version for WebView2 $version`: $driver"
