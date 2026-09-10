# PP2 verified base default fill

Implemented from 251c966 in the independent codex/pp2-base-default-20260910 branch.
Keep unmerged until the next integration cycle; no frozen package was changed.

The existing source parser now returns the fallback below the selected instance
with exact managed-source provenance. Main projects it, and the workbench button
only fills the input. The original durable submit, runtime expectation, preview and
adoption paths remain unchanged. No arbitrary RPC/property, model or progress write.

Validation completed:

- Parser + defaults + service + Main panel: 31/31 node:test cases.
- Actual workbench/component DOM with deterministic transport: 10/10; ui-final.
  No external requests, page errors, real input, focus or Pointer Lock.
- Pinned Godot 4.7.2: four provenance cases, load/restore plus new-process restart,
  8/8; native-final. Exact full JSON progress is checked in engine and Node,
  including other targets, and selected explicit values survive profile700.
  All 12 import/run processes exited0 with no ERROR/SCRIPT ERROR output.

Earlier raw failures are retained, not counted as passing runs:

- native-first-failure: 0 checks. A fake isolated Windows home lacked known folders;
  strict import gate caught OS get_system_dir errors. The runner now creates only
  owned known folders and a self-contained editor marker beside its owned binary.
- native-second-failure: 1 check before restart. Comparing native Dictionary values
  directly with JSON-decoded values failed on runtime Variant types. The final runner
  compares the complete persisted JSON representation without dropping fields and
  independently deep-compares the engine snapshot to saved.json in Node. Strict logs
  caught the failure even though Godot continued after an assertion helper returned;
  the helper now also preserves an explicit failure flag for its final exit/result.

Scope: fixed authored headless configuration tests and real DOM, not full desktop,
actual AppContainer build/check/application, model, newly packaged app or signed
release acceptance. Existing runtime requirement enforcement remains essential for
arbitrary sibling scripts. Full client/default button adoption belongs to next-cycle
integration, after rebuilding private service/Main from this same source.

The changed Main panel passes a targeted TypeScript noEmit check using read-only
dependencies. git diff --check passes; the E2E file original byte prefix is unchanged.
Source hashes are recorded separately; raw report/log copies retain exact bytes.
