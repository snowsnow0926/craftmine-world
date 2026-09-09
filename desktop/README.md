# Craftmine World Windows client

The application derives from PI-Desktop at the exact revision in `UPSTREAM.json`. Upstream source, license text and build history are retained in `vendor/pi-desktop`. The desktop uses the PI React/Electron shell and Agent runtime, a Rust PI host, and the new Rust Craftmine domain service.

## Build from the supplied source

Use Windows x64, Node.js 24, pnpm 11 and a Rust MSVC toolchain with Visual Studio C++ build tools. The verified development versions are Node 24.14.0, pnpm 11.18.0 and Cargo 1.96.1. Lockfiles pin package dependencies. No private package registry or signing secret is required for the local preview.

1. Extract the source archive to a directory with a reasonably short path.
2. Run `pnpm install --frozen-lockfile` from `vendor/pi-desktop`.
3. From the repository root run `powershell -File desktop/build-client.ps1` in a clean Git checkout. The output is `vendor/pi-desktop/apps/desktop/release/win-unpacked/Craftmine World.exe` plus its adjacent runtime files.
4. For an extracted source archive without Git metadata, initialize a local Git repository and commit the extracted sources before running the script. This creates the matching source archive embedded by the packaging step. Preserve the supplied `UPSTREAM.json` provenance.
5. The optional `-Installer` switch builds the NSIS installer. Installer acceptance remains a later milestone.

An optional `CARGO_TARGET_DIR` may point to a shared Cargo build cache. The build script copies only the two resulting release executables into the declared package resource paths; it does not copy that cache into the application.

Do not separate the executable from its adjacent files. End users of the finished package will not need Node, Rust or pnpm. Offscreen native startup and lifecycle have development-build coverage; installer and visible-window acceptance remain separate work.

## Runtime profile

The Windows default is `%LOCALAPPDATA%/CraftmineWorld`, with Chromium state in its `desktop` child directory. `CRAFTMINE_DATA_DIR` selects an absolute isolated profile. An inherited `PI_DESKTOP_DATA_DIR` is ignored by the desktop entry point; it is an internal alias after Craftmine chooses its own profile. Every profile keeps its own instance lock. Credentials are not copied from an installed PI application. Upstream PI application updates are disabled for this distribution.

The world plugin owns `plugins/data/craftmine.world/tasks.sqlite` inside the product profile. Rust owns the desktop world and task tables. The original web project's `.craftmine` store is a separate compatibility baseline; there is no automatic import or concurrent write sharing.

## Validation and current limits

Automated checks use independent headless Chromium and separate data directories, with pointer lock and focus disabled at initialization. No real mouse, keyboard or visible-window test is allowed.

- `cargo test --locked -p craftmine-core` from the PI workspace validates durable tasks, cancellation, world isolation, stale writes and integrity.
- Root `node tests/desktop-core-probe.mjs` runs real plugin and Rust processes.
- Root `node tests/desktop-worlds-browser.mjs` verifies creation, switching and saving through the real plugin, compiler, Rust database and game. The Electron page transport is a test adapter.
- Root `node tests/desktop-legacy-browser.mjs` verifies the actual import form, a complete legacy backup, fixed asset/extension versions, runtime effects and restart. Its native directory picker returns an isolated fixture path; it does not open a dialog or control input.
- Set `CRAFTMINE_PACKAGED_ROOT` to an absolute `win-unpacked` directory to test the packaged plugin host, plugin resources and Rust binary with the two probes above.
- Root `node tests/desktop-shell-browser.mjs` renders the actual React components for layout and theme checks. Its session data and native window bridge are fixtures, so it is not a full Electron test.
- Root `npm run test:desktop:native` launches the built Electron application in a contained, marked test profile with actual utility processes and Rust services. It verifies native IPC, old-world import, failed-close retry under a real SQLite write lock, normal shutdown and complete process restart. Main and world captures are separate offscreen surfaces. `CRAFTMINE_CORE_BIN` and `PI_DESKTOP_HOST_BIN` may select existing absolute release binaries. No dialog, pointer lock, input simulation, focused or visible window is used.
- With `CRAFTMINE_PACKAGED_ROOT`, the same native probe launches that directory's `Craftmine World.exe` and bundled Rust executables. It checks the packaged entry and guard preload before launching, refusing older builds that lack the offscreen input-isolation mode.

W1 has component integration and native offscreen lifecycle coverage. Visible desktop composition, polished product onboarding/icons and installer acceptance remain pending. The world creation Agent tools are not connected to the PI loop yet (W2); runtime status is the only exposed Craftmine Agent tool. Real-model creation, compaction, memory and gameplay composition must not be reported as completed based on these probes.

The world panel can import an original project directory or its `.craftmine` child. Rust keeps the complete original files under `plugins/data/craftmine.world/legacy-imports/<import-id>/source` in the product profile. The current world, progress, assets and extensions become a new desktop world. Old library versions, unapplied candidates and unfinished drafts remain in that backup; their new-client editing and reuse UI is still pending. The source directory is never migrated in place. Import bounds are 256 MiB total, 64 MiB per file, 10,000 files/directories and 32 nested levels; links are rejected.

Early scene-format-1 worlds are verified from their original JSON bytes and converted to the existing canonical format in the playable copy. That copy receives a new build ID; the original format and ID remain in its archive. Formats 2–4 retain their existing build IDs.

The package includes the upstream LGPL license, provenance, this build guide and a source archive from the build commit. Third-party authorship is retained in that source. See the project plan for the remaining distribution work.
