# Starts the test exe the way msedgedriver starts a WebView2 app, and reports whether WebView2 opens its debugging
# port. The E2E specs need that port, and when it never opens, msedgedriver only says "DevToolsActivePort file
# doesn't exist" after a minute. This probe fails sooner and says what the app did: whether it exited, how far it
# got (the perf log), and what the app and WebView2 wrote.
# Usage: pwsh tests/e2e/scripts/probe-app.ps1 [-Exe <path>] [-WaitSeconds <seconds>]

param(
  [string]$Exe = $env:OPENNOTE_E2E_EXE,
  [int]$WaitSeconds = 45
)

$ErrorActionPreference = 'Stop'
if (-not $Exe) { throw 'Pass -Exe or set OPENNOTE_E2E_EXE.' }

$work = Join-Path ([IO.Path]::GetTempPath()) ('opennote-probe-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$profileDir = Join-Path $work 'profile'
$webview = Join-Path $work 'webview'
New-Item -ItemType Directory -Force -Path $profileDir, $webview | Out-Null

# What msedgedriver sets for a WebView2 app: a user data folder of its own, and a debugging port picked by WebView2.
$env:OPENNOTE_PROFILE_DIR = $profileDir
$env:OPENNOTE_PERF_LOG = Join-Path $work 'perf.jsonl'
$env:WEBVIEW2_USER_DATA_FOLDER = $webview
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=0'

$out = Join-Path $work 'stdout.txt'
$err = Join-Path $work 'stderr.txt'
$app = Start-Process -FilePath (Resolve-Path $Exe) -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
$port = Join-Path $webview 'EBWebView\DevToolsActivePort'
$opened = $false
for ($second = 0; $second -lt $WaitSeconds; $second++) {
  if (Test-Path $port) { $opened = $true; break }
  if ($app.HasExited) { break }
  Start-Sleep -Seconds 1
}

Write-Output "Debugging port opened: $opened"
if ($app.HasExited) {
  Write-Output "The app exited with code $($app.ExitCode)."
} else {
  Write-Output 'The app is still running.'
}
Write-Output '--- perf log'
if (Test-Path $env:OPENNOTE_PERF_LOG) { Get-Content $env:OPENNOTE_PERF_LOG } else { Write-Output '(none)' }
Write-Output '--- files'
Get-ChildItem -Path $work -Recurse -Depth 4 -ErrorAction SilentlyContinue |
  ForEach-Object { $_.FullName.Substring($work.Length) }
foreach ($file in @($out, $err)) {
  Write-Output "--- $(Split-Path $file -Leaf)"
  if (Test-Path $file) { Get-Content $file -TotalCount 40 }
}
$logs = Join-Path $profileDir 'local\logs'
Get-ChildItem -Path $logs -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output "--- $($_.Name)"
  Get-Content $_.FullName -TotalCount 60
}

if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
if (-not $opened) { exit 1 }
