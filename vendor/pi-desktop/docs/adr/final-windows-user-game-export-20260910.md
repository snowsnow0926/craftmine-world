# Fixed Windows export without a native command surface

The existing broker supported import and Web export only. Windows user-game
delivery needs a native template and its own evidence; a desktop installer or
WASM view cannot satisfy it.

Add a fixed `exportWindows` operation with an exact host preset and pinned
release template. Preserve LPAC, preflight, one-process Job, resource and
recovery checks. Require unchanged native EXE plus separate PCK and reject
extra native artifacts. This deliberately excludes GDExtension/DLL exports,
resource editing and signing until separately designed.

Keep extraction in a new task directory to avoid granting/modifying shared
cache permissions. Validate authored standalone gameplay and persistence with
real Rust source storage and the real broker, while distinguishing test data
isolation from an OS sandbox. No production arbitrary native runtime is added.
The final product must rebuild the broker from its integrated recovery source,
update its executable pin and stage the new template before exposing export.
