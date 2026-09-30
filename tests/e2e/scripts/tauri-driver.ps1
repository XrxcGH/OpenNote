# Installs the pinned tauri-driver with cargo, unless that version is already installed (CI caches it).
# In GitHub Actions it also sets TAURI_DRIVER for later steps.
# Usage: pwsh tests/e2e/scripts/tauri-driver.ps1 [-Version <version>]

param([string]$Version = '2.1.0')

$ErrorActionPreference = 'Stop'

$installed = cargo install --list | Select-String -Pattern "^tauri-driver v$([regex]::Escape($Version)):" -Quiet
if (-not $installed) {
  cargo install tauri-driver --version $Version --locked
  if ($LASTEXITCODE -ne 0) { throw "cargo install tauri-driver $Version failed." }
}

$driver = Join-Path $env:USERPROFILE '.cargo\bin\tauri-driver.exe'
if (-not (Test-Path $driver)) { throw "tauri-driver isn't at $driver." }
if ($env:GITHUB_ENV) { "TAURI_DRIVER=$driver" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8 }
Write-Output "tauri-driver $Version`: $driver"
