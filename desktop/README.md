# Craftmine World Windows client

The application derives from PI-Desktop at the exact revision in `UPSTREAM.json`. Upstream source, license text and build history are retained in `vendor/pi-desktop`. The desktop uses the PI React/Electron shell and Agent runtime, a Rust PI host, and the new Rust Craftmine domain service.

## Build from the supplied source

Use Windows x64, Node.js 24, pnpm 11 and a Rust MSVC toolchain with Visual Studio C++ build tools. The verified development versions are Node 24.14.0, pnpm 11.18.0 and Cargo 1.96.1. Lockfiles pin package dependencies. No private package registry or signing secret is required for the local preview.

1. Extract the source archive to a directory with a reasonably short path.
2. Run `pnpm install --frozen-lockfile` from `vendor/pi-desktop`.
3. Use a clean Git checkout. For an extracted source archive without Git metadata, initialize a local Git repository and commit the extracted sources first. This produces a new local build identity; it does not reproduce the original release commit. Preserve `UPSTREAM.json` and the supplied release evidence.
4. Provide the pinned Godot cache, Blender cache and MinGit ZIP explicitly. `desktop/godot/toolchain.lock.json` defines the required editor, complete export-template TPZ and extracted Web templates; `desktop/blender/toolchain.lock.json` pins the complete Blender 5.2.1 runtime and source archive; `desktop/delivery/git-bundle.json` defines the MinGit ZIP identity. Prepare Blender with `node desktop/blender/toolchain.mjs --cache <absolute-cache-directory>`. The application build does not download these inputs or discover a user's installed tools.
5. From the repository root, run the following directory build, substituting existing absolute paths:

```powershell
powershell -NoProfile -File desktop/build-client.ps1 `
  -GodotCache '<Godot 4.7.2-stable cache directory>' `
  -BlenderCache '<Blender 5.2.1 cache directory>' `
  -GitArchive '<MinGit-2.53.0-64-bit.zip>'
```

The script rebuilds the Godot and Blender brokers, stages verified runtime resources, builds the plugin and desktop/native services, archives clean HEAD, and reserves a fresh `desktop/build/releases/<commit-prefix>-<uuid>/` run. Its application is `output/win-unpacked/Craftmine World.exe` within that run. `run.json`, `seal.json` and `package-evidence.json` identify the actual output. The generated `desktop/build/CraftmineWorld-source.zip` is also included at `output/win-unpacked/resources/source/CraftmineWorld-source.zip`. Blender runs in the background through a restricted native job and needs no separate user installation; its source and notices remain separate bundled resources.

For a new NSIS installer, add `-Installer` and the pinned **full** 7-Zip extractor arguments:

```powershell
powershell -NoProfile -File desktop/build-client.ps1 -Installer `
  -GodotCache '<Godot 4.7.2-stable cache directory>' `
  -BlenderCache '<Blender 5.2.1 cache directory>' `
  -GitArchive '<MinGit-2.53.0-64-bit.zip>' `
  -ArchiveTool '<full 7-Zip directory>/7z.exe' `
  -ArchiveToolSha256 '<64 lowercase hex for 7z.exe>' `
  -ArchiveLibrarySha256 '<64 lowercase hex for adjacent 7z.dll>'
