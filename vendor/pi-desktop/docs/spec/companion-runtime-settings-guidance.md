# Companion runtime settings guidance

For the published `cw.module.approved-pomeranian` v2 package, exported fields
are source defaults. `_ready()` initializes immutable source settings and a
separate runtime settings dictionary. The public `set_following` updates only
runtime settings; `snapshot()` returns copies of both dictionaries. Therefore
`get("following")` is not a current follow/wait query and repeatedly negating
that export can repeatedly set waiting instead of toggling.

The existing `creation-sandbox.authoring` guidance, version 1.8.2 in catalog
1.8.4, explicitly distinguishes these values. Its
`companion-runtime-settings` anchor contains a source-verified GDScript example
that reads the specific installed node's `snapshot().settings.following`, calls
the public setter with the inverse, then refreshes HUD/action labels from a new
snapshot. The first page also points to this distinction. Snapshot-copy edits,
private-field access, mass broadcasts and replacement identities are not fixes.

Only the guidance text/version/hash changes. The released component's ZIP,
content hash, scripts, assets and state format remain unchanged. Existing
source-interface cohort and archived-reference hashes remain intact. This adds
no live-component RPC, permission or persistence mutation, and does not modify
the player's generated world script. Actual wait/follow switching, feedback,
independent instances and save/reopen still require ordinary gameplay acceptance.
