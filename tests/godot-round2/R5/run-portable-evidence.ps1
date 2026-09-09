# Regenerates the R5 portable-archive evidence bundle.
#
# Runs in an isolated Cargo target directory and writes every raw output into
# docs/dispatch-reports/godot-round2/R5/evidence/. It never sends input events,
# never activates a window and never touches user data.
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$crate = Join-Path $root "vendor\pi-desktop"
$evidence = Join-Path $root "docs\dispatch-reports\godot-round2\R5\evidence"
$target = Join-Path $env:PI_SCRATCH_DIR "cargo-target-r5"

New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$env:CARGO_TARGET_DIR = $target
$env:R5_EVIDENCE_DIR = $evidence

Push-Location $crate
try {
    cargo test -p craftmine-core --lib backups::portable 2>&1 |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-portable-tests.txt")
    cargo test -p craftmine-core --lib backups::portable::tests::evidence -- --ignored --nocapture 2>&1 |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-portable-evidence.txt")
    cargo test -p craftmine-core 2>&1 |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-full-crate-tests.txt")
}
finally {
    Pop-Location
}

Get-Content (Join-Path $evidence "rust-portable-tests.txt") | Select-String "test result"
Get-Content (Join-Path $evidence "rust-full-crate-tests.txt") | Select-String "test result"
