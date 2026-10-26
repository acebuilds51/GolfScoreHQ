# Builds the app's home-screen icons from a square artwork file (any format
# Windows can read: PNG, JPG, WebP). Run from the GolfScoreHQ folder:
#   pwsh scripts/make-icons-from-art.ps1 -Art path\to\icon.webp
# Rounded white corners in the artwork are filled with nearby colour, because
# phones round icons themselves and white would show in the corners.
param([Parameter(Mandatory)][string]$Art, [int]$CornerRadius = 266)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName System.Drawing

$s = [IO.File]::OpenRead((Resolve-Path $Art))
$dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create($s, 'PreservePixelFormat', 'OnLoad')
$s.Close()
$frame = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap($dec.Frames[0], [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
$W = $frame.PixelWidth; $H = $frame.PixelHeight
if ($W -ne $H) { throw "The artwork must be square (it is ${W}x${H})." }
$px = New-Object byte[] ($W * $H * 4)
$frame.CopyPixels($px, $W * 4, 0)

# Fill the four rounded corners: each pixel outside the curve takes the colour
# of the nearest pixel just inside it, toward the image centre.
$r = [Math]::Min($CornerRadius, [int]($W / 2))
$cx = @($r, ($W - 1 - $r)); $cy = @($r, ($H - 1 - $r))
foreach ($ax in $cx) { foreach ($ay in $cy) {
  $x0 = if ($ax -lt $W / 2) { 0 } else { $ax }; $x1 = if ($ax -lt $W / 2) { $ax } else { $W - 1 }
  $y0 = if ($ay -lt $H / 2) { 0 } else { $ay }; $y1 = if ($ay -lt $H / 2) { $ay } else { $H - 1 }
  for ($y = $y0; $y -le $y1; $y++) { for ($x = $x0; $x -le $x1; $x++) {
    $dx = $x - $ax; $dy = $y - $ay; $dist = [Math]::Sqrt($dx * $dx + $dy * $dy)
    if ($dist -gt $r - 3) {
      $k = ($r - 4) / $dist
      $sx = [int][Math]::Round($ax + $dx * $k); $sy = [int][Math]::Round($ay + $dy * $k)
      $si = ($sy * $W + $sx) * 4; $di = ($y * $W + $x) * 4
      $px[$di] = $px[$si]; $px[$di + 1] = $px[$si + 1]; $px[$di + 2] = $px[$si + 2]; $px[$di + 3] = 255
    }
  } }
} }

# Hand the cleaned image to System.Drawing for high-quality resizing.
$full = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$lock = $full.LockBits((New-Object System.Drawing.Rectangle(0, 0, $W, $H)), 'WriteOnly', $full.PixelFormat)
[System.Runtime.InteropServices.Marshal]::Copy($px, 0, $lock.Scan0, $px.Length)
$full.UnlockBits($lock)

function New-Canvas([int]$size) {
  $b = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  return @($b, $g)
}
function Save-Icon([int]$size, [string]$name, [double]$scale = 1.0) {
  $b, $g = New-Canvas $size
  if ($scale -lt 1) {
    # Safe-zone version: a blurred copy fills the background, the art sits smaller on top.
    $tiny = New-Object System.Drawing.Bitmap(24, 24)
    $tg = [System.Drawing.Graphics]::FromImage($tiny); $tg.InterpolationMode = 'HighQualityBicubic'
    $tg.DrawImage($full, 0, 0, 24, 24); $tg.Dispose()
    $g.DrawImage($tiny, -4, -4, $size + 8, $size + 8); $tiny.Dispose()
  }
  $inner = [int][Math]::Round($size * $scale); $off = [int](($size - $inner) / 2)
  $g.DrawImage($full, $off, $off, $inner, $inner)
  $g.Dispose()
  $out = Join-Path $PSScriptRoot "..\apps\web\public\$name"
  $b.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
  "wrote $name ($size px)"
}

Save-Icon 180 'apple-touch-icon.png'
Save-Icon 192 'icon-192.png'
Save-Icon 512 'icon-512.png'
# Android may crop to a circle 80% of the icon wide; at 78% the art's edges sit
# at that circle and the wordmark stays inside it.
Save-Icon 512 'icon-maskable-512.png' 0.78
Save-Icon 64 'favicon-64.png'
$full.Dispose()
