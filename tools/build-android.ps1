param([switch]$Release)
$ErrorActionPreference = 'Stop'
$versionRoot = Split-Path $PSScriptRoot -Parent
$sharedRoot = if ($env:MESIMA_TOOLS_DIR) { $env:MESIMA_TOOLS_DIR } else { Join-Path (Split-Path $versionRoot -Parent) '.mesima-build-tools' }
$toolRoot = Join-Path $sharedRoot 'android'
if (!(Test-Path -LiteralPath (Join-Path $toolRoot 'jdk'))) { throw 'Run tools/setup-android.ps1 first, or set MESIMA_TOOLS_DIR to the shared tools directory.' }
$jdkDir = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory | Select-Object -First 1
$env:JAVA_HOME = $jdkDir.FullName
$env:ANDROID_HOME = Join-Path $toolRoot 'sdk'
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-cache'
$buildTask = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
& (Join-Path $toolRoot 'gradle-8.9/bin/gradle.bat') -p (Join-Path $versionRoot 'android') --no-daemon $buildTask testDebugUnitTest
if ($LASTEXITCODE -ne 0) { throw 'Android build or tests failed' }
