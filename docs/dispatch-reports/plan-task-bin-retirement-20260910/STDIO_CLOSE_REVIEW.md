# Follow-up: require complete broker stdio before retirement

The independent review of `fa82b825733dc1c9ceff086606ecd90fe799196c` found that the legacy executor settles on ChildProcess `exit`. A valid-looking response at that point could create a retirement capability even though trailing pipe data had not arrived. The original 46-test result did not cover that ordering.

The bounded correction adds an invocation-local close promise with a fixed five-second deadline after exit. Only a complete `close`, a fresh parse of all bounded stdout, an unchanged validated response and clean transport metadata allow capture. Late stderr, stream errors, parse failures and close timeout preserve bin files. Early stderr is retained under the original classification; optional retirement does not reclassify an existing successful core result as failed. Timeout resolution is final even if close later arrives. Diagnostics are retained in the executor warning on refusal and in the retirement acknowledgment on success.

This changes only the retirement gate. The executor's existing general build response-at-exit behavior remains outside this correction. Neither the new capability nor a retired task is reconstructed from an old ledger. No historical cleanup, native run, packaging or engine build was performed.

The spec now explicitly distinguishes the existing executor ledger's writeFile-plus-rename completion from fsync/power-loss durability. The separate acknowledgment requests file fsync and readback, without claiming cross-file atomicity or universal power-loss recovery.

Validation commands and final counts are recorded in the adjacent `close-review-evidence.json` and raw log. Event-order tests evaluate the fixed production runBroker function with in-memory EventEmitters and a manually advanced timer; they are not actual OS-pipe evidence. Existing successful preflight/import/export retirement cases remain in the combined suite. Rust, real engine/pipe behavior, package rebuild and actual disk savings remain unverified in this branch.

The user requested stopping after this bounded correction. No next feature or release integration is started by this handoff.
