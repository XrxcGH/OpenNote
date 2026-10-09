<#
.SYNOPSIS
  Registers OpenNote's sparse package for development, so "Share to OpenNote" appears in the Windows share sheet.

.DESCRIPTION
  For a development or test build only. It needs Windows Developer Mode, which lets Windows register an unsigned
  package from a folder. It copies AppxManifest.xml and the logos to a folder beside the exe, fills in the
  publisher and the version, and registers the package with that exe's folder as its external location.

  The exe must have been built with the same publisher (OPENNOTE_MSIX_PUBLISHER; the default matches the default
  here). A release uses a signed package instead; see packaging/msix/README.md.

.PARAMETER ExeFolder
  The folder with OpenNote.exe. The default is the debug build in the shared Cargo target.

.PARAMETER Unregister
  Removes the package again.

.EXAMPLE
  pwsh packaging/msix/register-dev.ps1 -ExeFolder target/debug
#>
[CmdletBinding()]
param(
  [string]$ExeFolder = (Join-Path $PSScriptRoot '..\..\target\debug'),
  [string]$Publisher = 'CN=OpenNote Development',
  [string]$Version = '0.1.0.0',
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$name = 'OpenNote.ShareTarget'

if ($Unregister) {
  Get-AppxPackage -Name $name | Remove-AppxPackage
  Write-Host 'The OpenNote share target is removed.'
  return
}

if ($Publisher -notmatch '^CN=[^"<>&]+$') { throw "The publisher must look like CN=Name, not $Publisher." }
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "The version must have four numbers, like 0.1.0.0." }
$exe = Join-Path (Resolve-Path $ExeFolder) 'OpenNote.exe'
if (-not (Test-Path $exe)) {
  # A Cargo build names the exe after the crate.
  $exe = Join-Path (Resolve-Path $ExeFolder) 'opennote.exe'
}
if (-not (Test-Path $exe)) { throw "There's no OpenNote.exe in $ExeFolder. Build the app first." }

$devMode = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
if (-not $devMode -or $devMode.AllowDevelopmentWithoutDevLicense -ne 1) {
  throw 'Turn on Developer Mode in Settings, System, For developers, then run this again.'
}

$stage = Join-Path (Split-Path $exe) 'share-target-package'
New-Item -ItemType Directory -Force (Join-Path $stage 'Assets') | Out-Null
$icons = Join-Path $PSScriptRoot '..\..\app\src-tauri\icons'
foreach ($logo in 'StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png') {
  Copy-Item (Join-Path $icons $logo) (Join-Path $stage "Assets\$logo") -Force
}
$manifest = Get-Content (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw
$manifest = $manifest.Replace('Publisher="PUBLISHER"', "Publisher=""$Publisher""").Replace('Version="VERSION"', "Version=""$Version""")
if ((Split-Path $exe -Leaf) -ne 'OpenNote.exe') {
  $manifest = $manifest.Replace('Executable="OpenNote.exe"', "Executable=""$(Split-Path $exe -Leaf)""")
}
Set-Content -Path (Join-Path $stage 'AppxManifest.xml') -Value $manifest -Encoding utf8

Get-AppxPackage -Name $name | Remove-AppxPackage
Add-AppxPackage -Register (Join-Path $stage 'AppxManifest.xml') -ExternalLocation (Split-Path $exe)
Write-Host "Registered. Share something to OpenNote from another app; Unregister removes it again."
