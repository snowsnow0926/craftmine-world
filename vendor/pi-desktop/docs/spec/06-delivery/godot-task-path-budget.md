# Godot task path compatibility budget

The host must reject an editor-cache path longer than 245 UTF-16 code units
before creating a task directory, copying a source, creating an AppContainer
profile or launching an engine. The calculation includes the task directory,
`work/Packages/craftmine.godot.task.<taskId>/AC/Godot` redirection. The fixed
245 budget is an observed working compatibility bound, not a claim that every
Windows API has this limit or that arbitrary nested project paths are supported.

The rejection is `GODOT_TASK_PATH_TOO_LONG`. Broker preparation failure evidence
must remain in the executor attempt ledger. The executor must not retry, export,
run a check or produce an applicable candidate after this rejection. Original
source files must remain unchanged. No global Windows setting, ACL relaxation,
directory junction, short-path alias or shared scratch-root substitution is used.

The initialization flow extracts only this exact finite code from the existing
hash-checked job output. Durable initialization status must verify the output
hash and world identity before exposing it across restarts. Other log strings
or private paths are not exposed by this mapping. The player sees a concise
Chinese explanation, and creation stage, error stage and failed stage all identify
the initial build. A rejection is not long-path support.

Native acceptance: run `tests/plan-loop/godot-task-paths-native.mjs` with explicit
host-owned broker, pinned version directory and a fresh short evidence directory.
The same project under 180 and 245-unit cache paths must import with process,
network and cleanup verification. A 266-unit path must reject with no task child
directory, engine log or verification receipt. All runs must preserve the source
hash. These are fixed native probes, not paid-model or full-client acceptance.
