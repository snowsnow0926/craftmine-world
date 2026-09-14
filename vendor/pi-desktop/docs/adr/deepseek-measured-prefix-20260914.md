# Calibrate an exact request prefix from successful DeepSeek usage

Date: 2026-09-14

Status: Accepted for the verified official DeepSeek text transport.

The A2 1M/max/384K test showed a real mismatch between measured prompt usage and
the UTF-8/2 complete-request estimate. Its first physical request consumed 199435
prompt tokens including cache, but reserved an estimated 485402 input tokens.
Four subsequent tool results pushed the conservative request past the 521859
trigger. This was not a reduced window or a second subtraction of output capacity.
Changing a global byte ratio would make unknown payloads less safe.

Use exact in-memory native and wire prefix receipts instead. Retain the whole
measured prompt count as an upper allowance for all but its final message, then
estimate every current remaining message and new host snapshot conservatively.
The old snapshot stays included in the measured allowance; no subtraction or
estimated tokenizer ratio is used. Hashes bind model, task, system, tools, output,
final body options and transport headers. Media and any mismatch keep the old
full estimate. A process restart cannot fabricate a receipt from transcript usage.

This needs two-phase reservation: the previous hook reserved irreversibly before
the SDK produced its final payload. An eligible request now prepares facts, validates
the exact serialized body at the trusted fetch boundary, reserves the final estimate,
then dispatches. The existing SDK retry wrapper still accounts for each attempt.
Late cancellation is checked before and after reserve; malformed serialization or
failed reserve sends no request. SDK connection-error wrapping must not hide a local
pre-send capacity refusal from the normal one-time overflow-compaction path.

Only official DeepSeek creation/retry requests from the known runtime transport
enable this path. No provider metadata, player window/output setting, host authority,
tool permission, transcript schema, media estimate or task budget is widened.
Pure verification and pinned-SDK/native-loop tests establish mechanics; synthetic
usage in these fixtures is not evidence of real-player token savings. Packaged
real-model revalidation is an integration step, not claimed by this commit.
