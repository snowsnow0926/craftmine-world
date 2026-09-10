# P2 delivery: application explanations and preview recovery

Baseline: eae279915094f09d987ef0eb747eba20ef92cd0e.
Branch: codex/fb-p2-20260910; worktree D:/cm-fb-p2-20260910.

The preview now explains why ordinary adoption is unavailable and gives a visible next step. It keeps the existing advisory confirmation separate, presents raw errors as bounded text, and offers a read-only review refresh. Godot previews are explicitly uncommitted; no new public API or weaker backend check was added.

Actual source defects fixed: a late rejected review request could overwrite the new preview's state; Godot's authoritative unchanged-preview response after a pre-transaction apply rejection could leave the page permanently waiting for an application that never started. The latter now releases only the local attempt guard for an exact world/candidate match. P1 confirmed the existing preview status meaning. Existing attempts reconcile before another apply; save failure details remain visible.

Validation on this source:

- `node --test tests/player-feedback/P2/apply-presentation.test.mjs`: 21/21, including the unchanged admission matrix.
- `node tests/player-feedback/P2/apply-view-headless.mjs`: final 22/22. Actual product HTML/modules in isolated headless Chromium, finite fixture bridge/game. Visible states, safe text rendering, advisory confirmation, stale request rejection before corrective refresh, wrong/exact candidate-state identities, lost replies, no duplicate apply, full fixture snapshot including savedAt, and page reload were checked.
- Product view dependency bundling with existing read-only esbuild succeeded. Node syntax and git diff whitespace checks passed (Git reports the repository's expected future LF-to-CRLF conversion for world.html).

The first two DOM attempts failed before startup because the finite harness's inline bootstrap was blocked by CSP and then needed safe embedded-script encoding. Both reports/logs are retained. The third attempt passed 19 cases; the final expanded run passed 22. These are distinct runs, not cumulative scores. Production CSP was not changed. The harness's test-only inline bootstrap exception is explicitly recorded.

No real mouse/keyboard input, foreground activation, Pointer Lock, personal profile, model request, OS restart, actual Godot/Core runtime or new package was used. All new test/profile/TEMP outputs are under this D worktree; dependencies were read-only borrowed from C:/cm-plan-next-20260910. UI screenshot is of the protocol fixture, not a playable world. Actual engine/latest-progress transaction/package acceptance remains with the common client (P1/P8/P10); in particular, verify that the sibling native view does not cover the Godot preview explanation. Nothing here claims the player's original dog/hammer attempt was reproduced, because its original prompt and receipts were not provided.

Integration: import and bundle apply-presentation.mjs through the existing view.mjs entry. No Main registration change is needed. P2 owns view.mjs/world.html and this finite presentation module. Shared host/coordinator files are unchanged; P1 remains their owner. Branch is submitted for root review, not merged or pushed. Stop after delivery.
