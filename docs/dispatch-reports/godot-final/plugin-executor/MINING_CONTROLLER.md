# Fixed mining client evidence controller

`createGodotMiningAcceptance(access)` accepts only `godotPlayMine`. Root should
bind the same trusted `observe`, `action`, `capture`, and durable `save` callbacks
used by the other authored-base acceptance controllers; no renderer-selected
game operation, script, source path or state is accepted.

Create **mining-sandbox / mine-camp**, wait for its real check/application, then
invoke the fixed method. The controller requires the actual authored seed
31415926. It resumes and waits 40 physics frames, captures the complete native
progress, uses ordinary `move`, then reads at most a 3-by-4 local tile region per
dig. It preferentially mines stone, otherwise opens soil using normal gameplay
validation and gravity. Limits are 24 digs and 650 total business operations;
no legal target or rejection produces explicit failure evidence.

After actually gaining two stone it invokes the existing `stone-brick` recipe,
verifies two inputs consumed and one output granted, chooses a supported empty
tile outside the player's body, and places the crafted brick through ordinary
`place`. Each edit is cross-checked against live tile/inventory, full native
chunks, exact edited cell coordinates/material, and terrain hash. No expected
state is assigned and no game rule or base source is changed.

The final pause captures full progress and a 1280×720 PNG. It requires matching
PNG dimensions, the root's actual `surfaceSize`, positive
`logicalViewportSize`, and stable world/build/instance identity. The durable
save must return the real core progress receipt, then every native field in the
paused snapshot is compared canonically without exclusions. Root must still
restart the actual client and compare this `finalState` with the reopened
world; the controller does not claim process-restart acceptance itself.

Failures return `ok:false`, raw actions/observations/snapshots/checks and the
error; they attempt only `pause` for cleanup. Success is not inferred from a
timer, screenshot header, tool reply alone or a synthetic fixture.

Local command:
`node --test --test-isolation=none tests/godot-final/mining-acceptance.test.mjs`
passed **4/4** controller-negative tests: unknown methods cannot write state,
empty terrain stops after 12 tile reads and preserves failure evidence,
identity changes invalidate the run, and observations cannot replace complete
chunk saves. Initial test fixture syntax error was corrected before the passing
run. These are contract tests, not native mining acceptance; real offscreen
client execution is pending root integration.
