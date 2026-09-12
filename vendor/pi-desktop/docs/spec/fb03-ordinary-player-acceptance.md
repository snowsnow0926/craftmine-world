# FB03 ordinary model acceptance runner

Date: 2026-09-13. Status at driver commit: syntax and prepare-only plans checked;
native model runs still pending the integrated application and exclusive slot.

`tests/fb03-ordinary-player-loop.mjs` supports two independent normal flows:

- `--flow retained`: copy the retained domain and world files through read-only
  original-profile access, then enter that world, open dialogue and submit
  `给我生成一个AK47` through the actual ordinary composer callbacks.
- `--flow dialogue`: start with an empty isolated profile, enter new-world
  dialogue, type `创造一片能走进去探索的森林` in the actual preparation editor and
  explicitly queue it for ordinary submission after the real world is ready.

Each flow receives its own read-only model configuration snapshot. Retained
creation uses the original session's Flash/max binding; new-world creation
uses the original global/default-provider Pro/medium binding. Context and
output configuration are unchanged. The runner installs only that selected
provider through the ordinary API; it does not copy a credential database or
modify the original profile. Secret values are redacted and never printed.
The retained domain settings are copied intact, overriding only its selected
world ID. The launch preflight accepts both the legacy headless offscreen
guard and the explicit `isOffscreenAcceptance()` guard; runtime ownership
checks still require hidden, non-focusable windows and offscreen content.

The setup preserves the missing global permission preference. Auto must appear
through product session creation/defaulting, not a harness permission override.
Any permission card or required manual adoption is reported as a failure.
Clarification questions are separate: the runner writes a request file and
waits for a reviewed response preserving the original gameplay goal.

No model-call, token, repair-round or whole-run time limit is added. Each run
has a cancellation file and signal handler. Transport timeouts remain distinct
from model/run limits. Product/provider errors and logs are retained rather
than silently replacing the model or overwriting failed runs.

Completion requires actual checks, automatic adoption, closed dialogue and
ready playable presentation. F2 is used only afterwards to inspect the saved
result card, then normal save/quit/reopen verifies the formal build and that
no new model call occurred. Screenshots use the identity-bound native capture
API without changing fullscreen state. Retained pet-script and scene-node
preservation are checked independently of model prose.

The report explicitly leaves semantic acceptance pending: a subsequent test
must verify the generated weapon can be equipped and fired with ammunition,
or that the generated forest can actually be explored. Offscreen native
content evidence does not replace the separate normal-window input tests.
