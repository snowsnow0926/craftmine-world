# Retained failures and acceptance limits

The earlier native report passed its 23 assertions but did not inspect actual
world-list rows. Its screenshot shows the stale empty list despite successful
IPC calls. It is retained as an acceptance gap, not final UI proof. The final
native.json has 25 assertions, including bootstrap, change notifications and
the actual runtime label.

../bases/logs/side-view-full-import.log retains the Godot editor shutdown
ObjectDB/resource leak. Gameplay and isolated persistence checks do not erase
this failure. ../delivery-final.json contains the five actual missing
provenance declarations; missing export/package inputs are explicitly skipped.

Original A/B/C limitations remain in their reports: loopback access, simulated
executor/launch/persistence results, untracked diagnostic references and import
errors. This audit does not certify hostile native filesystem races, unlimited
resource containment, model-authored builds or independent installation.
