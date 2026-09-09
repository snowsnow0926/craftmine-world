# Final ASAR resolution and Windows input binding

The real installed root pnpm tree was inspected without building the full app.
Direct resolution of `@electron/asar` from the desktop package produced
`MODULE_NOT_FOUND`. Resolving through `electron-builder` → `app-builder-lib`
successfully loaded `@electron/asar@3.4.1`. `windows-package-tools.mjs` now uses
that dependency ownership path and normalizes the path passed into the archive.
The new `package-asar.mjs` helper is build tooling only, not a product API.

The real installed ASAR module created a temporary archive containing nested
client UTF-8 bytes and extracted those exact bytes; a missing entry was rejected.
This test used
`CRAFTMINE_TEST_DESKTOP_DIRECTORY=D:/cm-godot-final-20260910/vendor/pi-desktop/apps/desktop`.

Mill's final commit **a311359** was reviewed using read-only `git show`:

- `broker.rs` embeds `../shared/windows-export.cfg` through `include_str!`, and
  rejects any different project preset bytes.
- `broker-identity.mjs` includes that preset in its source-file digest.
- The standalone bootstrap is runtime input, not Rust compile input. The host
  copies it into the export project and inventories the resulting project;
  both files enter `sourceDigest`, `inputHash` and export provenance.
- The source staging path reads frozen Git bytes, enforces the exact authored
  distribution manifest, and moves the entire selected `shared` directory.
  The earlier precise `NEW_AUTHORED` additions permit the two new inputs only.

One extra boundary was missing: Rust may embed checkout CRLF while resource
staging copies canonical Git LF. The release could then contain a preset its
own broker refuses. New `verifyWindowsHostInputs` requires both staged inputs
to match their exact frozen `sourceDistribution` byte/hash records and requires
the staged preset hash to equal the broker's embedded-source identity record.
Real staging invokes it before publication. The runtime manifest records both
inputs, and unpacked/package verification rechecks the same cross-binding.
Missing entries, undeclared input bytes, newline differences or later tampering
are errors; they cannot become a warning or successful fallback.

Run after these changes:

```text
node --test --test-isolation=none tests/godot-final/runtime-resources.test.mjs tests/godot-final-install-assets/package-asar.test.mjs
7 passed, 0 failed, 0 skipped
```

These cover actual archive creation/extraction and actual filesystem resource
hashing, including missing preset source identity, CRLF-versus-LF mismatch,
missing bootstrap declaration and modified bootstrap bytes. JS syntax and
`git diff --check` passed. No full package, model invocation or user input was
run. Root must merge a311359, refresh pins on the final frozen clean HEAD,
rebuild the broker from those exact source bytes and stage the final resources.
Do not reuse a broker built before the shared preset became a compile input.
Rights status and signing/clean-machine limitations are unchanged.
