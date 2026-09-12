# FB03 retained initial-load retry

A first-load retry recognizes the exact shipped controller bridge from preview.17
as host-owned. Its SHA-256 is
`58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3`.
Neither this bridge nor the previous bounded-action bridge is rewritten by retry.
The selected current bundle must match the current pin even for that no-op.

The original pre-drain bridge still upgrades only to its pinned historical,
dependency-compatible replacement. An already upgraded historical bridge also
requires the selected historical resource to match its pin. Unknown customized
source is refused, and unrelated world files remain untouched.

The FB03 player copy contained exactly the current shipped bridge. A stale
bounded-action pin incorrectly classified it as customized during recovery.
Tests read the actual shipped resource and exercise both historical paths,
current and previous no-ops, tampered bundles, and unknown source refusal.
