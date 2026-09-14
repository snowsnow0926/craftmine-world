# Codex legacy world regression — 2026-09-14

## Observed player failure

Read-only archived transcript metadata identifies session
`f9285320-cb4e-4c93-8fe0-b2923da361d5`, turn
`99c9ad0c-8e79-447e-b433-629e52375234`, original request `生成一个树`.
The selected backend was `codex-cli`, model `gpt-6-astra`; the adapter uses
`xhigh`. The durable turn began at `2026-09-14T06:45:41.978Z` and failed at
`06:45:42.002Z` with `CODEX_GODOT_WORLD_REQUIRED` (24 ms).

Source inspection independently confirms the failure happened after host context
read and before binary verification, thread creation or any model request. Main
only supplied Godot tools. The later manually selected `deepseek-flash` attempt
is a different provider run and is not evidence of successful Codex authoring.
No live player profile, credentials, model selection or window was modified.

## Targeted validation

From the isolated request worktree's `vendor/pi-desktop` directory:

```text
pnpm --filter @pi-desktop/shared build
pnpm --filter @pi-desktop/agent-runtime exec vitest run src/codex-desktop-runtime.test.ts
pnpm --filter @pi-desktop/agent-runtime typecheck
```

Result: shared build passed, all 26 adapter tests passed, runtime typecheck
passed. The tests load actual registered manifest tool schemas and mock the
app-server and host execution response. They verify runtime-specific selection,
ordinary host identities/risks, selected model/effort, continuation, the unchanged
Godot catalog digest, stale bindings, missing tools, denied permissions,
unregistered/native/shell calls, catalog changes and late callbacks after abort.
They do not claim that the mock tree payload compiles, renders or applies.

The new cancellation regression initially reproduced an undefined-client callback
after transport disposal; capturing the owning client fixed the error while
preserving zero late host writes. That initial failure remains distinct from
the player's original immediate runtime-kind rejection.

## Integration still required

Run the ordinary isolated desktop flow documented in
[the E2E plan](../spec/06-delivery/04-e2e-test-plan.md#codex-legacy-world-conversation-regression-2026-09-14).
Require a real selected Codex model turn, compiler/verification receipts, visible
tree, player application and saved/cold-reopened state. Do not claim these from
the unit results above. Existing player-controlled recovery remains mandatory
for an older interrupted task; do not erase its state to make retry pass.
