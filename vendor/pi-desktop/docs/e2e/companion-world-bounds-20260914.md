# Companion world bounds verification

`tests/godot-components/companion-world-bounds.mjs` uses a copied pinned engine,
`--headless` and independent data for two separate write/read processes. No GPU,
provider, product profile, physical input, focus or Pointer Lock is involved.
The actual scripts capture z=-200 and foot y=-0.0001868, then fresh instances
restore all JSON fields exactly. A real floor and actual pet shapes check contact
and overlapping-pet rejection. Further checks reject invalid bounds, NaN,
Infinity, strings/null, yaw/count errors, foreign identity/sourceSettings, and
positions inside the old cube but outside configured world bounds. Both v2
snapshots restore with their unchanged schema and source/runtime settings.

Final result: `test-results/companion-world-bounds-Rm4OQY/report.json`, 74 write
and 76 cold-read assertions passed. Earlier failures remain separate; they exposed
the generic pet's nonoverlapping-peer branch, corrected only in v3. These are
component state/physics fixtures, not complete-city graphical or pathfinding
acceptance. Real gameplay and saving/reopening still require the normal app.

Package/recipe tests verify old ZIP hashes, unchanged visuals/state schema, v3
selection, exact source configurations, unknown override refusal, and safe
source-local plans. Set `CRAFTMINE_GODOT_CACHE_DIR` to the pinned 4.7.2-stable cache
for the CPU test; never reuse a live player profile.
