# Hidden Godot initial load

The runtime ready event acknowledges bridge registration, not state loading.
A native WebContentsView may be detached or hidden during candidate preparation.
Its lack of animation frames must not prevent the host's initial load request
from reaching the existing base adapter.

`runtime_bridge.gd` enqueues valid requests and starts its existing serialized
drain on receipt. `_process` remains a fallback. The busy guard covers the whole
async operation and response; a subsequent request cannot overtake it. No
physics ticks, progress fields, successful responses or visible frames are
fabricated. Gameplay operations that await physics still await real physics.

The host freezes startup failure diagnostics before disposing the view. Its own
destruction must not replace the causal fault. An actual renderer failure after
ready rejects pending initial-load requests immediately; late replies cannot
revive the failed runtime. A ready runtime without pending requests retains the
existing startup-abort behavior.

Validation distinguishes receipt loading from visible rendering. The fixed
four-base probe checks the full load-response snapshot before resume, checks
hidden paused snapshots, and loads the same snapshot into a replacement instance.
The offscreen variant separately validates a 1280x720 physical surface and a
nonempty actual image. A zero-sized detached surface is reported honestly and
is never counted as visible/player acceptance.

No new page RPC, model permission, input simulation, focus request or Pointer
Lock request is introduced. This contract does not itself persist the host's
initialization error across application restart.
