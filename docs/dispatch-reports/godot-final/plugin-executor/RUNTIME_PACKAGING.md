# Same-source Windows runtime packaging

This change prepares a new package from the current clean commit. It does not stage an older installer or claim game/model acceptance.

Run from the canonical integrated tree after committing all code:

```powershell
./desktop/build-client.ps1 -Installer -GodotCache 'D:/Craftmine World/desktop/build/godot/4.7.2-stable' -GitArchive 'C:/Users/WINDOWS/.pi-desktop/scratch/6aabaf4c-66ca-4c59-92ba-bad7ff729894/MinGit-2.53.0-64-bit.zip'
```

The build first compiles `godot-host-broker` with `--release --locked` into its own crate target, then stages fixed resources. `prepare-runtime-resources.mjs` also accepts explicit `--godot-cache`, `--git-zip`, `--broker-bin` for the trusted build orchestrator; it requires a clean Git HEAD and cannot establish compiler provenance by inspecting arbitrary PE bytes alone. The build script's fresh Cargo step and end-of-build source checks supply that link.

Output: `desktop/build/runtime-resources`, copied by Windows electron-builder into `resources/`:

- `godot/engine/4.7.2-stable/editor/` and `templates/` (Web threaded/single plus Windows release/debug x86-64 and version.txt).
- `godot/broker/godot-host-broker.exe` and generated `broker-identity.json` with release profile, source commit, all Rust source hashes, binary size and SHA-256.
- Committed `godot/bases`, `shared`, `web`, `licenses`, and toolchain lock; source-only caches and untracked outputs are excluded.
- The complete fixed MinGit tree under `git/`, with `bin/git.exe` wrapper, license files, `GIT-BUNDLE-PIN.json` and computed `GIT-BUNDLE.json`.
- Duplicate offline engine notices at `licenses/godot` as required by the existing notice inventory.
- `runtime-resources.json`: all staged file hashes, source commit and archive pins. The temporary output ownership marker is excluded from the package.

The complete 1.28 GB Godot template archive and MinGit ZIP are hash-checked by streaming before extraction. A fixed PowerShell file receives separate typed arguments; archive names are never interpolated into shell code. Only two exact Windows entries are selected from the Godot archive. The extractor rejects traversal, links, duplicate names, Windows aliases and excessive declared sizes. It launches no UI or input operations.

Replacement is limited to this workspace's exact `desktop/build/runtime-resources`. It requires an ownership marker matching the canonical workspace, checks all ancestor directories and descendants for links, then replaces only that output. Failed new attempts remain under their uniquely named pending directory for diagnosis.

`windows-package-tools.mjs manifest/verify` now requires the full runtime manifest, verifies every packaged runtime and plugin file, and checks the built Electron output bytes inside app.asar against the recorded build. Package source commit must still equal the clean current HEAD. Node file hashes are streamed to avoid loading large engine/installer files into RAM.

Validation performed here: four no-worker Node tests passed for real byte hashes, source mismatch, traversal, missing/tampered/extra files and package-only unrelated resources. Both Node scripts and both PowerShell scripts parse successfully. Full extraction, release compilation, NSIS packaging, clean-machine installation and same-package true-model/game acceptance remain root's integrated run; this document does not substitute those results.
