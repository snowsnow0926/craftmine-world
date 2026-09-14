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
