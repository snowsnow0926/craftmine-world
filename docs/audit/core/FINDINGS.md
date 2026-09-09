# A/B integration audit

Baseline: `75f69fa2903e0c259bfaf5ce0cfecd190bb21545`; implementation uses an independent worktree. No original A/B worktree was modified.

Confirmed blockers: exported wasm exceeds the core's 4 MiB artifact bound; claim returns the parent of the actual project root; application accepts stale non-player progress; source changes after prepare are not checked at commit; sandbox task directories can be reused with stale files. Further findings: claim does not revalidate its source copy; materialization writes incomplete files to final names on failure; panel exposes the application token and accepts page-authored launch evidence; loopback remains allowed; no real A/B executor/check adapter exists. Root owns the panel gate and adapter integration.

A evidence supports fixed native/import/export experiments, not production isolation or browser runtime behavior. B evidence is real Rust and broker execution with simulated engine/check/launch results. A editor network timeout is not a policy-denial proof, raw Godot logs include unclassified system directory errors, and parent-environment.log is referenced but not tracked. Child stdout is untrusted even when its path cannot be reopened by the child.

This repair does not enable product execution. Network isolation, authenticated launch evidence and real runtime checks remain required gates.
