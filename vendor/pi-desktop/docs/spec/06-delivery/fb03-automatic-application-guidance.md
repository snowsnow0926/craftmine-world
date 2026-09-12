# Automatic application guidance at the author-turn boundary

The `2e6` packaged ordinary-player AK47 run completed its check and was adopted
automatically when the author turn ended. There were no manual adoption actions.
The model had read an accurate `deferred / CREATION_TURN_BUSY` receipt, but its
final response incorrectly told the player the work still required a technical
panel. The long source guide described automatic settlement near its end, while
the tool description omitted `deferred` and emphasized rereading the job. The
bare receipt did not explain that finishing the current turn enables adoption.

## Contract

`godot_build_read` keeps the original `creationApplication` status, reason and
identities. A separate `applicationGuidance` describes the current handoff.
`project_inspect` exposes the same authorization-specific workflow before long,
paginated source guidance. The manifest lists all actual application states and
distinguishes an active engine check from a passed check awaiting turn settlement.

Automatic wording requires the current host-bound full-auto capture, the same
world, a valid invocation owner, and matching job/build/candidate receipt. A
superseded capture, stale source, missing capture, crossed identity or current Ask
permission cannot promise automatic adoption. Main-process model context and
the private capture service recheck the current effective session permission;
this only downgrades presentation and never changes the frozen authorization.

For an exact authorized `deferred` receipt with `CREATION_TURN_BUSY` or
`CREATION_AWAITING_TURN_FINISH`, guidance says the app will automatically place
the work after this author turn ends. When all requested changes are included
in the final passing check, the model should complete its response rather than
wait for its own turn to finish or require the player to visit a technical panel.
It must not say the work is already adopted. A later edit, failed check,
cancellation, permission or world change remains subject to the existing guards.
`manual` still asks for ordinary result confirmation; uncertain or failed states
remain distinct. No final model text is intercepted or rewritten.

## Verification

- Actual registered model tool execution covers both after-turn reason codes,
  immediate return without a polling deadlock, preserved receipts, explicit
  Ask/manual, absent/foreign/revoked/superseded capture, and exact owner/job scope.
- The compiled plugin's real `project_inspect` path includes early guidance and
  the packaged helper dependency. No tool-set or caller arguments grant authority.
- Permission-context tests cover Auto to Ask, unchanged frozen capture, capture
  disappearance/cross-world change during permission reads, stale source and
  mismatched receipt identities.
- Existing application-state and read-wait tests still cover cancellation,
  deadlines, missing/uncertain receipts, and no premature `applied` status.

These deterministic tests prove the returned contract. A later ordinary-model
packaged run is needed to evaluate whether its natural-language response follows
the clarified guidance. The original successful gameplay and contradictory
wording evidence remain preserved.
