# Continue a failed runtime check using its verified immutable export

`godotJob.continue` already creates a new job/task execution while retaining
the immutable BuildId and validated source identity. The executor ignored
`originJobId` and exported again. Godot can produce different bytes on an
unchanged-source export, so exclusive artifact staging correctly rejected the
attempt with `GODOT_ARTIFACT_CONFLICT`. Editing source just to change the hash,
overwriting the export, or treating a diagnostic replay as a candidate would
break the intended ownership and evidence contracts.

Core now derives a private retained-export authorization from the explicit
failed origin's hashed native output and artifact registry. It verifies current
world/source, project/session and workspace lease, matching engine attestation,
and exact immutable bytes at the relevant native boundaries. The existing
attestation digest is stable across process restarts and binds the broker,
editor, template hashes, bridge and successful isolation preflight facts.
No old verdict or caller-selected path is used. The executor additionally
verifies filesystem links, the live bridge pin and creation PCK protected
source content.

We deliberately retain fresh native import/compile. This keeps the current
broker/source evidence real without expanding the output schema to impersonate
a new export receipt. The fresh job obtains its own native check descriptor and
current progress, runs the actual runtime verifier, and finishes normally. The
existing assertion-detail channel records the reuse origin and that no export
ran. The native result hash binds that disclosure; restored ledger metadata
remains diagnostic only. No new model tool, world store or budget is introduced.

The change is limited to exported failed checks on explicit continuation.
Ordinary fresh exports retain conflict refusal. Non-exported failures do not
gain filesystem caching authority. An old Core without the private claim field
causes a named refusal, rather than silently re-exporting or using a local
descriptor fallback. Source, pin, artifact or lease changes reject reuse.

Validation: 23 Rust job tests and 63 executor protocol tests passed, with one
existing file-symlink privilege skip. The protocol tests prove a fresh import
and zero export requests on reuse, refuse tampering/missing/hardlinked/junction
paths, changed origin/source/toolchain/bridge, absent authority, invalid native
descriptors and cancellation. Native tests also cover session separation,
revocation, stale queued source, missing new descriptors and origin immutability.

`test-results/retained-export-native-01/retained-export-report.json` is the real
independent Core/broker/Godot proof. Its origin deliberately had no verifier;
native import/export succeeded and the check failed. This is a controlled host
fixture, not a model failure. After Core/executor restart, the normal
`godot_jobs` resume tool created a passed new candidate using the same ten
artifacts, with unchanged hashes, timestamps and file identities. Only a fresh
import was recorded for the continued job. The first candidate was applied
through normal native first load; real engine movement was saved. A second
continuation used that new full progress and a distinct runtime instance and
produced candidate
`gcan-f8b320d232d75e02a9221d84f98e16095bc4ffd133419dd65a75a3e1047f64b0`.

After normal save/close, deliberate artifact corruption and a source-name change
in this disposable fixture were refused by ordinary resume calls. Corrupt bytes
and the original failed output were preserved; the fixture is intentionally left
corrupt and is not a demo profile. All helper guards and shutdown checks passed.
No coordinator content profile was opened, mutated, re-exported or adopted, and
no model call was made.

## Coordinator handoff

Staged builds are `test-results/retained-export-core-build/release/craftmine-core.exe`
and `test-results/retained-export-plugin`. Build commands from the request root:

```powershell
cargo build --manifest-path vendor/pi-desktop/Cargo.toml --release -p craftmine-core --target-dir test-results/retained-export-core-build
node desktop/build-world-plugin.mjs --output test-results/retained-export-plugin
```

Update the coordinator's mutable component set and its existing plugin path
after normal consumer shutdown. Keep sealed packages untouched. A desktop
package also needs its `host-core` binary rebuilt because it links this Rust
library. The private CLI checker is bundled from source on service startup.
The agent tool catalog and exact `gpt-6-astra` / `xhigh` configuration are unchanged.

Ask the existing city author to verify current source facts, then make this
normal tool call in its retained world/session:

```json
{"mode":"resume","originJobId":"gjob-931dee6fddca6fdb03a552ae8c977b9c2d14be23aa423b28ede04abde306f60f"}
```

The tool is `craftmine.godot_jobs`. Poll `craftmine.godot_build_read` using the
returned `result.jobId`. Expect a different job ID, the same BuildId/source,
`export.reused` with `exportExecuted:false`, fresh check evidence and a new ready
candidate. If source or pins moved, preserve the refusal; do not manufacture a
source edit or replace immutable files. Only the coordinator's subsequent normal
operator adoption/capture/save/traversal can establish application of that new
city candidate. This implementation has not continued or adopted `pcity`.
