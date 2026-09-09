param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][ValidateSet('GodotWindows','MinGit')][string]$Kind
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$runtimeTarget = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $runtimeTarget -PathType Container)) { throw 'EXTRACT_TARGET_REQUIRED' }
if (@(Get-ChildItem -LiteralPath $runtimeTarget -Force).Count -ne 0) { throw 'EXTRACT_TARGET_NOT_EMPTY' }
$runtimeAncestor = Get-Item -LiteralPath $runtimeTarget -Force
while ($null -ne $runtimeAncestor) {
    if (($runtimeAncestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'EXTRACT_LINK_DENIED' }
    $runtimeAncestor = $runtimeAncestor.Parent
}
$runtimeZip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive))
try {
    $runtimeSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $runtimeCount = 0
    $runtimeTotal = [long]0
    foreach ($runtimeEntry in $runtimeZip.Entries) {
        $runtimeName = $runtimeEntry.FullName
        if ($Kind -eq 'GodotWindows' -and $runtimeName -notin @('templates/windows_release_x86_64.exe','templates/windows_debug_x86_64.exe')) { continue }
        $runtimeRelative = if ($Kind -eq 'GodotWindows') { $runtimeName.Substring(10) } else { $runtimeName.TrimEnd('/') }
        if (-not $runtimeRelative -or $runtimeRelative.Contains('\') -or $runtimeRelative.Contains(':') -or $runtimeRelative.StartsWith('/')) { throw 'EXTRACT_INVALID_PATH' }
        foreach ($runtimePart in $runtimeRelative.Split('/')) {
            if (-not $runtimePart -or $runtimePart -in @('.','..') -or $runtimePart -match '[. ]$|[\x00-\x1f]' -or $runtimePart -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'EXTRACT_INVALID_PATH' }
        }
        # Refuse symbolic links in ZIP external Unix mode, and Windows reparse attributes.
        $runtimeMode = ($runtimeEntry.ExternalAttributes -shr 16) -band 61440
        if ($runtimeMode -eq 40960 -or ($runtimeEntry.ExternalAttributes -band 1024) -ne 0) { throw 'EXTRACT_LINK_DENIED' }
        $runtimeFile = [IO.Path]::GetFullPath((Join-Path $runtimeTarget $runtimeRelative))
        if (-not $runtimeFile.StartsWith($runtimeTarget + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'EXTRACT_PATH_ESCAPE' }
        if (-not $runtimeSeen.Add($runtimeRelative)) { throw 'EXTRACT_DUPLICATE_PATH' }
        $runtimeCount++
        $runtimeTotal += $runtimeEntry.Length
        if ($runtimeCount -gt 20000 -or $runtimeEntry.Length -gt 536870912 -or $runtimeTotal -gt 2147483648) { throw 'EXTRACT_BUDGET_EXCEEDED' }
        if ($runtimeName.EndsWith('/')) {
            [IO.Directory]::CreateDirectory($runtimeFile) | Out-Null
            continue
        }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($runtimeFile)) | Out-Null
        $runtimeInput = $runtimeEntry.Open()
        $runtimeOutput = [IO.File]::Open($runtimeFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $runtimeInput.CopyTo($runtimeOutput) } finally { $runtimeOutput.Dispose(); $runtimeInput.Dispose() }
        if ((Get-Item -LiteralPath $runtimeFile).Length -ne $runtimeEntry.Length) { throw 'EXTRACT_LENGTH_MISMATCH' }
    }
    if ($Kind -eq 'GodotWindows' -and $runtimeCount -ne 2) { throw 'GODOT_WINDOWS_TEMPLATES_MISSING' }
    [ordered]@{kind=$Kind;files=$runtimeCount;bytes=$runtimeTotal} | ConvertTo-Json -Compress
} finally { $runtimeZip.Dispose() }
