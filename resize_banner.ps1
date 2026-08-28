Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\wattz\.gemini\antigravity-ide\brain\1573cedf-e7b5-443d-bffb-7a39fa40dda5\myway_playstore_feature_graphic_1787955467025.jpg"
$srcImg = [System.Drawing.Image]::FromFile($srcPath)
$destBmp = New-Object System.Drawing.Bitmap(1024, 500)
$g = [System.Drawing.Graphics]::FromImage($destBmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($srcImg, 0, 0, 1024, 500)
$g.Dispose()

$destPath = "C:\Users\wattz\MYWAY-GPS\android\playstore_feature_graphic_1024x500.png"
$destBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
$destBmp.Dispose()
$srcImg.Dispose()

Write-Host "Play Store feature graphic successfully created at: $destPath"
