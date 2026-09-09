param(
    [ValidateSet('Snapshot','Verify')][string]$Mode = 'Snapshot',
    [string]$ProfileDir,
    [string]$BackupDir,
    [string]$BuildId = 'development'
)
$ErrorActionPreference = 'Stop'
function Get-CraftmineFileHash([string]$LiteralPath) {
    $craftmineHashStream = [IO.File]::OpenRead($LiteralPath)
    $craftmineHasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($craftmineHasher.ComputeHash($craftmineHashStream)).Replace('-','').ToLowerInvariant() }
    finally { $craftmineHasher.Dispose(); $craftmineHashStream.Dispose() }
}
$craftmineStreams = New-Object 'System.Collections.Generic.List[System.IDisposable]'
try {
    if ($BuildId -notmatch '^[A-Za-z0-9.+_-]{1,80}$') { throw 'INVALID_BUILD_ID' }
    if ($Mode -eq 'Verify') {
        if (-not [IO.Path]::IsPathRooted($BackupDir)) { throw 'ABSOLUTE_BACKUP_REQUIRED' }
        $craftmineBackupRoot = (Resolve-Path -LiteralPath $BackupDir).Path
        $craftmineManifest = Get-Content -LiteralPath (Join-Path $craftmineBackupRoot 'manifest.json') -Raw | ConvertFrom-Json
        if ($craftmineManifest.format -ne 'craftmine.offline-upgrade/1' -or $craftmineManifest.schemaVersion -ne 1) { throw 'UPGRADE_BACKUP_UNSUPPORTED' }
        foreach ($craftmineFile in $craftmineManifest.files) {
            $craftmineTarget = [IO.Path]::GetFullPath((Join-Path $craftmineBackupRoot $craftmineFile.path))
            if (-not $craftmineTarget.StartsWith($craftmineBackupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'UPGRADE_BACKUP_PATH_INVALID' }
            $craftmineItem = Get-Item -LiteralPath $craftmineTarget -Force
            if ($craftmineItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'UPGRADE_BACKUP_LINK_DENIED' }
            if ($craftmineItem.Length -ne $craftmineFile.bytes -or (Get-CraftmineFileHash $craftmineTarget) -ne $craftmineFile.sha256) { throw 'UPGRADE_BACKUP_CORRUPT' }
        }
        Write-Output 'UPGRADE_BACKUP_VERIFIED'
        exit 0
    }
    if (-not $ProfileDir) {
        $ProfileDir = if ($env:CRAFTMINE_DATA_DIR) { $env:CRAFTMINE_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'CraftmineWorld' }
    }
    if (-not [IO.Path]::IsPathRooted($ProfileDir)) { throw 'ABSOLUTE_PROFILE_REQUIRED' }
    if (-not (Test-Path -LiteralPath $ProfileDir)) { Write-Output 'NEW_PROFILE_NO_BACKUP_REQUIRED'; exit 0 }
    $craftmineProfileRoot = (Resolve-Path -LiteralPath $ProfileDir).Path
    if ((Get-Item -LiteralPath $craftmineProfileRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PROFILE_LINK_DENIED' }
    $craftmineCandidates = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
    foreach ($craftmineName in @('pi.sqlite','pi.sqlite-wal','pi.sqlite-shm')) {
        $craftmineFilePath = Join-Path $craftmineProfileRoot $craftmineName
        if (Test-Path -LiteralPath $craftmineFilePath) { $craftmineCandidates.Add((Get-Item -LiteralPath $craftmineFilePath -Force)) }
    }
    $craftmineDomainDir = Join-Path $craftmineProfileRoot 'plugins/data/craftmine.world'
    if (Test-Path -LiteralPath $craftmineDomainDir) {
        foreach ($craftminePart in @('plugins','plugins/data','plugins/data/craftmine.world')) {
            if ((Get-Item -LiteralPath (Join-Path $craftmineProfileRoot $craftminePart) -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PROFILE_LINK_DENIED' }
        }
        $craftmineQueue = New-Object 'System.Collections.Generic.Queue[string]'
        $craftmineQueue.Enqueue($craftmineDomainDir)
        $craftmineVisited = 0
        while ($craftmineQueue.Count -gt 0) {
            foreach ($craftmineItem in (Get-ChildItem -LiteralPath $craftmineQueue.Dequeue() -Force)) {
                $craftmineVisited++
                if ($craftmineVisited -gt 10000) { throw 'UPGRADE_BACKUP_TOO_LARGE' }
                if ($craftmineItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PROFILE_LINK_DENIED' }
                if ($craftmineItem.PSIsContainer) { $craftmineQueue.Enqueue($craftmineItem.FullName) }
                else { $craftmineCandidates.Add($craftmineItem) }
            }
        }
    }
    if ($craftmineCandidates.Count -gt 10000 -or ($craftmineCandidates | Measure-Object -Property Length -Sum).Sum -gt 536870912) { throw 'UPGRADE_BACKUP_TOO_LARGE' }
    # Hold every source handle exclusively until the snapshot is durable.
    # A running host/SQLite writer therefore blocks the upgrade, not vice versa.
    foreach ($craftmineItem in $craftmineCandidates) {
        if ($craftmineItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PROFILE_LINK_DENIED' }
        $craftmineStreams.Add([IO.File]::Open($craftmineItem.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None))
    }
    $craftmineBackupParent = Join-Path $craftmineProfileRoot 'upgrade-backups'
    if ((Test-Path -LiteralPath $craftmineBackupParent) -and ((Get-Item -LiteralPath $craftmineBackupParent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'BACKUP_DIRECTORY_LINK_DENIED' }
    $craftmineBackupRoot = Join-Path $craftmineBackupParent ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $craftmineBackupRoot -Force | Out-Null
    $craftmineFiles = @()
    for ($craftmineIndex = 0; $craftmineIndex -lt $craftmineCandidates.Count; $craftmineIndex++) {
        $craftmineItem = $craftmineCandidates[$craftmineIndex]
        $craftmineRelative = $craftmineItem.FullName.Substring($craftmineProfileRoot.Length + 1)
        $craftmineTarget = [IO.Path]::GetFullPath((Join-Path $craftmineBackupRoot $craftmineRelative))
        if (-not $craftmineTarget.StartsWith($craftmineBackupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'UPGRADE_BACKUP_PATH_INVALID' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $craftmineTarget) -Force | Out-Null
        $craftmineOutput = [IO.File]::Open($craftmineTarget, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $craftmineStreams[$craftmineIndex].CopyTo($craftmineOutput); $craftmineOutput.Flush($true) } finally { $craftmineOutput.Dispose() }
        $craftmineFiles += @{ path = $craftmineRelative.Replace('\','/'); bytes = (Get-Item -LiteralPath $craftmineTarget).Length; sha256 = (Get-CraftmineFileHash $craftmineTarget) }
    }
    $craftmineManifest = @{format='craftmine.offline-upgrade/1';schemaVersion=1;targetBuild=$BuildId;createdAt=[DateTime]::UtcNow.ToString('o');credentialsIncluded=$false;files=@($craftmineFiles);modelReplay=$false}
    $craftmineManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $craftmineBackupRoot 'manifest.json') -Encoding UTF8
    Write-Output 'UPGRADE_BACKUP_CREATED'
} catch {
    # Error categories only: installer logs do not include private paths.
    [Console]::Error.WriteLine('CRAFTMINE_UPGRADE_GUARD_FAILED: Close Craftmine World and retry. Existing profile files were not modified. Category: ' + $_.Exception.GetType().Name)
    exit 2
} finally {
    foreach ($craftmineStream in $craftmineStreams) { $craftmineStream.Dispose() }
}
