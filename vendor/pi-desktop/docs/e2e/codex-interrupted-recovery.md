# Interrupted native thread recovery

Use the existing isolated offscreen world conversation and exact supported
Codex/Astra/xhigh configuration. Do not inject real input or activate windows.
Fixtures and read-only API evidence are not final native/package acceptance.

1. Start an ordinary creation turn, wait for an idle completed tool tail, and
   stop through the app. Delay the interrupt RPC response and terminal notification
   independently in the fixture. World authority must be fenced immediately;
   stdin stays open until both matching receipts, followed by stdout drain.
   [Process close/drain](../adr/codex-app-server-close-drain.md) covers exit before
   the final stdout response. Record synchronized=true only after durable save.
2. Missing/foreign/late receipts, pending host tools, failed save and maintenance
   interruption remain unsynchronized. No new tool can dispatch after the fence.
   The cleanup grace is bounded; no model, token or whole-turn limit is added.
3. For a real existing interrupted checkpoint (submitted=true,
   synchronized=false), first confirm its exact Rust transcript digest. Resume
   with the ordinary Composer. Read only its own thread metadata and latest full
   turn; require interrupted status, exact user text/images, visible assistant
   tail and every hash-mapped completed dynamic tool. Compare JSON objects with
   normalized keys, but preserve source text and image bytes. Recheck after normal
   thread/resume and host load. Expect one actual turn/start, same CLI thread,
   no history reconstruction/compaction and unchanged selected world/source.
4. Change a native tail/result/identity or simulate an unavailable read. Expect
   the localized recovery error and existing Continue button, no new model turn,
   no history mutation and unchanged old checkpoint. Continue retries the same
   verified prefix; all intervening original user messages/images remain visible
   and are delivered as explicitly historical data after successful verification.
   Cancel during the read-only phase and repeat. Reject/abort or lose an injection
   acknowledgement after mutation starts: submitted=false must prevent replay of
   the uncertain native history. Never silently consider it synchronized.
5. Keep older ordinary import/no-checkpoint and genuinely divergent-history
   restoration tests passing. Record the API metadata/tail fingerprints and
   relative evidence filenames without credentials, raw paths or model history.

The 2026-09-14 read-only investigation of this project's isolated conversation
used exact CLI 0.154.0-alpha.6.2: metadata was notLoaded/paginated and the latest
public turn was interrupted, with two text inputs, two visible assistant messages
and eight completed dynamic calls. The actual public response matched the Rust
tail comparator; the full 262-message transcript digest matched its checkpoint.
This establishes a viable recovery precondition, not a completed ordinary
model continuation or final packaged acceptance.
