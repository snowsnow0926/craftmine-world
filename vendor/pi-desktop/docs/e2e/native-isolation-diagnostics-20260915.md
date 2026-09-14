# Native isolation diagnostic projection regression

## Observed player evidence

The online NUWiAc tree and meadow turns used the unchanged `beb55787` package.
Their final replies described import network/directory messages as unattributed,
despite successful checks. The corresponding build-read observations completed
at 2026-09-14 21:43:55.022 UTC and 21:46:50.765 UTC. Read-only comparison of the
retained Core output and private executor ledger found successful import/export
attempts, passed compile/check results, and no compile errors or failed assertions.
Replaying the existing production executor classifier yielded 11 known native
observations and zero errors for each log.

The two complete logs are retained in `tests/fixtures/native-isolation/` with a
provenance manifest. They contain no personal paths, broker request tokens or
credentials; test job/world identities are synthetic. Original log SHA-256 values:

- Tree: `ef4832e1d412abbb5fda28048ac39c850eacf65490220efd489a70a7278be49d`.
- Meadow: `a737b9f66401948fcf09e767db36568e02bdbf95e1f4b7e35080c170b33ceca3`.

Their five distinct engine frames are `get_system_dir` in
`platform/windows/os_windows.cpp:2502`, `get_local_interfaces` in
`drivers/windows/ip_windows.cpp:117`, `get_filesystem_type` in
`drivers/windows/dir_access_windows.cpp:412`, `open` in
`drivers/windows/net_socket_winsock.cpp:238`, and `listen` in
`core/io/tcp_server.cpp:56`. Classification still requires the exact associated
message, not these frame names alone. Engine identity is `4.7.2-stable` with
`craftmine.windows.lpac-registry.v1` isolation.

## CPU regression

Build the actual plugin, then run:

```text
node desktop/build-world-plugin.mjs --output test-results/native-diagnostics-plugin
node --test tests/godot-native-isolation-diagnostics.test.mjs tests/godot-diagnostics.test.mjs tests/godot-native-diagnostics.test.mjs tests/godot-tool-output.test.mjs
node --test --test-name-pattern "compile failures are fatal" tests/godot-remaining/C/executor-protocol.mjs
```

The first suite passed 75 tests; the existing executor classification case also
passed. The packaged plugin test uses the real private evidence provider and real
`godot_build_read` tool through summary and full reads, with isolated fixture
ledger/manifest files and read-only Core responses. Broker execution and recovery
are explicitly rejected by the fixture. Ledger bytes and original output remain
unchanged. Each complete log retains 11 observations, compacted to five rows with
their real counts, while the passed-check summary stops requesting player repair.

Negative cases cover missing evidence, wrong engine/isolation/executor,
world/build/source mismatches, failed or unretired import, altered log/output
binding, forged tool fields, wrong exact native frame, new unknown errors and
mixed script errors. A failed collision assertion remains failed and receives no
successful player summary even when its import observations are classified.

This validates diagnostic projection, not a new native gameplay or model result.
No GPU, model, active profile mutation, source repair, production data rewrite,
new task limit or automatic retry was used. The running online flow retains its
original package and evidence; player-facing behavior on a newly sealed package
is a separate integration observation.
