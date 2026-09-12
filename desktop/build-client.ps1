param(
    [switch]$Installer,
    [Parameter(Mandatory=$true)][string]$GodotCache,
    [Parameter(Mandatory=$true)][string]$GitArchive,
    [Parameter(Mandatory=$true)][string]$BlenderCache,
    [string]$ArchiveTool,
    [string]$ArchiveToolSha256,
    [string]$ArchiveLibrarySha256
)
$ErrorActionPreference = 'Stop'
$craftmineRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $craftmineRoot
try {
    if ($Installer -and (-not $ArchiveTool -or $ArchiveToolSha256 -notmatch '^[a-f0-9]{64}$' -or $ArchiveLibrarySha256 -notmatch '^[a-f0-9]{64}$')) {
        throw 'Installer payload verification requires a pinned full 7z.exe and 7z.dll: -ArchiveTool, -ArchiveToolSha256 and -ArchiveLibrarySha256.'
    }
    $craftmineChanges = git status --porcelain --untracked-files=normal
    if ($craftmineChanges) { throw 'Commit source changes before packaging so the source archive matches the binary.' }
    $craftmineBuildCommit = git rev-parse HEAD
    $craftmineGodotCache = (Resolve-Path -LiteralPath $GodotCache).Path
    $craftmineGitArchive = (Resolve-Path -LiteralPath $GitArchive).Path
    $craftmineBlenderCache = (Resolve-Path -LiteralPath $BlenderCache).Path
    $craftmineBrokerTarget = Join-Path $craftmineRoot 'desktop/godot/sandbox/target'
    cargo build --manifest-path desktop/godot/sandbox/Cargo.toml --target-dir $craftmineBrokerTarget --release --locked --bin godot-host-broker --bin blender-host-broker
    if ($LASTEXITCODE -ne 0) { throw 'Release Godot broker build failed' }
    node desktop/prepare-runtime-resources.mjs --godot-cache $craftmineGodotCache --git-zip $craftmineGitArchive --broker-bin (Join-Path $craftmineBrokerTarget 'release/godot-host-broker.exe') --blender-cache $craftmineBlenderCache --blender-broker-bin (Join-Path $craftmineBrokerTarget 'release/blender-host-broker.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Pinned runtime resource staging failed' }
    node desktop/prepare-client.mjs
    if ($LASTEXITCODE -ne 0) { throw 'World plugin build failed' }
    git archive --format=zip --output=desktop/build/CraftmineWorld-source.zip HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Source archive failed' }
    Push-Location -LiteralPath (Join-Path $craftmineRoot 'vendor/pi-desktop')
    try {
        cargo build --release --locked -p host-core -p craftmine-core
        if ($LASTEXITCODE -ne 0) { throw 'Rust build failed' }
        # A shared Cargo cache is useful for isolated worktrees. Packaging still
        # reads these two executables from its declared local resource paths.
        if ($env:CARGO_TARGET_DIR) {
            $craftmineCargoOutput = (Resolve-Path -LiteralPath $env:CARGO_TARGET_DIR).Path
            $craftminePackageOutput = Join-Path $craftmineRoot 'vendor/pi-desktop/target'
            if ($craftmineCargoOutput -ne $craftminePackageOutput) {
                $craftminePackageRelease = Join-Path $craftminePackageOutput 'release'
                New-Item -ItemType Directory -Path $craftminePackageRelease -Force | Out-Null
                foreach ($craftmineBinary in @('pi-desktop-host-core.exe', 'craftmine-core.exe')) {
                    Copy-Item -LiteralPath (Join-Path $craftmineCargoOutput "release/$craftmineBinary") -Destination (Join-Path $craftminePackageRelease $craftmineBinary)
                }
            }
        }
        pnpm build:js
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
        pnpm --filter @pi-desktop/agent-runtime bundle
        if ($LASTEXITCODE -ne 0) { throw 'Agent bundle failed' }
        node (Join-Path $craftmineRoot 'desktop/windows-package-tools.mjs') manifest
        if ($LASTEXITCODE -ne 0) { throw 'Build manifest failed' }
        $craftmineBeginArgs = @((Join-Path $craftmineRoot 'desktop/windows-package-tools.mjs'), 'begin-release')
        if ($Installer) { $craftmineBeginArgs += @('--installer', '--archive-tool', (Resolve-Path -LiteralPath $ArchiveTool).Path, '--archive-tool-sha256', $ArchiveToolSha256, '--archive-library-sha256', $ArchiveLibrarySha256) }
        $craftmineReleaseJson = node @craftmineBeginArgs
        if ($LASTEXITCODE -ne 0) { throw 'Release output reservation failed' }
        $craftmineRelease = $craftmineReleaseJson | ConvertFrom-Json
        $craftmineOutputArgument = '--config.directories.output=' + $craftmineRelease.output
        if ($Installer) { pnpm --filter @pi-desktop/desktop exec electron-builder --win --publish never $craftmineOutputArgument }
        else { pnpm --filter @pi-desktop/desktop exec electron-builder --win --dir --publish never $craftmineOutputArgument }
        if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
        node (Join-Path $craftmineRoot 'desktop/windows-package-tools.mjs') seal-release --run $craftmineRelease.runFile
        if ($LASTEXITCODE -ne 0) { throw 'Release output sealing failed' }
        node (Join-Path $craftmineRoot 'desktop/windows-package-tools.mjs') verify --run $craftmineRelease.runFile
        if ($LASTEXITCODE -ne 0) { throw 'Package integrity verification failed' }
        if ((git rev-parse HEAD) -ne $craftmineBuildCommit -or (git status --porcelain --untracked-files=normal)) {
            throw 'Source changed during packaging; discard this verification result and rebuild from a clean commit.'
        }
    } finally { Pop-Location }
} finally { Pop-Location }
