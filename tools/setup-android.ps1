$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$toolRoot = Join-Path (Split-Path $PSScriptRoot -Parent) '.build-tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
function Get-CheckedArchive($url, $destination, $checksum) {
    if (!(Test-Path -LiteralPath $destination)) {
        Write-Output "Downloading $([IO.Path]::GetFileName($destination))"
        Invoke-WebRequest -Uri $url -OutFile $destination
    }
    if ($checksum -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLower() -ne $checksum.Trim().ToLower()) {
        throw "Checksum mismatch: $destination"
    }
}
if (!(Test-Path -LiteralPath (Join-Path $toolRoot 'jdk'))) {
    $asset = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows'
    $package = $asset[0].binary.package
    Get-CheckedArchive $package.link (Join-Path $toolRoot 'jdk.zip') $package.checksum
    Expand-Archive -LiteralPath (Join-Path $toolRoot 'jdk.zip') -DestinationPath (Join-Path $toolRoot 'jdk')
}
$jdkDir = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory | Select-Object -First 1
$env:JAVA_HOME = $jdkDir.FullName
$env:ANDROID_HOME = Join-Path $toolRoot 'sdk'
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-cache'
if (!(Test-Path -LiteralPath (Join-Path $toolRoot 'gradle-8.9'))) {
    $checksum = Invoke-RestMethod 'https://services.gradle.org/distributions/gradle-8.9-bin.zip.sha256'
    Get-CheckedArchive 'https://services.gradle.org/distributions/gradle-8.9-bin.zip' (Join-Path $toolRoot 'gradle.zip') $checksum
    Expand-Archive -LiteralPath (Join-Path $toolRoot 'gradle.zip') -DestinationPath $toolRoot
}
if (!(Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'cmdline-tools/bin/sdkmanager.bat'))) {
    Get-CheckedArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' (Join-Path $toolRoot 'sdk-tools.zip') '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    Expand-Archive -LiteralPath (Join-Path $toolRoot 'sdk-tools.zip') -DestinationPath $env:ANDROID_HOME
}
$sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools/bin/sdkmanager.bat'
1..20 | ForEach-Object { 'y' } | & $sdkManager "--sdk_root=$env:ANDROID_HOME" --licenses | Out-Null
& $sdkManager "--sdk_root=$env:ANDROID_HOME" 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK setup failed' }
Write-Output 'Android build tools are ready in the version folder.'
