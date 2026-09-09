# Integrated plugin/executor repairs

Baseline: unified integration `7d6ffd5`, followed by asset preview dependency `825edb8` (merge `30e8ecd`). No original S2/S6/S7 tree was edited.

## Changes

- History reads now send the actual core contracts: bound `worldId`, `skip/limit`, commit strings and `content.changes`; version refs are checked against the world's registered repository. Operation reads use the pure `content.operation.read` added by the core owner. Proposals still perform no write.
- Private routes use `applicationId` for deployment confirmation and expose exact portable backup, operation-read, asset-body, patch-operation and end-turn contracts. The existing authorized `godotBuild.start/cancel` routes dispatch their accepted result to the owned executor. No new renderer enqueue/cancel API was added.
- The host supplies `PluginHostServices.craftmineGodotToolchain = {broker,brokerIdentity,engineRoot,toolchainLock,bridgePath}` through the private zero-argument `getGodotToolchain` API. All paths are absolute. Product main passes this configuration to the executor; model/panel arguments and inherited child environment do not select these resources. Missing or malformed pins fail before recovery/preflight. Adjacent or writable-data manifests cannot nominate themselves. Both version and job receipts must match the host-measured pin.
- Asset preview and cancellation use JSON-only private bridges (`craftmineAssetPreview`, `craftmineCancelAssetPreview`), matching the separately delivered managed asset service. The S6 entry-load staging now copies both actual service modules.
- Native recovery preserves profile, task directory, sidecar and journal when a recorded child has unknown identity or termination is unconfirmed. Failed profile removal also preserves the marker and logs for retry. PID values must fit a nonzero u32.

## Evidence and limits

- Local no-worker Node run: `node --test --test-isolation=none tests/godot-final/plugin-contracts.test.mjs tests/godot-round3/S6/plugin-load.test.mjs` passed 10/10. These are actual plugin/service entry and contract tests with core/host fixtures, not a model/Godot acceptance run.
- Local missing-pin/self-nominated-manifest negative: 1/1 passed, without spawning the broker.
- Root archived `evidence/recovery-tests.log`: 12 native recovery tests passed, including actual current PID/FILETIME with an image outside task/bin; zero input or UI actions. This predates the added profile-failure preservation test; its rerun must be recorded separately.
- Root archived `evidence/protocol-tests.log`: 22/31 passed, 9 failed after mandatory pin enforcement exposed fixture receipts that claimed hashes unrelated to their on-disk fixture binary. Fixtures now hash their controlled binary; original failures are retained and a fresh full protocol run is required.
- Final reruns: `evidence/protocol-tests-rerun.log` passed 31/31 without skips; `evidence/recovery-tests-rerun.log` passed all 13 native recovery tests, including both new child-identity and profile-failure preservation cases. Earlier failures above remain historical evidence.
- Local normal Node worker execution was denied with spawn EPERM; local Cargo output-directory creation was denied with OS error 5. Root runs the same tests under its existing permissions. These denials are not test passes.
- Automated approval rejected broadening the host allowlist with direct executor enqueue/cancel. The implemented narrower solution uses the already authorized build route, with no added renderer/executor surface.

Real new model calls: zero. The integrated Electron check/apply, final same-source Windows resources and installer still require root's combined verification. Existing S7 default `GODOT_BROKER_MISSING`, old mixed binary/source evidence, and prior unverified Electron harness are not superseded by these fixture tests.
