param([switch]$Installer)
$ErrorActionPreference = 'Stop'
$craftmineRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $craftmineRoot
try {
    $craftmineChanges = git status --porcelain --untracked-files=normal
    if ($craftmineChanges) { throw 'Commit source changes before packaging so the source archive matches the binary.' }
    node desktop/prepare-client.mjs
    if ($LASTEXITCODE -ne 0) { throw 'World plugin build failed' }
    git archive --format=zip --output=desktop/build/CraftmineWorld-source.zip HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Source archive failed' }
    Push-Location -LiteralPath (Join-Path $craftmineRoot 'vendor/pi-desktop')
    try {
        cargo build --release --locked -p host-core -p craftmine-core
        if ($LASTEXITCODE -ne 0) { throw 'Rust build failed' }
        pnpm build:js
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
        pnpm --filter @pi-desktop/agent-runtime bundle
        if ($LASTEXITCODE -ne 0) { throw 'Agent bundle failed' }
        if ($Installer) { pnpm --filter @pi-desktop/desktop exec electron-builder --win --publish never }
        else { pnpm --filter @pi-desktop/desktop exec electron-builder --win --dir --publish never }
        if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
