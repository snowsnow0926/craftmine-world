# Keep optional world metadata outside navigation completion

Status: accepted for the September 13 Godot reliability repair.

The previous worlds refresh awaited list, capabilities, archived worlds and active
task before publishing any state. The same refresh ran inside action `finally`
blocks. A pending task read could therefore conceal a ready world indefinitely and
leave return/retry disabled after a save error. An archive read rejection also
discarded an otherwise successful main list.

Commit the authoritative list immediately and resolve optional metadata separately,
guarded by the existing refresh epoch. This preserves action error messages and
host save/switch checks while removing an unrelated dependency from the player's
ability to enter or recover. It requires neither an invented timeout nor a new
backend protocol.
