param([switch]$WithExportTemplates)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$godotLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.lock.json') -Encoding UTF8 -Raw | ConvertFrom-Json
foreach ($godotLicense in $godotLock.licenses) {
    if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $godotLicense.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $godotLicense.sha256) { throw 'Godot license bytes differ from the lock' }
}
$godotCache = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../build/godot/' + $godotLock.version)))
New-Item -ItemType Directory -Path $godotCache -Force | Out-Null

function Get-LockedGodotArtifact($Artifact) {
    if ($Artifact.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid pinned SHA256' }
    $godotArchive = Join-Path $godotCache $Artifact.file
    if (-not (Test-Path -LiteralPath $godotArchive)) {
        $godotPartial = $godotArchive + '.partial'
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri $Artifact.url -OutFile $godotPartial
        if ((Get-Item -LiteralPath $godotPartial).Length -ne $Artifact.bytes -or (Get-FileHash -LiteralPath $godotPartial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Artifact.sha256) {
            throw 'Downloaded Godot artifact differs from the lock; partial file retained for diagnosis'
        }
        Move-Item -LiteralPath $godotPartial -Destination $godotArchive
    }
    if ((Get-Item -LiteralPath $godotArchive).Length -ne $Artifact.bytes -or (Get-FileHash -LiteralPath $godotArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Artifact.sha256) {
        throw 'Cached Godot artifact differs from the lock'
    }
    return $godotArchive
}

$godotEditorArchive = Get-LockedGodotArtifact $godotLock.editor
$godotEditorDirectory = Join-Path $godotCache 'editor'
if (-not (Test-Path -LiteralPath $godotEditorDirectory)) {
    Expand-Archive -LiteralPath $godotEditorArchive -DestinationPath $godotEditorDirectory
}
$godotExecutable = Join-Path $godotEditorDirectory $godotLock.editor.executable
if (-not (Test-Path -LiteralPath $godotExecutable -PathType Leaf)) { throw 'Pinned editor executable is absent' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$godotZip = [IO.Compression.ZipFile]::OpenRead($godotEditorArchive)
$godotFiles = @()
try {
    foreach ($godotEntry in $godotZip.Entries) {
        if (-not $godotEntry.Name) { continue }
        $godotEntryPath = [IO.Path]::GetFullPath((Join-Path $godotEditorDirectory $godotEntry.FullName))
        if (-not $godotEntryPath.StartsWith($godotEditorDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes the editor directory' }
        $godotEntryStream = $godotEntry.Open()
        $godotHasher = [Security.Cryptography.SHA256]::Create()
        try { $godotEntryHash = [BitConverter]::ToString($godotHasher.ComputeHash($godotEntryStream)).Replace('-', '').ToLowerInvariant() }
        finally { $godotEntryStream.Dispose(); $godotHasher.Dispose() }
        if ((Get-FileHash -LiteralPath $godotEntryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $godotEntryHash) { throw 'Unpacked editor differs from the verified archive' }
        $godotFiles += @{path=$godotEntry.FullName;bytes=$godotEntry.Length;sha256=$godotEntryHash}
    }
} finally { $godotZip.Dispose() }
@{archiveSha256=$godotLock.editor.sha256;files=@($godotFiles)} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $godotCache 'unpacked-files.json') -Encoding UTF8
# Self-contained editor data stays next to this task-owned engine cache.
Set-Content -LiteralPath (Join-Path $godotEditorDirectory '_sc_') -Value '' -Encoding UTF8
if ($WithExportTemplates) {
    $godotTemplateArchive = Get-LockedGodotArtifact $godotLock.exportTemplates
    Write-Output ('Verified templates: ' + $godotTemplateArchive)
}
Write-Output ('Verified editor archive: ' + $godotEditorArchive)
Write-Output ('Editor executable: ' + $godotExecutable)
Write-Output 'No editor or game window has been opened.'
