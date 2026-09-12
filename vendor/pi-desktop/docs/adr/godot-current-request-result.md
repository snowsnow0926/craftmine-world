# Attribute Godot results to their player request

Status: accepted, 2026-09-13.

The latest real player transcript retained partial text claiming a pickup fix
when application shutdown interrupted the next model response. No patch or new
check reached the world, but the session's previous applied job was still its
latest result. A single session-level latest job cannot establish completion of
the latest request.

Keep job history and add host-derived turn/task attribution. Permit automatic
repair continuity through the existing exact capture identity, never matching
the player's text or a model claim. Qualify earlier results in the UI and block
their automatic presentation handoffs. This adds no authority, does not rewrite
the conversation, and does not force edits for read-only questions. Shutdown
terminal classification is repaired separately.
