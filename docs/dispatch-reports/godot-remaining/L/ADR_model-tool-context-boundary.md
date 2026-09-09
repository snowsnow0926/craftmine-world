# ADR fragment — Model tool boundary for Godot engineering (task L)

Status: prepared by task `L`, not yet assigned a number. Root merges the final
numbering and folds this into the ADR index. Companion spec:
`SPEC_model-tools-and-context.md`.

## Context

The product problem is not that Godot lacks capability. It is that the model had
no reliable way to learn what was actually wired, so it answered "I have no
capability". At the same time, three failure modes had to be prevented:

1. presenting durable saved progress as the player's current state;
2. treating documentation or project text as host instructions;
3. letting the model change scope (branch, world, all instances) or perform git
   and shell operations on its own.

## Decision

1. **Capability is derived, never declared.** The model-facing inventory is
   computed from the manifest catalogue, the broker routing table and the real
   core handshake. A missing or false flag is reported as such, with the owning
   subsystem. Adding a tool does not flip a capability constant.

2. **Observation has two explicit layers.** A durable build descriptor and a live
   sample from the running instance are separate result sections. Only the live
   sample may describe the current camera, equipment, entities and quests, and it
   must carry its own timestamp and identity. Durable progress is labelled as the
   last confirmed save. When the live sampler is absent the result says so; it
   never substitutes a task-start snapshot.

3. **Retrieved text is data.** Documentation, project source and tool results are
   returned inside an untrusted envelope with an explicit instruction policy. The
   model may cite them and must not follow them as instructions.

4. **All content references and operation identities are host-bound.** An
   `OperationContext` supplies operation id, world, repository, branch and the
   expected head/applied/progress values. The model cannot choose a target branch
   or world, and cannot fabricate a receipt. Asset references must name an exact
   immutable version and content hash.

5. **Writes are proposals.** A change proposal is never applied by the model.
   The three player intents (one instance, save a variant, upgrade all selected)
   are distinct and validated. Git writes stay behind the owning subsystem; no
   git or shell entry point is exposed.

6. **Discussion-only turns are read-only at the broker.** Write tools are refused
   before any host call.

7. **No new execution path.** The new tools either read the durable store through
   existing RPCs or call the core handshake. They add no world database, no model
   loop and no widened permission.

## Consequences

- When a dependency is missing (for example the live sampler or the M/N
  adapters), the model receives a precise gap with the owner and the required
  method instead of a fabricated result. This is the intended behaviour, not a
  defect.
- The capability inventory becomes the single place to look when a request seems
  impossible; it must be kept in sync with the broker routing table, which is why
  the routing table lives in its own dependency-free module.
- A stale system-prompt claim about Godot availability (for example the current
  text saying builds are unavailable) now contradicts a tool that reports the real
  handshake. Prompt text should defer to the capability report. That change is
  outside this task's tree and is filed as an interface note.
- Host-injected context (the per-request facts block) is an optimization on top of
  on-demand fact reconstruction, not a prerequisite for it.

## Alternatives rejected

- **Let the model read the last saved snapshot as "current state".** Rejected: it
  would answer with the equipment the player had when the task started.
- **Report an unknown capability flag as available.** Rejected: it recreates the
  original bug from the other direction and would claim abilities that are gated.
- **Add a second model loop or a separate world store for Godot.** Rejected: PI
  remains the single loop; the Rust core remains the single durable store.
- **Expose a generic git or shell tool.** Rejected: git writes stay behind the
  version-management owner and the model only proposes.
