# Operation-owned capture for world publication

Date: 2026-09-15. Status: accepted for the player publication repair.

The NUWiAc repaired demo was applied and cold-reopened successfully. Ordinary
publication command 091 then failed with `WORLD_TEMPLATE_SOURCE_CHANGED` while
simulation was live. A normal frozen save (092), cancellation of the failed
publication, and new publication (093) succeeded; archive export 095 also passed.
The source guard includes the durable snapshot hash, so nonfreezing save followed
by description and archive work was not a stable capture transaction.

Use the existing runtime checkpoint to freeze/save, then preserve the exact
source guard through archive completion. A checkpoint also leaves a manual pause;
releasing that pause unconditionally could override a player's pause or candidate
application. A host-only closure therefore records the original instance,
pause-intent revision and releases only its own unchanged
intent. Existing overlay blocking still determines whether the engine runs.

Two narrowly validated main-window channels carry only world/operation identity:
`worldTemplate.capture` and `worldTemplate.releaseCapture`. The private panel owns
closures, tracks pending capture/archive work and denies overlapping captures in
the same world. Exact operation identity prevents an old unmounted submission's
finally from releasing a newer capture. The generic runtime-save navigation grant
and all model tools remain unchanged; no renderer-issued pause state or token is
trusted. Failed archive operations retain their existing journal and exact retry
semantics. This adds no new state database, automatic retry or execution budget.

Main refuses release after shutdown, copy, export, candidate or restoration has
taken ownership. Panel disposal follows the shutdown checkpoint and clears its
private table without resuming gameplay. A normal UI unmount still completes its
finally release after the in-flight request settles; a failed checkpoint retains
the existing host restoration logic.

Validation: 45 targeted CPU tests passed across world-publication capture,
navigation, player-library and immersion-pause suites; desktop typecheck passed.
The actual production submit/main/host methods and archive service are executed
with synthetic Core/runtime boundaries, including the original live-drift failure
and exact archive snapshot hashes. No native app, GPU or model was run for this
patch. Existing headless React fixture routing was updated and syntax-checked;
new sealed-package publication and ordinary sheet-close remain root integration
acceptance, not a claim inferred from the CPU checks.

## Autosave cache invalidation correction

The first sealed implementation published successfully but retained a pause after
ordinary sheet close. A second native run removed the earlier workbench-mode
confound: it opened the asset sheet directly from the running world, published
`player.world.1126b801c06c48798336110ba1c3b688` at 2026-09-14 23:43:45.685 UTC,
and closed the sheet at 23:43:45.686 UTC without changing mode or sending resume.
Physics tick remained 8921 through 23:44:20.117 UTC. The original failed close
assertion and direct-live evidence remain retained.

The actual host `save()` clears its cached frozen checkpoint on ordinary autosave.
That cache is not pause ownership: its invalidation does not advance the manual
pause-intent revision. The release closure no longer requires cache identity;
all original-instance, previous/joined pause, current intent, candidate and
shutdown guards remain. A CPU regression now runs the real host `save()` through
the coordinator autosave route between capture and release. Ordinary overlay
close resumes two subsequent simulated ticks, and later/manual/candidate/instance
guards still hold even after that same autosave. The targeted suite passes 46
tests. Final native validation requires two progressing post-close observations.
