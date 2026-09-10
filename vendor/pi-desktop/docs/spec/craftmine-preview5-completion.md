# Craftmine preview 5 completion corrections

These changes follow actual preview 4 acceptance failures. They do not change
the creative prompts or turn failed model output into a passing result.

## Authorized request accounting

Only an isolated headless native P8 process with the dated `parallel-20260910`
or `unlimited-20260910` authorization forwards `maxRequests: null`. The parent
forwards its validated phase through the child environment; the agent sidecar
inherits that environment and its real runtime constructor supplies the budget
to the reservation hooks. Token-null behavior is preserved. The ordinary
request default stays 80; omitting a request limit in a partial reservation
keeps that default. Stored complete limits require the field. A task's first
reservation fixes its limits, and later reservations cannot change the policy.
The native snapshot checks the actual durable policy after at least one request
has been admitted, because a pre-reservation snapshot still contains defaults.

### Preview 6: the private broker boundary

The first packaged preview 5 attempt admitted zero upstream requests: the
private plugin host router intentionally rejected caller-owned `limits` before
Rust saw the reservation. The plugin process environment also excludes arbitrary
Craftmine variables. Main now passes only `CRAFTMINE_P8_UNLIMITED_REQUESTS=1` to
the built-in broker after validating the headless dated phase. Other plugins and
ordinary sessions receive no such bit or provider credentials. The broker owns
the first-request policy; the sidecar may only echo the exact authorized null
request/token policy with the unchanged compaction limit. Other values, review
parameters and attempts to widen an admitted task are still rejected.

The regression runs the actual DesktopAgentRuntime hooks, turn gateway, private
plugin router and real Rust binary for 81 settled requests. It also checks the
ordinary identity/limit-forgery protections and the filtered plugin environment.
Run `node desktop/build-world-plugin.mjs`, then use
`node --experimental-transform-types --test tests/player-feedback/P8/host-budget-route.test.mjs`
with `CRAFTMINE_CORE_BIN` set to the built binary and TEMP/TMP on the evidence drive.

## Actual offscreen frame capture

A detached WebContentsView can report `isPainting() === true` but repeatedly
return empty captures. The acceptance capture temporarily attaches its existing
game view to its own hidden, non-focusable offscreen window, preserves its
previous bounds and attachment, and restores both on success or failure. It
never shows, focuses or activates the owner or sends input. A four-second
deadline bounds capture reads and paint waits. Only real complete RGBA frames
of the requested dimensions with painted pixels qualify; otherwise the error
contains bounded readiness diagnostics. Scope is checked across asynchronous
reads and viewport observation. Restore operations release independently.

Regression coverage includes empty/hanging reads, detached views, destroyed
owners, scope changes, partial paints and restoration failures. The independent
native compositor probe reproduced repeated 0x0 reads with an unattached view,
then obtained a real 1280x720 frame using the corrected production host.
This probe is not a substitute for the full packaged Godot model case.

## Initialization and migration diagnostics

Initialization retries only an exact Rust world-list read timeout, never world
creation or other mutations. Terminal states and unrelated failures still fail.
The overall initialization deadline does not restart with a retry.

Equipment schema checks retain their strict key set. Rejected shapes now name
the previous/default side, field path and bounded expected/actual key sets so
the creating model can correct its own source. Existing old values and field
validation remain unchanged; no generated model source is manually repaired.
