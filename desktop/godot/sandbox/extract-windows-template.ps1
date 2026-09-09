param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipArchive = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    $zipEntry = $zipArchive.GetEntry('templates/windows_release_x86_64.exe')
    if ($null -eq $zipEntry -or $zipEntry.Length -ne 109268480) { throw 'Windows template entry mismatch' }
    $entryStream = $zipEntry.Open()
    try {
        $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $entryStream.CopyTo($outputStream); $outputStream.Flush($true) } finally { $outputStream.Dispose() }
    } finally { $entryStream.Dispose() }
} finally { $zipArchive.Dispose() }
