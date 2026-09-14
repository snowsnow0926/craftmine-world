# PI partial publication validation

Run in `packages/agent-runtime`:

```text
node node_modules/vitest/vitest.mjs run src/stream-publication.test.ts src/runtime.test.ts src/craftmine-context.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

The controlled test feeds 34000 growing ASCII assistant updates to the real
`DesktopAgentRuntime` handler at virtual 5ms intervals (170 virtual seconds).
It uses no provider/network request, browser, GPU or player profile. It records
serialized emitted envelope byte counts rather than retaining every partial.

| Same synthetic stream | Pre-fix preserved runtime | Coalesced runtime |
| --- | ---: | ---: |
| Received partial updates | 34000 | 34000 |
| Published / flattened partial snapshots | 34000 | 1701 |
| Serialized published JSON bytes | 589849000 | 29541248 |
| Final thinking characters | 34000 | 34000 |
| Final text | Done | Done |

Both runs preserve the exact cumulative thinking delta. The new runtime also
retains the complete terminal usage and native history entry, with no pending
timer. The pre-fix compiled runtime SHA-256 was
`b138053e7375bed50bb4e0a5a222b5c0035b7f4586121adb01ce97b46c001f73`.
Its baseline script refuses to run against a build containing the new publisher.
The regression's independent ASCII JSON arithmetic agrees with the actual
pre-fix serialized byte count.

These numbers measure this controlled stream's event and byte volume, not peak
heap, GPU memory, real provider speed, or guaranteed percentages for all streams.
Control events can force additional immediate publications. Final messages and
model-facing context are not shortened.

Twelve new regression cases cover first-partial latency, latest-only batching,
prefix rewrites, cumulative text/thinking deltas, mutation of an accepted SDK
block, flush-before-tool/error/status/model-call/agent-end ordering, actual failed
terminal content, abort/dispose late output, and new-message/new-turn ownership.
The existing runtime and Craftmine request-boundary suites remain part of the
targeted validation. The source change does not alter main-process terminal
persistence; an actual packaged resume/finish run is still needed to validate
that full product path after integration.

Observed targeted result: 203 tests passed across the three files (12 new
publication cases plus 191 existing runtime/request cases); runtime type-check
passed. The baseline executable comparison independently emitted all 34000
updates and measured the 589849000 JSON bytes shown above.

Optional `CRAFTMINE_STREAM_PUBLICATION_REPORT` writes the controlled test report.
This worktree retains `test-results/stream-publication-34000.json`,
`stream-publication-34000-baseline.json`, and `stream-publication-baseline.mjs`
for integration archival. The separate test collector fix must avoid retaining
every full partial; it is not a substitute for this production change.
