# Regenerates the S4 durable-portable-backup evidence bundle.
#
# Runs in an isolated Cargo target directory and writes every raw output into
# docs/dispatch-reports/godot-round3/S4/evidence/. It never sends input events,
# never activates a window, never touches user data and never runs
# tests/browser.mjs or tests/modules-browser.mjs.
#
# The durability tests start their own child process per persistent boundary and
# end it abruptly inside the restore; the memory measurement runs a single
# ignored test in its own process.
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$crate = Join-Path $root "vendor\pi-desktop"
$evidence = Join-Path $root "docs\dispatch-reports\godot-round3\S4\evidence"
$target = Join-Path $env:PI_SCRATCH_DIR "cargo-target-s4"

New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$env:CARGO_TARGET_DIR = $target

Push-Location $crate
try {
    @(
        "commit=$(git -C $root rev-parse HEAD)",
        "branch=$(git -C $root rev-parse --abbrev-ref HEAD)",
        "rustc=$(rustc --version)",
        "cargo=$(cargo --version)",
        "engine=none (no Godot engine in this bundle)",
        "broker=none (core crate only)",
        "plugin=none (core crate only)"
    ) | Out-File -Encoding utf8 (Join-Path $evidence "identity.txt")

    cargo test -p craftmine-core --lib backups::domain_tests 2>&1 |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-s4-domain-tests.txt")
    cargo test -p craftmine-core --lib backups::portable::tests 2>&1 |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-s4-portable-tests.txt")
    cargo test -p craftmine-core --lib backups::portable::durability_tests 2>&1 |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-s4-durability-tests.txt")
    cargo test -p craftmine-core 2>&1 |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-s4-full-crate-tests.txt")

    # Peak memory of one export with a repository whose object stream is larger
    # than the old 64 MiB buffering cap.
    $exe = (cargo test -p craftmine-core --lib --no-run --message-format=json 2>$null |
        ForEach-Object { $_ | ConvertFrom-Json } |
        Where-Object { $_.reason -eq 'compiler-artifact' -and $_.executable } |
        Select-Object -Last 1).executable
    $peak = 0
    $process = Start-Process -FilePath $exe `
        -ArgumentList 'backups::portable::tests::a_repository_larger_than_the_buffered_stdout_cap_exports_and_verifies','--ignored','--nocapture','--test-threads=1' `
        -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $evidence "rust-s4-memory-stdout.txt")
    while (-not $process.HasExited) {
        $process.Refresh()
        if ($process.PeakPagedMemorySize64 -gt $peak) { $peak = $process.PeakPagedMemorySize64 }
        Start-Sleep -Milliseconds 10
    }
    "peakPrivateMiB={0:N1}" -f ($peak / 1MB) |
        Out-File -Encoding utf8 (Join-Path $evidence "rust-s4-memory-peak.txt")
}
finally {
    Pop-Location
}

Get-ChildItem $evidence -Filter "rust-s4-*.txt" | ForEach-Object {
    Select-String -Path $_.FullName -Pattern "test result|peak|marginal" |
        ForEach-Object { "$($_.Filename): $($_.Line.Trim())" }
}
Get-Content (Join-Path $evidence "rust-s4-memory-peak.txt")
