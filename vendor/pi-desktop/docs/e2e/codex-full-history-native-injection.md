# Complete Codex transcript restoration: E2E test plan

Initial injection implementation: `4ccb16e0`; subsequent native context maintenance
follows the updated backend contract. See
[backend contract](../spec/codex-desktop-world-backend.md) and
[decision](../adr/codex-full-history-native-injection.md). This document is a test
plan, not a claim that the live recovery or final Windows package has passed.

## Setup and evidence boundary

Use one independent native PI profile and its existing ordinary world/session.
Verify the exact compatible CLI `0.154.0-alpha.6.2`, model `gpt-6-astra`, effort
`xhigh`, normal world authoring tools, read-only CLI sandbox and disabled external
MCP/builtins. Do not change credentials or call login for this test. Do not add
token, model-call or whole-turn limits. Native runs require coordinator scheduling
and normal application shutdown; source-mode diagnosis and final packaged
acceptance receive separate report labels and binary/resource hashes.

All automation uses an independent headless/offscreen process, disabled Pointer
Lock and page-script UI events. Do not send real mouse/keyboard input, activate a
window or control another browser. Use the ordinary Composer, cancel and reopen
paths. Never patch the live transcript, checkpoint, source, save or failed job.

Before running, record PI session/world IDs, the canonical transcript's ordered
message IDs and hashes, user-message payload hashes, image count/hashes, current
source revision/manifest, formal build and saved-progress hash. Keep raw transcript
and image data in their existing private profile. Share only bounded metadata and
selected evidence; never export credentials, raw CLI stderr, prompts containing
secrets or account identifiers.

## H1: more than 1 Mi of historical text, complete restoration

Use a session whose complete canonical historical payload exceeds 1,048,576
characters, with a user request at the beginning, source-shaped tool output in the
middle and a later correction. Prefer the already recorded real long session; do
not create unnecessary model work just to enlarge it. The regression fixture uses
more than 1 Mi characters of source-shaped data, independently of any real model.

After an ordinary interrupted turn or transcript divergence, reopen the same PI
conversation and submit an ordinary continuation through Composer. Observe that
the backend creates a new opaque CLI thread, retains exact model/effort and
restores through acknowledged `thread/inject_items` requests. Only historical
`message` items are inserted, never synthetic function/tool execution items.

Check every historical payload's ordered parts, part count and complete SHA-256.
Reassembling the text must reproduce all original user wording and complete
historical content byte-for-byte after the documented canonical JSON projection.
Each source identifies the original PI session/message and timestamp. No omitted
tail, summary substituted for raw content, reordered parts or duplicate batch is
acceptable. Per-request text chunking must not impose an overall history limit.

After every injection is acknowledged, the backend must refresh authoritative
host facts, then make exactly one `turn/start` for this user submission, containing
the current request/images, current facts and explicit recovery notice. Historical
tool results are identified as historical, not current source/build/play evidence.
The 1,048,576-character `turn/start` refusal must not recur from copied history.
The Agent must still read ordinary current world/source/brief facts before acting.

Before the actual player turn begins, no domain tool, source write, progress mutation,
candidate registration or adoption may have occurred because of restoration.
After it begins, record any normal tool work separately. A successful restore does
not prove that its subsequent Godot check, candidate adoption or gameplay passed.
Retain the original failed check and error records unchanged.

## H2: historical images remain images

Include an actual earlier `godot_view_capture` result and an earlier user image
attachment. Match the restored image blocks to their original MIME types and
byte hashes. Each image travels as a distinct `input_image` in a historical-data
message with original message provenance, never as base64 text in a JSON/tool
string and never labeled a fresh screenshot. Confirm current user images remain
ordinary images on the final current `turn/start`.

An image request can have a large encoded JSON size; measure text characters and
image bytes separately. Do not silently resize, drop or textualize an image to
satisfy a text-input limit. Any native image rejection remains a visible failure
with its actual protocol cause, not a successful complete restore.

## H3: cancel after a partial injection acknowledgement

For deterministic fault coverage, use the fixture app-server and hold the next
injection response after at least one acknowledged batch. Invoke the real runtime
abort path. Confirm the host turn is fenced, the owned transport closes normally,
the checkpoint remains unsynchronized and no `turn/start` or domain tool is sent.
Resolve/reject the delayed acknowledgement afterward; it must not revive the turn.

Submit the next normal continuation. It must create a fresh opaque CLI thread and
restore the full canonical transcript, not append the remaining suffix to the
partially populated old thread. Assert all parts and images again. Only the new
request may reach one `turn/start` after restoration completes.

If a real native cancel can be observed during restoration using ordinary UI,
record it separately. A scripted delayed acknowledgement is controlled protocol
evidence, not a claim of observed live CLI cancellation timing.

## H4: rejected or uncertain injection acknowledgement

With the fixture app-server, reject an injection with a known RPC code/message;
also cover transport closure while its acknowledgement is pending. The terminal
error must retain stage `history-restore`, recognized method and bounded sanitized
protocol cause when available. The backend must not resend that batch, fall back
to a single oversized historical `turn/start`, invoke another model, run historical
tools or claim synchronization. There must be zero `turn/start` requests for the
failed user submission, even if an earlier batch was acknowledged.

