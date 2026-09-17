$ErrorActionPreference = 'Stop'
$mesimaSource = Join-Path $PSScriptRoot 'desktop/dist/Mesima-win32-x64'
if (!(Test-Path -LiteralPath $mesimaSource)) { $mesimaSource=Join-Path $PSScriptRoot 'Mesima-win32-x64' }
$mesimaTarget = Join-Path $env:LOCALAPPDATA 'Programs/Mesima'
if (!(Test-Path -LiteralPath (Join-Path $mesimaSource 'Mesima.exe'))) { throw 'לא נמצאה תיקיית ההפצה. הפעל מתוך תיקיית גרסה 4.8.' }
if (Get-Process -Name Mesima -ErrorAction SilentlyContinue) { throw 'סגור את משימה דרך תפריט יציאה ונסה שוב.' }
New-Item -ItemType Directory -Path $mesimaTarget -Force | Out-Null
Copy-Item -Path (Join-Path $mesimaSource '*') -Destination $mesimaTarget -Recurse -Force
$mesimaShell = New-Object -ComObject WScript.Shell
foreach ($mesimaLinks in @([Environment]::GetFolderPath('Desktop'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))) {
    $mesimaLink = $mesimaShell.CreateShortcut((Join-Path $mesimaLinks 'Mesima.lnk'))
    $mesimaLink.TargetPath = Join-Path $mesimaTarget 'Mesima.exe'
    $mesimaLink.WorkingDirectory = $mesimaTarget
    $mesimaLink.Save()
}
Write-Output 'משימה הותקנה. פתח אותה מקיצור הדרך בשולחן העבודה.'
