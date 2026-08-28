Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\wattz\MYWAY-GPS\dist\favicon.ico"
$srcImage = [System.Drawing.Image]::FromFile($srcPath)

# 1. Update public web assets
Copy-Item $srcPath "C:\Users\wattz\MYWAY-GPS\public\logo.png" -Force
Copy-Item $srcPath "C:\Users\wattz\MYWAY-GPS\public\icon.png" -Force
Copy-Item $srcPath "C:\Users\wattz\MYWAY-GPS\public\favicon.ico" -Force

Write-Host "Updated public/logo.png, public/icon.png, public/favicon.ico"

# Function to resize and save image
function Resize-Image($image, $width, $height, $targetPath) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($image, 0, 0, $width, $height)
    $graphics.Dispose()
    
    $dir = [System.IO.Path]::GetDirectoryName($targetPath)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    
    $bmp.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated: $targetPath ($($width)x$($height))"
}

# Android mipmap densities and sizes
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
    
    Resize-Image $srcImage $size $size $targetLauncher
    Resize-Image $srcImage $size $size $targetRound
    Resize-Image $srcImage $size $size $targetForeground
}

# Also generate a 512x512 Google Play Store Hi-Res Icon
$playStoreIcon = "C:\Users\wattz\MYWAY-GPS\android\playstore_icon_512.png"
Resize-Image $srcImage 512 512 $playStoreIcon

$srcImage.Dispose()
Write-Host "All app icons successfully generated from favicon.ico!"
