# Target parameter client baseline

The actual development client at `5b74d3a743b74b4399f8d40c22edea3842ee6ef0`
completed 19 assertions across three isolated process launches in `passed.json`.
The current authored runtime source and plugin were staged from that commit.
The unchanged previous core and host binaries were copied without modification;
their hashes, compiled client/plugin hashes, and runtime inventory digest are in
the report. This is not a new Windows release or real-model acceptance.

The run created a real first-person world, changed camera direction through
existing game operations, checkpointed full progress, prepared one durable
500 ms target edit, and ran its actual broker/import/export/runtime check.
Duplicate submission replayed the same receipt. Preview and close preserved the
formal 120 ms value. Restart recovered the original operation and arguments.
Adopting its exact candidate changed the runtime and formal source to 500 ms;
another restart retained it. Every saved progress field, including stable
`savedAt` metadata, remained identical. All three processes exited zero, with
no input, focus, Pointer Lock, or page-error violations.

## Retained failures and remaining work

- `missing-plugin-module.json`: the preceding `9cb31a5` client failed to load
  the world plugin because the new private service was absent from bundled
  resources. Commit `5b74d3a` bundles it and its source-parser dependencies.
- `shutdown-failure.json`: the first run of the same `5b74d3a` source passed the
  18 functional steps, then its third shutdown exited `2147483651`, accompanied
  by `PostQueuedCompletionStatus` invalid-handle output. The full independent
  rerun passed; this does not establish that the intermittent exit issue is
  fixed. Both attempts are part of the denominator.
- Static source restrictions reject incompatible target/profile scripts and
  scripted target ancestors. Other game scripts can still override values.
  A required runtime assertion tied to the check job is being implemented;
  these reports do not prove that pending safeguard. Only the fixed official
  training scene is covered by this client baseline.
- Older incompatible worlds remain available for normal creation/play, but
  their target scripts are not silently upgraded by the parameter panel.

All browser/game activity used independent hidden/offscreen processes and
private test profiles. The fixed gameplay helper captured only its game view;
the report stores image hashes, not desktop captures. No model requests,
credentials, external uploads, or user input simulation were used.
