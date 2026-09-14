# Godot player authoring guidance validation

## Original observation

The first ordinary Flash turn in `desktop-native-product-vJtlTm` requested a
tree. The preserved run used the player's 1M context / 384K output / maximum
thinking configuration. It recorded seven model responses, 18 successful tool
invocations, 118633 ms and 480088 total tokens (359936 cache, 102754 input,
17398 output including 14673 reasoning). These are original-run measurements,
not the result of this prompt change or an added evaluation budget.

The visible trace read durable facts, capabilities, the source index and guidance,
then creation data/schema, the initial save, project, scene, generator, player and
camera scripts before a supported `creation_operation` placement. Its final
response described pending full-auto adoption but also recommended reopening the
world and repeated revision/job/hash detail. The host subsequently applied it.
No tool failed. The raw session/turn records remain unchanged; full reasoning is
not reproduced in these docs.

Source review identified three gaps: the tool description did not explicitly
name Godot; the nullable journal projection was not explicitly distinguished
from project absence; generic application wording and duplicate first-read
instructions obscured the ordinary automatic workflow. Existing source guards
already enforce `creation-sandbox` and route to `godotProject.patch`.
The original capability result already marked `creation_operation` advertised,
wired and reachable via `godotProject.index+read+patch`; the original facts result
reported `project.available: true`. This is a guidance/interpretation correction,
not a claim that the original Godot tool or project was missing.

## CPU checks

- `craftmine-context.test.ts`: 62 passed, including real request preparation with
  Godot identity plus null projected facts, unchanged host target/empty receipts,
  and the full 1M/384K allowance. Manual authorization is not promoted, pending
  adoption is not success and unresolved diagnostics are not suppressed.
- `creation-source-service.test.mjs` and `creation-operations.test.mjs`: 31 passed.
  The actual source compiler/service produces a draft needing checks; the
  advertised Godot scope is tested against rejection of another base. Existing
  target/source/runtime identity, collision, replay and progress guards pass.

The agent-runtime TypeScript check and isolated world-plugin build also pass.

No model, GPU, browser input or active profile was used in this change's tests.
The suite validates prompt injection, descriptors and unchanged contracts; it
cannot prove fewer model calls, lower token usage or better subjective answers.

## Follow-up boundary

The active six-step playtest continues on its original package and prompts.
Only a later rebuilt package receives this change. Preserve both run identities,
the same player model/thinking/allowances and complete original task scope when
comparing. Do not replay earlier completed requests as new work, force a chosen
modeling implementation, impose per-task limits or erase old failures to improve
the comparison.

## Package-error interpretation follow-up

The same original preview26 playtest later encountered a combat archive whose
three entity declarations conflicted with a single-entity scene installer.
The actual repeated error was `PACKAGE_SINGLE_ENTITY_DECLARATION_REQUIRED`.
The visible transcript then tried repeated archive group items, invented
`entity` fields, `request.entity`, an inner resource hash, and position/query
variants. These introduced separate schema and asset-identity errors without
repairing the archive contract. The model's claim that rules required exhaustive
parameter exploration was its own incorrect inference: the existing guide
already permits ordinary authoring when assets are unavailable or unsuitable.

The follow-up only clarifies error layers, complete-archive group semantics,
evidence-based retries and goal-preserving alternatives. Package data repair is
a separate change. `source-library-error-guidance.test.mjs` uses the installed
PI argument validator and actual source service to reject invented selectors
before host calls. The added request-boundary test preserves the original error
tool result during retry. No active model run or raw transcript is altered;
behavioral improvement remains unverified until a later rebuilt-package test.

The original monster turn was subsequently stopped through the normal controller
abort after the package contradiction and repeated parameter guessing were
established. This was not a request/token/time threshold. Duration was 15m25.67s;
24 model requests were observed and 23 had reported usage, totaling 5221792
reported tokens including 4316672 cached and 161939 output (153792 reasoning).
One compaction was followed by another full-library search. The same world was
saved for continuation under a corrected package with the original player goal;
no successful continuation has been pre-recorded.

Follow-up CPU validation: 63 request-context tests and 15 source-library/schema
tests passed. Agent-runtime typechecking and the isolated plugin build passed.
