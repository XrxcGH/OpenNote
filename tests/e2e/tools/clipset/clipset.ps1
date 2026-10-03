# clipset loads one clipboard corpus case onto the real Windows clipboard, with every format the source program
# would write (Phase 4 ARCHITECTURE.md section 26). A case is a folder of tests/fixtures/clipboard/<source>/<case>.
# Its fragment.html goes on as CF_HTML ("HTML Format"), with a header that names the source address.
# Its text.txt goes on as CF_UNICODETEXT.
# Its facts.json names what the shell reads besides the text, such as { "sourceUrl": "...", "hasOneNote": true }.
# Its image.png goes on as a bitmap, for image-only pastes.
# Run it in a single-threaded apartment: powershell -NoProfile -STA -File clipset.ps1 <case folder>.
param([Parameter(Mandatory = $true)][string]$Case)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$folder = (Resolve-Path -LiteralPath $Case).Path
$data = New-Object System.Windows.Forms.DataObject
$facts = @{}
$factsFile = Join-Path $folder 'facts.json'
if (Test-Path -LiteralPath $factsFile) {
  $parsed = Get-Content -LiteralPath $factsFile -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($property in $parsed.PSObject.Properties) { $facts[$property.Name] = $property.Value }
}

# CF_HTML: a header of byte offsets into the UTF-8 bytes, then the document (the Windows HTML clipboard format).
function ConvertTo-CfHtml([string]$html, [string]$sourceUrl) {
  if ($html -notmatch '<!--StartFragment-->') {
    $html = "<html><body><!--StartFragment-->$html<!--EndFragment--></body></html>"
  }
  $template = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
  if ($sourceUrl) { $template += "SourceURL:$sourceUrl`r`n" }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $headerLength = $utf8.GetByteCount(($template -f 0, 0, 0, 0))
  $before = $html.Substring(0, $html.IndexOf('<!--StartFragment-->') + '<!--StartFragment-->'.Length)
  $fragmentEnd = $html.IndexOf('<!--EndFragment-->')
  $startFragment = $headerLength + $utf8.GetByteCount($before)
  $endFragment = $headerLength + $utf8.GetByteCount($html.Substring(0, $fragmentEnd))
  $endHtml = $headerLength + $utf8.GetByteCount($html)
  $header = $template -f $headerLength, $endHtml, $startFragment, $endFragment
  return $utf8.GetBytes($header + $html)
}

$htmlFile = Join-Path $folder 'fragment.html'
if (Test-Path -LiteralPath $htmlFile) {
  $html = Get-Content -LiteralPath $htmlFile -Raw -Encoding UTF8
  $bytes = ConvertTo-CfHtml $html $facts['sourceUrl']
  # A stream goes on the clipboard as its raw bytes, so the offsets stay true.
  $data.SetData('HTML Format', (New-Object System.IO.MemoryStream(, $bytes)))
}

$textFile = Join-Path $folder 'text.txt'
if (Test-Path -LiteralPath $textFile) {
  $text = Get-Content -LiteralPath $textFile -Raw -Encoding UTF8
  $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $text.Replace("`r`n", "`n").Replace("`n", "`r`n"))
}

if ($facts['hasOneNote']) {
  # OneNote writes its own formats beside the HTML; the shell only checks that one is there.
  $data.SetData('OneNote 2016 Internal Format', (New-Object System.IO.MemoryStream(, [byte[]](0, 1, 2, 3))))
}

$imageFile = Join-Path $folder 'image.png'
if (Test-Path -LiteralPath $imageFile) {
  $data.SetImage([System.Drawing.Image]::FromFile($imageFile))
}

# Copy = true keeps the data after this process exits; retry while another program holds the clipboard.
for ($attempt = 0; $attempt -lt 10; $attempt++) {
  try {
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
    exit 0
  } catch {
    Start-Sleep -Milliseconds 100
  }
}
Write-Error 'The clipboard stayed busy.'
exit 1
