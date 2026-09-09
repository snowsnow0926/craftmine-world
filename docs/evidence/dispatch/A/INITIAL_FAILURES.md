# Observed initial failures

These are human-readable records of earlier tool output, not reconstructed raw
logs or final acceptance results.

1. `node --test tests/dispatch/a/domain-process.test.mjs` initially reported
   `BEHAVIORS_REQUIRED` in the tree fixture. The fixture build omitted the explicit
   empty compiled-behavior array required by the real Rust verification boundary.
   Added `behaviors: compiled.behaviors || []` to the fixture builder; no production
   acceptance gate was weakened.
2. The creation fixture initially asserted two behaviors after installing the D
   garden twice. Actual output was four because the package contains two scripts.
   The test now checks `payload.scripts.length * 2` and validates every script's
   code/target bindings, rather than assuming one script.
3. The first compile of new Rust accounting code used u64 directly as SQLite
   input/output. rusqlite 0.40 rejects that type. Storage conversions use bounded
   signed values, and tests were rerun. No dependency or shared lockfile changed.
4. An initial `cargo fmt -p craftmine-core` was invoked at the repository root,
   which has no Cargo.toml. Subsequent formatting/build commands explicitly use
   `--manifest-path vendor/pi-desktop/Cargo.toml`.

Final raw logs are adjacent `rust-tests.log`, `build.log`, and
`process-tests.log`, tied to the frozen implementation commit in the manifest.
