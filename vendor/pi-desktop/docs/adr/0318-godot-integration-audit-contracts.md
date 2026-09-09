# ADR 0318: Correct Godot integration contracts before enabling execution

Status: accepted; runtime rollout remains gated.

Parallel implementations disagreed on project roots and artifact size. Application compared only player pose but adopted the entire renderer snapshot; source identity was checked only at prepare. These defects reject valid exports or publish stale state.

Keep Rust as source/build/application authority. Separate artifact limits and stream verification. Claim the actual project directory after verifying inputs. Preserve complete formal progress and revalidate source/asset identities at commit. Derive optional navigation metadata from persisted formats.

Sandbox task roots are created exclusively; reparse paths and reserved Windows names are refused. Verify pins after copy and retain the exact engine path. Tasks run once, startup failures become terminal, and cleanup errors are surfaced. This repairs ownership without claiming loopback denial or hostile-project isolation.

No executor registration, panel token policy or trusted launch adapter is introduced here. Root owns those gates. Tests use synthetic artifacts and executor receipts; their assertions do not establish real model or Godot runtime correctness.
