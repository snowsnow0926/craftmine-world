# Native preparation failure, 2026-09-10

The first staged runtime omitted `web_nothreads_debug.zip`. `prepare-runtime-resources.mjs` copied only the two release Web templates, while the actual native broker's `fixed_pins` copies the debug Web template during **every** operation, including `version`. `Task::prepare` therefore encountered a missing file before it could produce a request-bound receipt. Client logs recorded `GODOT_BROKER_PREPARATION_FAILED` and OS error 2, without a native child being started.

Observed staged directory: `D:/cm-godot-final-20260910/desktop/build/runtime-resources/godot/engine/4.7.2-stable/templates`. It contained `version.txt`, the two release Web templates, and two Windows templates; the debug Web template was absent.

The existing fixed cache contains the missing file, 10,232,720 bytes, SHA-256 `08962aefef811b603541d7951ac67ef00413aad2d978855183c28adee98f626a`, matching the broker's existing compiled pin. The fix adds this exact input to the toolchain lock and staging list, and requires all broker Web files in package preflight. A regression compares the staging pins with the actual native `fixed_pins` contract, so a directory can no longer be considered complete while this native requirement is absent. The full resource hash manifest remains mandatory.

`tests/godot-final/executor-native-preflight.cjs` exercises only the real fixed version/network preparation. It refuses all domain calls, including registration, and never claims a project or calls a model. Use explicit host-owned `CRAFTMINE_PREFLIGHT_RUNTIME` and a new output directory under `CRAFTMINE_PREFLIGHT_OUTPUT_ROOT`. It retains native diagnostics/task files through the executor's ordinary lifecycle.

The subagent's own launch was blocked by `spawn EPERM`; that is an execution permission failure, not proof of a broker policy or compatibility failure. Raw report: `D:/Craftmine World/test-results/godot-native-preflight-rqrrlx/report.json`. Native rerun with a corrected staged runtime must be recorded separately by the root task. The local resource suite passed 5/5; it is a resource-contract regression, not native execution acceptance.
