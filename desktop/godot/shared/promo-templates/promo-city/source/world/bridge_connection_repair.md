# Rear bridge / highland junction repair

The host-observed player was at (36.4433136,14.70008,-169.2212677), with org-gate, org-strength, org-drag and org-hall discovered. These are observations, not replacement save values; no player/progress file is edited.

Retained original city model inspected and edited through Blender. New editable sourceJobId: 09d21a4a-54ac-46b9-91fa-291c15dccfcb, replacing assets/blender/orgrimmar-city.glb. Prior sourceJobId: 62355201-b396-4fcb-9128-3ef771d17492.

Geometry assertions in the Blender edit confirmed and split the two south guard faces at Blender y=168.92 (Godot z=-168.92), removed precisely twelve visual rope spans, thirty-four old step components and four old sloping handrail beams. Two mirrored 4m junction openings are at x=35..39 and x=-39..-35. Everything outside the bounded junction edits is retained, including the north bridge rails.

Old ramps rose from height9 at Blender y157 to height14 at y173, leaving a roughly one-metre mismatch at the bridge's south edge. New slopes rise from9 to13.8 over y157..168.75, followed by a short level landing to y169. Existing bridge deck collision remains13.8 to preserve the current player's support; keep-edge bevels bridge the existing20cm shelf transition. Both exposed slope sides receive visible and collidable1.35m guards, with open ends only at supported landings. No route teleport, movement boost, collision bypass or progress reset is added.

Runtime keyboard look adds four independent arrow-key actions and calls the existing player's set_look(), preserving its yaw wrapping, pitch clamp and saved look state. Movement and camera scripts, controller parameters, original lighting shader, districts and inventory schema are unchanged.

bridge_walk_audit.gd is an ordinary bounded regression probe, not a modified host/frozen check. It runs the same installed motor script on disposable full-size capsule bodies through native move_and_slide against actual scene collisions, with fixed1/60 steps, digital directional axes, gravity, release/deceleration and no jump. It checks east/west hall-highland round trips and mirrored reported-position corridors, plus guard ray hits and unchanged actual player/inventory/camera. Only the probes are spawned/positioned; the player is never repositioned. Runtime failures are surfaced rather than converted into success. A passing managed build still does not prove application or a human/live-input walkthrough.
