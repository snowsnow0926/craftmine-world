# Carry complete restoration through native context maintenance

Native insertion fixed a single-input length refusal, but a later long-session
recovery produced the CLI's persisted `context_window_exceeded`. Its zero-input/
output total of 522,500 was a capacity marker, not consumption. The prior native
thread already had compaction and acknowledged interruption; retaining a strictly
clean interrupted checkpoint avoids rebuilding it. Previously overwritten
checkpoints still need a working product recovery path.

Use documented `thread/compact/start` between complete textual hydration segments.
A segment is 256 KiB of text, not a maximum on total history, model work or time.
Insert every original payload in order with source identity and full chunk hashes.
Native summaries carry earlier context forward. Rust's visible history is never
edited or replaced with a host-authored summary. Final anchors re-provide original
player wording and historical image blocks. No external rollout data is used to
forge or roll back a checkpoint.

Compaction is a distinct native maintenance turn on the same verified thread and
exact model/effort. Require its real completed contextCompaction item and matching
successful terminal event, as well as RPC acknowledgement. Maintenance cannot
complete the PI player request, execute domain tools or bypass model checks.
Track real usage through valid native counters. Error/cancel retains the cause,
closes the owned transport and leaves restoration unsynchronized. Only after
history and anchors are ready does the backend refresh facts and start the current
ordinary player turn. Provider refusal remains visible; mocks cannot prove native
endpoint acceptance or eventual context capacity.

Read-only projection of the actual 232-message transcript planned 12 native
maintenance steps and 43 injection batches; maximum segment text was 261,282 bytes.
Every original payload reconstructed exactly. All 14 user messages remained, with
four image blocks after the final original-text compaction. This projection made
no model calls. Coordinator-controlled ordinary live recovery and final packaged
acceptance remain separate evidence.
