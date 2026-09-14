# Cancelled blank-world retry: evidence and CPU regression

Read-only retained evidence:
`D:/cm-deepseek-reuse-flow/test-results/desktop-native-product-JMwD2n`, world
`world-c0009e708f37`. The parent confirmed the application exited normally with
integrity passing and zero model requests before the SQLite read. No Core
write/API, profile edit, renderer, GPU or model operation was performed here.

The first driver's world-list timeout led to ordinary shutdown cancellation.
On recovery, the parent invoked the real React retry button once at
2026-09-14 20:26:33 UTC. `ordinary-initialization-retry.json` records that action;
`read-only-startup-page.json` shows initialization failed at first build, with
the message that the world loader had been modified. The later operator
cancellation followed that displayed terminal failure and remains a separate
fact, not a model/task budget limit.

Managed metadata and disk both contain the exact 10,006-byte current engine
wrapper, hash `938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08`.
Read-only `craftmine_godot_projects` revision 2 and its historical revision row
agree. That revision's manifest hash is
`b32e77ccdeaa221bbed030d6267dc44700b6fe9336a1fe08ef4bdf8a4a87483e`.
Its inherited base is the exact 8,556-byte stock bridge with hash
`58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3`.
The materializer intentionally installs these two different files; this is not
a newline difference, player customization or altered retained world.

The new CPU regression calls real `materializeBase` with the ordinary blank
defaults, then real `createGodotWorldInitializer` with controlled Core/executor
receipts. It installs initially missing source, reaches its first queued check,
uses `stopAll` to cancel, constructs a fresh initializer, and explicitly retries.
Before the fix the unmodified world fails with
`GODOT_INITIAL_BRIDGE_CUSTOMIZED`; the log is retained as
`test-results/engine-bridge-retry-before.log`.

After the fix it reaches a fresh synthetic check and first-load callback with
the original cancelled job retained and no retry source writes. The complete
managed directory/metadata and indexed source remain byte-identical. Separate
cases reject a changed Core wrapper, changed inherited Core base, changed
managed file and changed bundle before a fresh check/load. A pin matrix rejects
crossed base/wrapper resources, missing or unknown base, and unknown wrappers.
The existing historical-resource and launch-retry tests also pass: 15 tests,
zero failures in `test-results/engine-bridge-retry-after.log`.

These are real materializer/initializer and synthetic executor results, not
native first-load acceptance. The parent will rebuild and use the same retained
cancelled world through its ordinary retry control, separately from fresh-world
and subsequent model-flow tests. Do not reset that profile to manufacture a pass.
