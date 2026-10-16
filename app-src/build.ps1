# build.ps1 - assemble the single-file webapp (index.html) from app-src parts
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

function Read-Part($name) {
  $p = Join-Path $Root $name
  return [System.IO.File]::ReadAllText($p)
}

$tpl    = Read-Part 'template.html'
$style  = Read-Part 'style.css'
$uihtml = Read-Part 'ui.html'
$acorn  = Read-Part 'acorn.js'
$engine = Read-Part 'engine.js'
$uijs   = Read-Part 'ui.js'

foreach ($part in @($style, $uihtml, $acorn, $engine, $uijs)) {
  if ($part -match '</script') {
    throw "part contains a literal '</script>' sequence; it would break inline embedding"
  }
}

$html = $tpl
$html = $html.Replace('@@STYLE@@', $style)
$html = $html.Replace('@@UIHTML@@', $uihtml)
$html = $html.Replace('@@ACORN@@', $acorn)
$html = $html.Replace('@@ENGINE@@', $engine)
$html = $html.Replace('@@UI@@', $uijs)

$out = Join-Path (Split-Path $Root -Parent) 'index.html'
[System.IO.File]::WriteAllText($out, $html, [System.Text.UTF8Encoding]::new($false))

"Built {0} ({1:N0} bytes)" -f $out, (Get-Item $out).Length
