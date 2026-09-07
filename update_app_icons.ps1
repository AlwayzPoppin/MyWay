Add-Type -AssemblyName System.Drawing

$rawPath = "C:\Users\wattz\MYWAY-GPS\public\icon.png"
if (-not (Test-Path $rawPath)) {
    $rawPath = "C:\Users\wattz\MYWAY-GPS\public\logo.png"
}

Write-Host "Loading master icon from: $rawPath"
$rawImage = [System.Drawing.Bitmap]::FromFile($rawPath)

# 1. Detect content bounding box or crop square centered around the squircle
# For the 1024x855 canvas, content is centered at (515, 426) with ~690x664 dimensions.
$boxSize = 760
$srcX = [int](515 - ($boxSize / 2))
$srcY = [int](426 - ($boxSize / 2))

if ($srcX -lt 0) { $srcX = 0 }
if ($srcY -lt 0) { $srcY = 0 }
if ($srcX + $boxSize -gt $rawImage.Width) { $boxSize = $rawImage.Width - $srcX }
if ($srcY + $boxSize -gt $rawImage.Height) { $boxSize = $rawImage.Height - $srcY }

# Generate 512x512 clean square master
$master512 = New-Object System.Drawing.Bitmap(512, 512)
$g = [System.Drawing.Graphics]::FromImage($master512)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

$srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $boxSize, $boxSize)
$destRect = New-Object System.Drawing.Rectangle(0, 0, 512, 512)
$g.DrawImage($rawImage, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$rawImage.Dispose()

# Function to resize bitmap
function Get-ResizedBitmap($image, $width, $height) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($image, 0, 0, $width, $height)
    $graphics.Dispose()
    return $bmp
}

function Save-ResizedImage($image, $width, $height, $targetPath) {
    $dir = [System.IO.Path]::GetDirectoryName($targetPath)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $bmp = Get-ResizedBitmap $image $width $height
    $bmp.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated: $targetPath ($($width)x$($height))"
}

# Function to write multi-resolution ICO file
function New-IcoFromPngs($pngSizes, $targetIcoPath) {
    $msList = @()
    foreach ($bmp in $pngSizes) {
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $msList += $ms
    }
    
    $dir = [System.IO.Path]::GetDirectoryName($targetIcoPath)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $fs = New-Object System.IO.FileStream($targetIcoPath, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)
    
    # ICONDIR Header
    $bw.Write([uint16]0) # Reserved
    $bw.Write([uint16]1) # Type: 1 = Icon
    $bw.Write([uint16]$msList.Count) # Image count
    
    $offset = 6 + (16 * $msList.Count)
    for ($i = 0; $i -lt $msList.Count; $i++) {
        $bmp = $pngSizes[$i]
        $dataLen = $msList[$i].Length
        $w = if ($bmp.Width -ge 256) { 0 } else { [byte]$bmp.Width }
        $h = if ($bmp.Height -ge 256) { 0 } else { [byte]$bmp.Height }
        
        $bw.Write($w)
        $bw.Write($h)
        $bw.Write([byte]0) # Palette colors
        $bw.Write([byte]0) # Reserved
        $bw.Write([uint16]1) # Color planes
        $bw.Write([uint16]32) # Bits per pixel
        $bw.Write([uint32]$dataLen)
        $bw.Write([uint32]$offset)
        
        $offset += $dataLen
    }
    
    for ($i = 0; $i -lt $msList.Count; $i++) {
        $bytes = $msList[$i].ToArray()
        $bw.Write($bytes)
        $msList[$i].Dispose()
    }
    
    $bw.Flush()
    $bw.Dispose()
    $fs.Dispose()
    Write-Host "Generated Multi-Res ICO: $targetIcoPath"
}

# 2. Update public square PNG assets
$publicDir = "C:\Users\wattz\MYWAY-GPS\public"
$master512.Save("$publicDir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$master512.Save("$publicDir\logo.png", [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Updated public/icon.png and public/logo.png to 512x512 clean square assets"

# 3. Generate Multi-Resolution favicon.ico
$icoSizes = @(16, 32, 48, 64, 128, 256)
$icoBitmaps = @()
foreach ($s in $icoSizes) {
    $icoBitmaps += (Get-ResizedBitmap $master512 $s $s)
}
New-IcoFromPngs $icoBitmaps "$publicDir\favicon.ico"

# Sync to dist if exists
$distDir = "C:\Users\wattz\MYWAY-GPS\dist"
if (Test-Path $distDir) {
    Copy-Item "$publicDir\favicon.ico" "$distDir\favicon.ico" -Force
    Copy-Item "$publicDir\icon.png" "$distDir\icon.png" -Force
    Copy-Item "$publicDir\logo.png" "$distDir\logo.png" -Force
    Write-Host "Synced assets to dist/"
}

foreach ($b in $icoBitmaps) { $b.Dispose() }

# 4. Android mipmap densities and sizes
$androidMipmaps = @{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
}

$resBase = "C:\Users\wattz\MYWAY-GPS\android\app\src\main\res"

foreach ($entry in $androidMipmaps.GetEnumerator()) {
    $folder = $entry.Key
    $size = $entry.Value
    
    $targetLauncher = Join-Path $resBase "$folder\ic_launcher.png"
    $targetRound = Join-Path $resBase "$folder\ic_launcher_round.png"
    $targetForeground = Join-Path $resBase "$folder\ic_launcher_foreground.png"
    
    Save-ResizedImage $master512 $size $size $targetLauncher
    Save-ResizedImage $master512 $size $size $targetRound
    Save-ResizedImage $master512 $size $size $targetForeground
}

# 5. Google Play Store 512x512 Icon
$playStoreIcon = "C:\Users\wattz\MYWAY-GPS\android\playstore_icon_512.png"
Save-ResizedImage $master512 512 512 $playStoreIcon

$master512.Dispose()
Write-Host "All web, PWA, and Android app icons successfully generated and synchronized with the NEW icon!"
