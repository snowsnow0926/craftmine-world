# Separate measured-prefix identity from task authorization

Status: Accepted, 2026-09-15.

NUWiAc's fourth turn ended with 299425 actual prompt tokens including cache. Its fifth turn changed turnId, taskId and baseBuild while retaining the same session, world, provider and generation. The old measurement key included the full task binding, so it necessarily rejected the previous receipt. The resulting 557257 input estimate exceeded the unchanged 521859 threshold. This was an estimate, not measured usage. Earlier turns also began with a full estimate but stayed below the threshold.

Permit a narrower, separately named measurement scope for currently authorized full-auto Godot sessions. This removes changing task identity only from the measurement key, never from reservations, settlement or execution. All exact native/wire checks remain in force and the old entire measured prompt count plus newly estimated tail remains conservative. Other permission modes, unknown authorization, different worlds/sessions and generation changes retain task-bound or mismatching measurement identity.

The scope is private in-process state; it does not persist caches across runtimes or restore a proof from transcript usage. Offline replay may use historical measurements to examine a reconstruction, but production only remembers the actual final payload after a successful known-usage request and current ledger settlement. System, tools, media, transport and body changes are not forgiven merely because the session matches.

This amends the original task-bound measurement scope in [the measured-prefix ADR](deepseek-measured-prefix-20260914.md). Its authorization, final-body proof and cancellation boundaries remain unchanged.
