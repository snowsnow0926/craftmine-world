# Godot entry read recovery

The world list alone determines which registered worlds are ready for entry.
Publish a successful `world.list` response before reading optional capabilities,
deleted worlds or task badges. A delayed task read must not leave the mode entry
loading, or hold the busy lock after a failed save-and-switch operation.

Capabilities and task metadata remain tied to the refresh generation and selected
world. A newer list invalidates earlier metadata replies. Clear world-specific
metadata on selection change. An archive read error is reported while keeping the
successful playable list available; it does not pretend the archive is empty or
turn a ready world into a loading failure. Main list failures retain the existing
error behavior. No runtime readiness, save or navigation authorization is bypassed.

The real React mode entry regression holds `task.current` pending, operates its
Enter button, rejects the archived-world read, fails then retries an actual row
selection, and checks that a late task reply cannot relabel the new world. Existing
create-cancel and failed-world retry tests remain applicable. These tests exercise
renderer callbacks with finite host receipts in an isolated headless browser;
they do not claim native attachment or physical player input.
