# Main agent event ownership follow-up

The read-only integration audit found that delayed old root errors/end events
could close the session's newer active turn. Old assistant rows also used the
current turn ID, and old usage could accumulate under the new session turn.

The bounded Main change checks exact root-envelope ownership, retains original
row identity, rechecks the expected turn before finalization, and awaits the
existing regenerate archive before releasing ownership. Delegate terminal
events cannot close the parent. Task metrics recorder changes are owned by P8
and are not part of this commit.

Validation: nine tests execute the actual extracted/transpiled Main functions
with finite dependencies, including a blocked archive and a subsequent turn.
All nine passed. `git diff --check` passed. The raw log is
`agent-event-turn-ownership-final.log` beside this report. No Electron, Godot,
model request, operating-system input, full desktop build, or full typecheck was
run for this bounded fix. Root must integrate and validate against its current
Main metrics wiring before freezing the P6 client candidate.
