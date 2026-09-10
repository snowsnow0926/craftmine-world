# Packaged parameter acceptance entry

After a clean-source release has been built and its payload verified:

```powershell
node tests/plan-loop/target-feedback-client-native.mjs `
  --source-root '<frozen source checkout>' `
  --packaged-root '<same-run output/win-unpacked>' `
  --expected-commit '<40-character frozen commit>' `
  --expected-build-manifest-sha256 '<independently recorded build-manifest SHA-256>' `
  --deps-app '<explicit desktop dependency directory for ASAR inspection>'
```

The source checkout must be clean and match the expected commit. Package mode
does not accept `--runtime-source`, read development compiled files, resolve
external Electron, or fall back to external core/host/Godot resources. The
dependency directory provides only the existing ASAR inspection library, never
the launched application. Missing dependencies or package files fail closed.

Before each launch, the helper checks the trusted build-manifest hash, source
commit, ASAR entry/guard/feature bytes and all declared client files, complete
plugin inventory, bundled core/host/agent/source hashes and complete runtime
inventory. It records EXE/ASAR hashes and requires identical package identity on
subsequent launches. It launches only the package's EXE with no application-path
argument; runtime paths point inside that package. Inherited Craftmine, PI,
Electron and Node-options overrides are removed before adding owned test paths.

Existing gameplay, finite parameter, journal, adoption, full-state restart and
shutdown assertions remain in the shared native runner. Independent profiles,
offscreen nonfocusable windows and no input/Pointer Lock remain mandatory.

The entry does not prove the installer's seal, code signature, installation,
clean-machine behavior or real-model creation. Synthetic ASAR tests only prove
selection and refusal logic. Never label a previous release as passing features
added after its frozen source commit.

Fixture verification:
`CRAFTMINE_TEST_DESKTOP_DIRECTORY=<explicit tooling directory> node --test tests/plan-loop/parameter-client-package.test.mjs`.
Seven tests passed; no packaged application was executed for this implementation.
