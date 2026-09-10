# Craftmine operation metrics and build label

The transcript displays one host-accounted operation summary under its assistant turn: total tokens, output tokens per model-generation second, wall-clock task duration and the actual runtime-bound model identities. The DTO and persistence rules are defined in `task-metrics.md`. The renderer does not sum visual bubbles, estimate tokens from characters, substitute the current composer model, or treat absent provider usage as zero.

The read-only `sessionTurnMetrics` IPC delegates to `session.turnMetrics`. It requires a session identity and accepts either a turn identity or a message identity. The transcript uses the persisted message identity. A late response for a previous selection cannot overwrite the current operation. Running operations poll without overlapping reads; stopped operations allow a bounded final persistence refresh. Historical records lacking metrics display unavailable values. Partial provider coverage is explicit for both totals and TPS. Details preserve per-provider/model breakdown and the TPS denominator explanation.

The sidebar build label is static text derived from the host's version. It has no hyperlink, updater request, settings navigation or update dot. Missing version data does not create an invented number. This removes the footer update entry without removing license attribution or changing other settings routes.

Validation: `tests/player-feedback/P5/metrics-headless.mjs` mounts the actual React metrics and Sidebar components in an isolated headless browser. Its usage/IPC are fixtures, so its output is not actual-model or native-host acceptance. Final integration must verify a same-source host response across completion, session switch and restart.