Keep the actual rejected transcript/turn visible. A later user retry follows H3's
fresh-thread/full-history path. Do not corrupt credentials, change the live API
endpoint or falsify a provider response merely to induce this scenario.

## H5: ordinary synchronized resume remains unchanged

Also test acknowledged interruption of a confirmed user turn with no pending tool
reply: the matching terminal `interrupted` acknowledgement plus a successful host
checkpoint save may preserve native resume and its existing compacted context.
Missing, foreign or post-retirement acknowledgement, a pending tool, unacknowledged
turn start, failed native fence or failed host save must not establish this state.
Do not obtain synchronization merely from the UI's `aborted` label.

Complete a normal model turn after a successful restore, close the application
normally and reopen the same conversation. When the canonical transcript/binding
still matches the synchronized checkpoint, expect `thread/resume` for that opaque
thread and no `thread/inject_items`. The new request retains Astra/xhigh and the
ordinary tool/permission boundary. Usage is based on actual CLI events; history
insertion acknowledgements are not fabricated model usage or successful turns.

## H6: native context maintenance during complete history restoration

Use full history that previously produced native `contextWindowExceeded` despite
acknowledged injection. Hydrate all original text in segments of at most 256 KiB.
For each `thread/compact/start`, observe its acknowledgement, own native turn ID,
matching completed contextCompaction item and successful matching turn completion
before the next segment. A maintenance completion must never finish the PI player
request. Foreign/missing terminal evidence cannot authorize continuation; model
rerouting remains a failure and maintenance tool requests cannot execute.

All user requests remain in the canonical PI transcript and receive explicit
anchors. Verify the tested original user wording and four historical image blocks
are available after the final original-text compaction. No base64 text, substituted
current capture or source/save mutation is allowed. Refresh current host facts
before the one actual player `turn/start`. Maintenance usage is unreported in the
consumed native notification contract: zero reset counters are not consumption.
Preserve completed maintenance count/time and explicitly incomplete coverage;
subsequently reported creation counters must not become a complete operation total.

With fixtures, interrupt an acknowledged but unfinished compact turn; also reject
compaction or omit its completed item. Expect no actual player `turn/start`, no
historical tools, no synchronized checkpoint, preserved native cause and normal
shutdown. Next ordinary retry rebuilds fully. Do not invent a timeout, model-call
cap, smaller history or successful maintenance event to force progress.
The cancelled maintenance case must explicitly send `turn/interrupt` with the
known maintenance thread/turn ID; merely closing stdin is insufficient. Its
interrupted acknowledgement must not synchronize the player checkpoint.

## H7: honest usage coverage after native maintenance

Replay the actual notification shape: `total` input/output/cache/total all zero,
while `last` has only a positive total. The active UI must show unknown total usage
and maintenance-unreported coverage, never zero consumption. Finish or abort
without creation usage; verify no zero usage baseline is saved. Then provide a
valid creation counter and verify it appears only as reported creation usage in
the incomplete-coverage metadata, not generic `message.usage`/complete total.

Cold-read the terminal message through Rust and render it again. Optional
`codexUsage.coverage` must preserve the reason, completed maintenance count, measured
time (or null) and reported creation counters. Transcript UI and offline export
must keep the total unknown even if a stale caller also supplies a numeric usage.
Read the already persisted 033 capacity marker without rewriting it; metrics and
context inspector must not display its 522,500 as token consumption. Ordinary
no-maintenance consistent counters remain visible. Native rollout usage audits,
if separately authorized, must clearly label their source and deduplicate unique
response records; they cannot be substituted for product-reported coverage.

## Required report and automated entry point

For a native context-full failure, preserve the structured classification from
both `error` and `turn/completed.error`, with matching CLI thread/turn ownership.
An all-zero input/output count paired with total equal to context-window capacity
must not appear as billed usage or become the next checkpoint baseline. Verify a
foreign error is ignored and a retry notification followed by success does not
become a failed PI turn. Never rewrite prior failed receipts to claim success.

Run from the repository root:

```powershell
pnpm -C vendor/pi-desktop/packages/agent-runtime exec vitest run src/codex-desktop-runtime.test.ts src/codex-native-compaction.test.ts
pnpm -C vendor/pi-desktop/packages/agent-runtime typecheck
```

Report H1-H7 independently as passed, failed or not run, identifying fixture,
source-native or packaged-native evidence. Include source/binary identity, profile
binding, original and reconstructed payload counts/hashes, image block counts,
injection acknowledgement counts, number of `turn/start` and domain calls before
restore completion, terminal status/checkpoint state, preserved original failures
and normal shutdown audit. Do not expose auth material or raw image data in the
compact report. A pending live integration result must remain explicitly pending.

Existing read-only projection evidence for the real 207-message session found
2,159,106 payload characters, four historical image blocks, no image data URLs in
text and exact reconstruction of every payload. It made zero CLI runtime/model
calls and therefore does not by itself satisfy native H1 or H2.
