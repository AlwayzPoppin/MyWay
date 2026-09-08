Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   MyWay GPS - Build Signed Release Bundle   " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$projectRoot = $PSScriptRoot
Set-Location $projectRoot

# Detect Java / JBR if not configured
if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) {
    $potentialJvms = @(
        "C:\Program Files\Android\Android Studio1\jbr",
        "C:\Program Files\Android\Android Studio\jbr",
        "C:\Program Files\Android\Android Studio1\jre",
        "C:\Program Files\Android\Android Studio\jre"
    )
    foreach ($jvm in $potentialJvms) {
        if (Test-Path $jvm) {
            $env:JAVA_HOME = $jvm
            $env:PATH = "$jvm\bin;$env:PATH"
            Write-Host "Auto-configured JAVA_HOME: $jvm" -ForegroundColor Cyan
            break
        }
    }
}

# Fix local.properties on Windows if pointing to Linux container paths
$localPropPath = "$projectRoot\android\local.properties"
$defaultWindowsSdk = "$env:LOCALAPPDATA\Android\Sdk"
if (Test-Path $defaultWindowsSdk) {
    $escapedSdk = $defaultWindowsSdk.Replace('\', '\\')
    Set-Content -Path $localPropPath -Value "sdk.dir=$escapedSdk"
    Write-Host "Configured Android SDK location: $defaultWindowsSdk" -ForegroundColor Cyan
} elseif (Test-Path $localPropPath) {
    $content = Get-Content $localPropPath -Raw
    if ($content -match "/opt/android-sdk") {
        Remove-Item -Path $localPropPath -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n[1/3] Building Web Assets (Vite)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Web build failed! Please fix errors and try again." -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/3] Syncing Capacitor Android Assets..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Host "Capacitor sync failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n[3/3] Compiling Signed Android App Bundle (AAB)..." -ForegroundColor Yellow
Set-Location "$projectRoot\android"
.\gradlew.bat bundleRelease
if ($LASTEXITCODE -ne 0) {
    Write-Host "Gradle bundleRelease failed!" -ForegroundColor Red
    Set-Location $projectRoot
    exit 1
}

Set-Location $projectRoot

$outputAab = "$projectRoot\android\app\build\outputs\bundle\release\app-release.aab"
$rootAab = "$projectRoot\app-release.aab"

if (Test-Path $outputAab) {
    Copy-Item -Path $outputAab -Destination $rootAab -Force
    $fileItem = Get-Item $rootAab
    $sizeMb = [math]::Round($fileItem.Length / 1MB, 2)
    Write-Host "`n=============================================" -ForegroundColor Green
    Write-Host " SUCCESS! NEW SIGNED AAB GENERATED!" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "Root File:    $rootAab" -ForegroundColor White
    Write-Host "Gradle Path:  $outputAab" -ForegroundColor White
    Write-Host "Size:         $sizeMb MB" -ForegroundColor White
    Write-Host "Modified:     $($fileItem.LastWriteTime)" -ForegroundColor White
    Write-Host "`nYou can now upload '$rootAab' directly to Google Play Console!" -ForegroundColor Green
} else {
    Write-Host "Could not find generated AAB at: $outputAab" -ForegroundColor Red
}
