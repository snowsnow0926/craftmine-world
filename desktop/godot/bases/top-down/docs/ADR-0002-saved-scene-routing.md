# ADR: restore scene identity before publishing the player

Status: accepted.

The project entry scene is a creation default. It is not authoritative over a
saved player's scene. Previously the entry scene bound itself unconditionally,
overwriting the saved scene identifier and replacing saved facing with the new
player node's default. Positive inventory/quest restart tests did not detect it.

The world manifest now supplies `scenes`, a mapping from stable scene identifier
to authored `res://scenes/*.tscn` path. Startup captures the validated saved scene,
position and facing before any scene binds. If the entry scene differs, its
processing is disabled and a deferred load routes to the saved scene. The final
scene applies the saved position and facing (including sprite direction) before
publishing its binding. No save is allowed while this routing is pending.

A missing scene mapping, failed resource load or mapping to the wrong root scene
identifier records a boot error and inhibits saves. The base does not silently
reset the player, guess scene names, or overwrite the old progress file. Existing
authored projects that adopt this runtime must include their scene mapping when
they support resume outside the entry scene. Persisted state format remains v1.

The headless probe waits for the final binding or a boot error. New process
acceptance observes the restored state using only `snapshot`; it does not repair
the state by issuing placement, facing or scene commands after restart.
