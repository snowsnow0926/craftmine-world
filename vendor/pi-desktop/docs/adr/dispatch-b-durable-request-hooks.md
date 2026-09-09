# Dispatch B: inject durable request hooks into PI

Status: ready for integration, 2026-09-09.

The desktop already owns session lifecycle and PI owns the Agent loop. Rust Craftmine core owns task identity, drafts and evidence. Duplicating either loop or budget persistence would allow compaction and retries to diverge from applied-world facts.

Add optional typed request hooks to PI runtime and one-shot completions. The sidecar receives only the host-owned world scope and resolves current context through a narrow reverse proxy. Main one-shot review receives a hook adapter bound to its immutable owner. Every physical attempt, including PI-generated summaries, uses the same ledger. The hook never stores a replacement local JSON budget.

Read-only inspection feeds PI's existing compaction guard; final reservation happens at the stream boundary. Stream terminal events are held until durable settlement. Actual tokens and conservative preflight estimates remain distinct. Image payloads are deliberately overestimated until model-specific image accounting can be supplied without weakening the guard.

Host integration must compare claimed binding/generation to its captured identity. Late settlements may only name a host-recorded reservation; stopped turns cannot create new reservations. Runtime filters are defense in depth; generic host tools must also reject world-bound calls. The plugin process itself retains its existing OS rights.

No complete W3 claim follows from provider fixtures. Real native model completion after three forced PI compactions remains a separate acceptance gate.
