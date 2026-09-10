# Real discovery to durable failed import

The initial e60e38c budget also rejected `version`, despite that fixed operation
not using the editor cache. This prevented executor registration, so no durable
failed import job existed. The SQLite failed-job fixture alone did not cover that
product branch. Restrict the cache compatibility check to import and exports.

`tests/plan-loop/task-path-executor-native.cjs` now uses the real rebuilt broker,
real fixed Godot version/network preflight, real executor and real rebuilt core.
Its 266-unit cache layout successfully discovers/registers, then rejects import
before task allocation, records the exact code in a failed job, retains the
unchanged source and a non-ready candidate, and preserves failed/not-playable
status and the same reason after closing and reopening the real core.

Actual passing evidence: `D:/cm-path-chain-2/report.json`, copied as
`evidence/discovery-chain.json`, plus `evidence/discovery-executor.log`. The
candidate may have an ID with failed status; absence of any candidate row is not
the core contract. The first fixed harness incorrectly asserted a null ID; that
failed run is retained at `D:/cm-path-chain-1/report.json` and in evidence. It did
not produce a ready candidate or run a runtime check.

The isolated core release compiler itself exited 0xc0000005 during compilation;
no release binary from that failed build was used. A debug core built successfully
and is identified by its actual SHA256 in the report. The broker is a rebuilt
release executable, also identified by SHA256. This is a real native executor/core
chain, not a full packaged-client/restart acceptance; that test awaits a new package.
