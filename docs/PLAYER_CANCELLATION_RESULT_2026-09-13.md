# Actual player cancellation

The existing PI Desktop prompt path used the verified local Codex CLI with
`gpt-6-astra` and `xhigh`. A fresh isolated profile created and saved a blank
Godot world, then requested a walkable courtyard. After actual streamed model
text arrived, the controller called the same `agentAbort` API as the Composer.

The completed run acknowledged abort in **138 ms**, became inactive in **141 ms**
and durably recorded `aborted` in **142 ms**. The formal world build remained
unchanged. Cold reopening the saved world preserved that build, the aborted
transcript and an idle agent; no model turn replayed. Both process shutdowns
reported no input/focus/Pointer Lock violations or shutdown failures.

This measures cancellation during a streamed response, before a source tool or
Blender job started. It does not establish cancellation latency during every
possible native workload. The interrupted call did not return usage accounting;
token consumption is **unknown**, not zero. No token, model-call or whole-turn
budget was imposed. The cancellation itself was the behavior under test.

The first attempt was rejected by the strict test-profile directory guard. A
second exposed missing publication modules in the staged plugin and motivated
the packaging fix. A subsequent cancellation succeeded in 38 ms but its driver
treated temporary world startup as terminal. Those diagnostics remain under
`test-results`. The completed run initially waited at the ordinary cold-start
chooser; an owned-profile page script submitted the saved-world form, after
which the native assertions passed. The repeatable driver now includes that
form step. No OS input, personal profile or model-authored source was changed.

- Driver: `tests/player-codex-cancel-native.mjs`
- Compact evidence: `docs/evidence/player-cancel-20260913/native.json`
- Full private local run: `test-results/desktop-native-cancel-U4k8bl/report.json`
