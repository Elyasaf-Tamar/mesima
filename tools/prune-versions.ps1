param(
    [Parameter(Mandatory=$true)][string]$KeepVersion,
    [string]$WorkspaceRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path -LiteralPath $WorkspaceRoot).Path.TrimEnd('\')
$currentPath = (Resolve-Path -LiteralPath (Join-Path $workspacePath "App Version $KeepVersion")).Path
if ([IO.Path]::GetDirectoryName($currentPath) -ne $workspacePath) { throw 'Current version is outside the workspace' }
$keep = [version]$KeepVersion
if (!(Test-Path -LiteralPath (Join-Path $currentPath 'desktop/dist/Mesima-win32-x64/Mesima.exe'))) { throw 'Windows build is missing' }
if (!(Get-ChildItem -LiteralPath $currentPath -File -Filter "Mesima-$KeepVersion-Android-*.apk")) { throw 'Signed APK is missing' }
foreach ($required in @('.mesima-build-tools/android', '.mesima-build-tools/node_modules', '.mesima-private/mesima.jks', '.mesima-private/original-4.4')) {
    if (!(Test-Path -LiteralPath (Join-Path $workspacePath $required))) { throw "Shared dependency is missing: $required" }
}
# A running old version must be exited by its user, never force-killed for cleanup.
$runningPaths = @(Get-CimInstance Win32_Process -Filter "Name = 'Mesima.exe'" | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ })
$historyPath = Join-Path $workspacePath '.mesima-private/source-history'
$documentsPath = Join-Path $workspacePath 'Project Documents'
if ($Apply) {
    New-Item -ItemType Directory -Path $historyPath,$documentsPath -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $shortcutShell = New-Object -ComObject WScript.Shell
    $shortcut = $shortcutShell.CreateShortcut((Join-Path $workspacePath 'Mesima.lnk'))
    $shortcut.TargetPath = Join-Path $currentPath 'desktop/dist/Mesima-win32-x64/Mesima.exe'
    $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($shortcut.TargetPath)
    $shortcut.Save()
}
$results = @()
foreach ($folder in (Get-ChildItem -LiteralPath $workspacePath -Directory)) {
    if ($folder.Name -notmatch '^App Version (\d+\.\d+(?:\.\d+)?)$') { continue }
    if ([version]$Matches[1] -ge $keep) { continue }
    $targetPath = (Resolve-Path -LiteralPath $folder.FullName).Path
    if ([IO.Path]::GetDirectoryName($targetPath) -ne $workspacePath -or $targetPath -eq $currentPath) { throw 'Invalid cleanup target' }
    if ($runningPaths | Where-Object { $_.StartsWith($targetPath + '\', [StringComparison]::OrdinalIgnoreCase) }) {
        $results += [PSCustomObject]@{ Folder=$folder.Name; Status='Skipped: app is running'; FreedBytes=0 }
        continue
    }
    $files = @(Get-ChildItem -LiteralPath $targetPath -File -Recurse -Force)
    $links = @(Get-ChildItem -LiteralPath $targetPath -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if (($folder.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $links.Count) { throw "Reparse point found; manual review required: $targetPath" }
    $bytes = ($files | Measure-Object -Property Length -Sum).Sum
    if (!$Apply) {
        $results += [PSCustomObject]@{ Folder=$folder.Name; Status='Planned'; FreedBytes=$bytes }
        continue
    }
    $zipPath = Join-Path $historyPath ($folder.Name.Replace(' ','-') + '-source.zip')
    if (Test-Path -LiteralPath $zipPath) { throw "Preservation archive already exists: $zipPath" }
    $preserved = @()
    $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($targetPath.Length + 1)
            # Keep source and documents; discard reproducible builds/caches and downloads.
            if ($relative -match '(^|\\)(\.git|\.build-tools|node_modules|build|dist|\.gradle|\.kotlin|test-results|tmp|Windows-Download|Mesima-[^\\]+-Windows)(\\|$)') { continue }
            if ($file.Extension -in @('.apk','.aab','.zip','.exe','.dll','.log')) { continue }
            if ($file.Extension -in @('.jks','.keystore')) {
                if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $workspacePath '.mesima-private/mesima.jks')).Hash) { throw 'Different signing key: preserve and review before deleting' }
                continue
            }
            $entryName = $relative.Replace('\','/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
            $preserved += [PSCustomObject]@{ Path=$file.FullName; Entry=$entryName; Hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
            if ($file.Extension -eq '.docx' -or $file.Name -match 'SECURITY|Security-Review') {
                $document = Join-Path (Join-Path $documentsPath $folder.Name) $relative
                New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($document)) -Force | Out-Null
                Copy-Item -LiteralPath $file.FullName -Destination $document
                if ((Get-FileHash -LiteralPath $document).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw 'Document copy mismatch' }
            }
        }
    } finally { $zip.Dispose() }
    # Read every preserved entry back and compare it before any deletion.
    $verify = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($saved in $preserved) {
            $stream = $verify.GetEntry($saved.Entry).Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
            finally { $sha.Dispose(); $stream.Dispose() }
            if ($digest -ne $saved.Hash) { throw "Source preservation mismatch: $($saved.Entry)" }
        }
    } finally { $verify.Dispose() }
    # Recheck the exact absolute path and process state immediately before recursive deletion.
    if ((Resolve-Path -LiteralPath $targetPath).Path -ne $targetPath -or [IO.Path]::GetDirectoryName($targetPath) -ne $workspacePath) { throw 'Target changed' }
    $active = Get-CimInstance Win32_Process -Filter "Name = 'Mesima.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($targetPath + '\', [StringComparison]::OrdinalIgnoreCase) }
    if ($active) { throw "Application started in $targetPath; deletion stopped" }
    Remove-Item -LiteralPath $targetPath -Recurse -Force
    $results += [PSCustomObject]@{ Folder=$folder.Name; Status='Removed after verified source preservation'; FreedBytes=($bytes-(Get-Item -LiteralPath $zipPath).Length) }
}
$results
if ($Apply) { $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $currentPath 'VERSION-CLEANUP.json') -Encoding UTF8 }
