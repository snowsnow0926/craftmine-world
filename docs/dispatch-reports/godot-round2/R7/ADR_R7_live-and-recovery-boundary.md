# ADR fragment — Live state, durable facts and recovery boundaries (task R7)

Status: prepared by `R7`, numbering to be assigned by root. Companion spec:
`SPEC_R7_model-runtime-and-recovery.md`. Amends the round-one decision in
`ADR_model-tool-context-boundary.md`.

## Context

Round one separated durable progress from live game state but left three gaps:

1. The per-request host snapshot carried no Godot identity, so after a compaction
   or a model switch the model could not rebuild which project/build it was
   working on.
2. Live observation had no instance identity or freshness rule, so a restarted
   game process could be read as the same session.
3. Interrupted drafts and managed jobs had core RPCs but no model entry point,
   and the asset/package/history tools were bound to provisional method names.

## Decision

1. **The tail snapshot carries a durable Godot identity line.** `godotFacts` is
   derived only from values the host journal already holds (applied build, world
   and draft revision, the most recent journaled source manifest hash, candidate,
   verification count, executor gate). It is appended as machine data on every
   request, so it survives any number of compactions and a model switch without
   the model having to remember anything. It never contains live camera,
   equipment, entity or quest state.

2. **A legacy world produces no Godot line.** The block requires an explicit
   `godot` section or a journaled source manifest hash. A build id and a draft
   revision exist for legacy worlds too and must not be relabelled as Godot facts.

3. **Live samples are identity- and age-checked.** A sample without
   `worldId`/`buildId`/`instanceId`, from another world or build, from a replaced
   instance, or older than the freshness window is marked stale with the reason
   and does not become the new baseline. Durable progress never fills a live
   field, and a missing sampler is reported as unknown rather than empty.

4. **Recovery is an explicit, session-bound action.** Listing and resuming are
   separate operations. Resuming requires an exact listed `taskId`+`generation`
   that belongs to the current session and a new turn; expired and conflicting
   selections return their real reason. Resuming counts as a write, so a
   discussion-only turn refuses it.

5. **Executor-facing methods stay host-only.** The model may read the executor
   gate and durable usage and may re-queue a failed job, but the token-gated
   lease operations are never exposed; they are reported as existing but not
   callable.

6. **Domain method names come from the delivered interfaces.** Asset, package and
   content-history bindings use the names in the R6/R4/M interface documents.
   Until the core registers them the tool returns the exact missing method and
   owner; when registration lands, the tools work without modification.

## Consequences

- After a compaction or a model switch the model can always recover the durable
  project identity from the request itself; `godot_project_facts` remains the
  explicit full rebuild including executor state, durable usage and limits.
- The product never shows a stale sample as current, and never shows saved
  progress as the player's current equipment.
- Asset/package/history tools are honest about being blocked until R1 registers
  the dispatch entries; the capability report marks them `reachable:false` with
  `blockedBy:'DEPENDENCY_NOT_WIRED'` rather than claiming the ability.
- The block is a per-request tail, not a stable-prefix change, so prompt caching
  behaviour is unchanged.

## Alternatives rejected

- **Inject Godot facts into the stable system prompt.** Rejected: they are
  per-request values, and putting them in the prefix would invalidate caching and
  risk treating stale facts as policy.
- **Let the model read the last saved snapshot when the live sampler is absent.**
  Rejected: that is exactly the "task-start snapshot as current equipment" bug.
- **Expose the executor lease token to the model so it can drive jobs.** Rejected:
  the lease proves an isolated executor owns the job; a model must not hold it.
- **Let `resume` accept any interrupted task the model names.** Rejected: a stale
  or foreign selection must fail with a reason, not silently open another task.
