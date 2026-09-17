param([switch]$Release)
$ErrorActionPreference = 'Stop'
$versionRoot = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $versionRoot '.build-tools'
$jdkDir = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory | Select-Object -First 1
$env:JAVA_HOME = $jdkDir.FullName
$env:ANDROID_HOME = Join-Path $toolRoot 'sdk'
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-cache'
$buildTask = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
& (Join-Path $toolRoot 'gradle-8.9/bin/gradle.bat') -p (Join-Path $versionRoot 'android') --no-daemon $buildTask testDebugUnitTest
if ($LASTEXITCODE -ne 0) { throw 'Android build or tests failed' }
