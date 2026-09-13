# Reusable flight and city: formal runtime acceptance

The drivable J20 and all three city fragments passed normal native source
installation, engine checks, candidate preview, formal adoption, actual rendered
inspection, player movement, save and cold reopen in independent profiles.
These runs used no model, real mouse/keyboard input, focus, or Pointer Lock.

The flight run boarded using the ordinary interaction key, accelerated along a
real runway, took off, changed gear and camera, saved in the air, and compared
the exact paused snapshot in a fresh process before resuming. The independent
native physics suite additionally covers actual landing, taxiing back, exit and
collision recovery. Existing player/world source stayed intact. Aircraft
collision now includes ordinary world objects; the flight HUD has its own
space below the original controls. The built-in thumbnail is an actual captured
complete aircraft, with source and runtime identity recorded in `preview.json`.

The city run installed the street and gate, walked on their real collision,
saved/reopened, then independently installed the single building and repeated
the lifecycle. Ten geometry routes cover two copies and house entrances. Real
receiving-world rendering exposed coplanar sand flicker; only the included sand
mesh and matching collider now sit 20 mm above the normal Y=0 floor. All
original and extracted GLB bytes remain unchanged. The library now supplies
measured entrance and interior waypoints, plus new actual component previews.

Adopting raised ground under the saved player correctly failed collision
validation in a diagnostic run. The passing run used normal walking and a save
outside that footprint before installation, then walked back onto the surface.
No player pose, source snapshot, successful-check receipt or collision tolerance
was fabricated. The same-source private `openPaused` helper uses the existing
covered-chat pause mechanism; ordinary world opening still resumes normally.

Compact evidence is in
`docs/evidence/reusable-flight-city-20260913/formal-native.json`, including hashes
and locations of both complete local reports. The repeatable product pipeline
driver is `tests/reusable-flight-city-native.mjs`; package/source tests and
physics/visual drivers remain separate so none substitutes for another.
