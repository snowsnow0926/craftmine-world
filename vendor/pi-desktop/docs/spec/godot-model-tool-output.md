# Godot model read summaries

`godot_project_facts` and default `godot_build_read` return model-facing summaries.
This is a presentation projection after existing host identity checks,
diagnostic derivation and application reconciliation. Rust records, executor
artifacts, stored output hashes, classification and UI history are unchanged.

The summary preserves core job status, source revision/manifest, `sourceStale`,
candidate identity, `creationApplication`, current-host `applicationGuidance`,
native evidence validation, requirements binding, all distinct diagnostics and
their original messages/fingerprints/evidence references. Identical diagnostic
items share one entry with `occurrences`; their evidence references are united.
The common source identity appears once at `diagnostics.source`, referenced by
`sourceRef`. Different source pins or other diagnostic fields never merge.
Observed engine log errors in a passed job remain observations; neither log
cleanliness, model blame, adoption nor gameplay acceptance is inferred.

Raw import/runtime logs and default snapshots become an explicit
`omitted-from-summary` descriptor: original JSON pointer, SHA-256, character
count, encoding and untrusted-data marker. Identical output artifact metadata
can reference the top-level artifact array. Diagnostic evidence retains its
pointers, hashes and upstream truncation state without repeating log previews.
Compilation errors, assertion results and migration evidence remain.

Every summary supplies `summary.fullRead`, an exact
`godot_build_read({jobId, detail:"full"})` request. `detail` accepts `summary`
(default) or `full`, is consumed locally and never enters Core arguments.
The full read returns the original decorated representation including logs and
per-diagnostic sources. It uses the same world/turn/job identity checks and
application reconciliation. It is a fresh read: a running job or application
may have advanced; compare source/output hashes before treating it as the
earlier observation. No additional authority is granted.

Recovery facts apply this projection only to their verified session-latest
job diagnostics. Task scope, budget, stale-source comparison, candidate and
unknown application coverage remain intact. Their nested `summary.fullRead`
provides the job's original evidence without repeatedly embedding raw logs.
