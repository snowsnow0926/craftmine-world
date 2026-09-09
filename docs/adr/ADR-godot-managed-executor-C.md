# ADR: the host owns engine execution and the isolated runtime check (task C)

Status: accepted and implemented for the private host components; the core
interfaces it consumes (`godotExecutor.status`, `godotExecutor.revoke`,
`godotJob.checkDescriptor`, host build files) are still pending in the
integrated core and are consumed by feature detection.

## Context

The core never runs the engine. It records build jobs, verifies file hashes and
requires an attested executor before a job can leave `blocked`. Something trusted
must discover the pinned engine, run the fixed import/export operations under the
broker's OS policy, prove the exported build really starts, and report a result
the core can reject. That something must not be reachable from a page or a model,
and it must not be able to invent a pass.

## Decision

1. **One private host service owns execution.** `godot-executor.cjs` runs inside
   the plugin host process. It reads only host configuration, never a caller
   supplied executable, root, token or receipt. It registers only after a real
   broker preflight whose receipts prove the process, network and cleanup policy;
   the attestation evidence hash is derived from the measured broker/engine/bridge
   bytes and those receipts.
2. **Measured inputs, not claims.** The host recomputes the source snapshot digest
   from the broker's own reported files and requires the set to equal the claimed
   manifest exactly. Artifacts are re-hashed after being copied into the
   core-owned root, and the host-pinned browser bridge replaces any authored copy.
3. **Narrow native-error rule.** Restricted-environment native diagnostics are
   matched by exact message plus engine location. Everything else, including any
   GDScript backtrace or unknown `ERROR`, fails the job. A pass can never come from
   an unclassified log line.
4. **The check is isolated and read-only.** The runtime check uses a hidden,
   offscreen, non-focusable window on an ephemeral partition with egress confined
   to a private loopback origin, the shared input guard in every frame, and no
   writing operation. It proves ready state, real frames, no errors, an unchanged
   formal progress snapshot, isolation and teardown.
5. **Failure is a recorded outcome, not an exception.** Cancellation, timeouts,
   process interruption, unload and late replies all end in a terminal job state
   with no candidate. A `check` job always reports at least one assertion so the
   core can record the failure instead of leaving the job to expire.

## Consequences

- A passing job now means the pinned engine imported, exported and the export ran
  in an isolated browser with the formal progress intact. It still does not mean
  gameplay acceptance or model authorship.
- The host cannot revoke its registration on the integrated core yet; it reports
  that state explicitly and claims no job after stopping.
- Jobs queued by a previous process are not rediscovered until `godotJob.pending`
  exists; the trusted caller enqueues them today.
- A hard broker kill may leak an AppContainer profile; the broker protocol
  requires a host recovery journal that is not part of this change.