```

The reduced `7za.exe` is insufficient: the tool must support NSIS. The same run's `output/` contains `Craftmine-World-Setup-<version>.exe` and its blockmap. Verification extracts the actual installer payload and compares it with that run's unpacked application, including source, native binaries, plugin, ASAR client files and runtime resources. It does not execute the installer or prove signing, clean-machine installation, upgrades or uninstall behavior. Read that run's evidence instead of reusing a previous package's results.

The build entry does not itself produce a portable ZIP. After that run has its
seal and package evidence, create and verify the portable derivative with:

```powershell
node desktop/seal-portable.mjs --run '<absolute same-run directory>/run.json'
```

This uses the run's pinned full 7-Zip and creates a fresh `portable-<uuid>/`
directory alongside `output/`. The ZIP includes the complete verified
`win-unpacked`; its independently extracted files must all match the package
evidence. The new directory contains its own portable evidence and seal. The
original sealed output is unchanged. This verifies bytes and extraction;
running the resulting application remains a separate acceptance step.

An optional `CARGO_TARGET_DIR` may point to a shared Cargo build cache. The build script copies only the two resulting release executables into the declared package resource paths; it does not copy that cache into the application.

Do not separate the executable from its adjacent files. End users of the finished package will not need Node, Rust or pnpm. Development and packaged offscreen acceptance have separate reports tied to their actual bytes; clean-machine installer and visible-window acceptance remain separate work.

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

The integrated client connects PI world inspection, resource reads, draft patches, background checks, independent model review, request assertions, player application, reusable library modules, scoped memory and explicit recovery. Prior-batch real-model/native acceptance includes creation, cross-session reuse and three compactions; see `docs/WINDOWS_BATCH_06.md` and the latest delivery report for exact sources and limits. Fixed-response fixtures remain separate evidence. The original PI projects, sessions, chat, model settings and work panels remain available. Visible desktop composition and installer/clean-OS acceptance remain separate gates.

Set `CRAFTMINE_TEST_APPLICATION=1` for the native fixed-provider application scenario, including a valid-but-wrong-effect behavior that must fail request acceptance. This uses an actual PI request to a local deterministic responder. Alternatively, set `CRAFTMINE_TEST_LIVE_REVIEW=1` and `CRAFTMINE_LIVE_CONFIG` to an explicitly authorized absolute local configuration file. That opt-in scenario uses the existing DeepSeek credentials/model in an isolated native PI profile; it reviews a fixture-authored draft and does not prove model-generated creation. The two modes are mutually exclusive. Test reports must retain that distinction.

Use `node --test tests/desktop-application.test.mjs tests/desktop-review-cancellation.test.mjs tests/desktop-review-host.test.mjs tests/desktop-verification-jobs.test.mjs` after preparing the plugin for targeted migration, lost-receipt, cancellation and compiler checks. These tests do not use visible windows or input simulation.

The world panel can import an original project directory or its `.craftmine` child. Rust keeps the complete original files under `plugins/data/craftmine.world/legacy-imports/<import-id>/source` in the product profile. The current world, progress, assets and extensions become a new desktop world. Old library versions, unapplied candidates and unfinished drafts remain in that backup; their new-client editing and reuse UI is still pending. The source directory is never migrated in place. Import bounds are 256 MiB total, 64 MiB per file, 10,000 files/directories and 32 nested levels; links are rejected.

Early scene-format-1 worlds are verified from their original JSON bytes and converted to the existing canonical format in the playable copy. That copy receives a new build ID; the original format and ID remain in its archive. Formats 2–4 retain their existing build IDs.

The package includes the upstream LGPL license, provenance, this build guide and a source archive from the build commit. Third-party authorship is retained in that source. See the project plan for the remaining distribution work.

## Diagnostic sampling and isolated delivery checks

Desktop diagnostics use bounded observed samples: process start to first renderer document load, visible renderer animation-callback intervals, and host model workflows grouped by Agent turn or one-shot completion. Agent turn duration includes tools and network waits. Hidden/unsampled surfaces remain absent; these are not performance benchmark results. Packaged build identity is read from the bounded source manifest and development builds may have no provenance fields.

`node tests/dispatch/batch07/performance-headless.mjs` runs three fixed workloads in an independent headless browser and reports environment, timing windows, renderer/heap scope and local reference comparisons. It does not prove visible Electron performance or predict another machine. `powershell -File desktop/windows-readiness.ps1 -NoIsolatedMachineAvailable` only inventories local capabilities and signing candidates. There is no available isolated Windows machine in the current session; installer execution and cross-user credentials are not verified. See `desktop/ci/README.md` for the explicit ephemeral-runner entrypoint; do not spoof its markers to run installations on a personal machine.
