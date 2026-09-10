# P8 bounded authorized model acceptance

This is an acceptance facility, enabled only by the headless controller and
`CRAFTMINE_P8_NATIVE=1`. It is not a general provider, RPC, scripting or file API.
The two fixed reconstructed requests create a hammer in a fresh first-person
world and a dog in a fresh top-down world. Their results must use the ordinary
chat, project, build, check, candidate and progress paths. A fixture is never
evidence of model creation or gameplay success.

`installP8NativeAcceptance` takes `enabled`, `window`, `world`, `call`, `panel`
and `active`. Its exact message envelope is `{type,id,method,payload}` with
type `craftmine-acceptance-p8`. Methods are initialize, submit, snapshot and
abort. Payload contains a fixed caseId (hammer or dog); initialize additionally
requires worldId. There is no caller prompt, selector, script, host path or RPC.
The selected world is checked before and after asynchronous reads. Each case
has one session/provider/world binding and one submission. Reopening can only
reuse the explicitly supplied matching session and exact model.

The authorized endpoint is `https://api.deepseek.com/chat/completions` and the
exact requested model is `deepseek-v4.1-flash-expires-on-0910`. A driver-owned
loopback relay accepts only POST at a random authenticated path. The fixed
`deepseek.com/v1` path suffix retains the pinned SDK's DeepSeek compatibility;
it cannot select the remote host. The original validated UTF-8 body is forwarded
without rewriting. Provider response model IDs are retained separately and
never replace the requested identity. There is no model fallback.

Only the relay reads the explicitly authorized configuration file, on its first
admitted request. The client receives a synthetic nonce, never the real key.
The relay injects authorization, redacts echoed credentials across streaming
chunk boundaries, bounds requests/responses to 8 MiB and each upstream request
to 125 seconds, and does not retry. Its synchronous admission counter permits
at most 16 forwarding attempts, including any SDK retries. Admitted requests
must be durably journaled before forwarding; retained admissions cannot regain
quota on restart. The current authorization has no cumulative token cap.

The driver must await a clean, compiled source identity approved by the root
integrator before sending any real request. Offline tests inject synthetic
upstream responses and never read the authorized file. Offline tests alone do
not establish model availability, output quality, P4 live usage reconciliation,
or successful gameplay. Raw request/response evidence, usage coverage and timing
must preserve errors and unknown values; relay and runtime clocks have different
observation boundaries and must not be presented as identical measurements.
