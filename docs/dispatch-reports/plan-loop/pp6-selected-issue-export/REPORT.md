# PP6: selected local issue JSON export

Implemented on the isolated `codex/pp2-base-default-20260910` branch after
`1b5ff983a27808159b8eb0a0a8047fb08649cd7c`. Earlier default-parameter commits
were not rewritten. The frozen 827 release and the user's original plan files
were not modified. This change is pending integration into a future client.

## Delivered

The local issue detail has a JSON export action wired through the exact native
panel channel `issue.export`. Main reads the real issue service, freezes the
selected revision, owns the existing save picker and atomically writes one
allowlisted JSON document. Original player text and followup text retain their
exact whitespace and separately captured version identities. Nothing is sent
externally and no diagnostics, source, saves, credentials, chat or screenshots
are collected. No path or file body is returned to the panel.

Requests contain only world ID, issue ID, selected revision and operation ID.
Same-process retries reuse the exact frozen bytes and original picker grant;
cancellation is a terminal receipt and a subsequent deliberate export is a new
operation. A world/revision mismatch refuses the write. The original ledger and
any existing authorized output survive a caught write failure. Pending duplicate
requests share one operation; altered payloads cannot reuse that identity.

The shared selected-file writer now awaits an asynchronous pre-commit guard as
well as its existing synchronous guards. The service caps output at 512 KiB
and retains at most 32 operation identities per process without eviction.

## Verification

- `node --test tests/dispatch/e/windows-services.test.mjs tests/plan-loop/issue-export.test.mjs`: **21/21 passed**, exit 0. Ten new tests drive the real issue service, exporter, gateway and filesystem. Eleven existing backup/diagnostics/upgrade service tests remain passing.
- `node tests/plan-loop/issue-export-headless.mjs`: **3/3 passed**, exit 0. Actual production issue UI, isolated Chromium, loopback HTTP and real persistence; fixed test-owned picker callback. No page errors or external requests, and input/focus/Pointer Lock guards stayed zero. The raw report is [dom-report.json](dom-report.json), with tested source hashes.
- Targeted TypeScript check for the exporter and its imported service types: exit 0, using existing cached dependencies, `--module preserve --moduleResolution bundler`. An initial command with an unavailable direct Node type path failed setup; the corrected command uses the existing pnpm Node type path. No dependencies were installed.
- E2E changes were appended as bytes; the entire previous file prefix was compared against `git show HEAD:<path>` and retained exactly. [checks.json](checks.json) records its byte count and hash.

The byte-cap retry test was added during final review: an oversized cached
buffer must remain rejected on retry instead of skipping the limit. Actual disk
failure coverage includes a missing destination directory and an injected ENOSPC
after writing/syncing the real temporary file, before rename; both preserve the
record and avoid a success receipt. The shared writer's asynchronous false
guard is also exercised against an existing destination.

The exact commands use the existing read-only dependency location:

```powershell
$env:CRAFTMINE_DEPS_ROOT='C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop'
node --test tests/dispatch/e/windows-services.test.mjs tests/plan-loop/issue-export.test.mjs
node tests/plan-loop/issue-export-headless.mjs
node 'C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop/node_modules/typescript/bin/tsc' --noEmit --skipLibCheck --module preserve --moduleResolution bundler --target es2022 --types node --typeRoots 'C:/cm-plan-next-20260910/vendor/pi-desktop/node_modules/.pnpm/@types+node@24.13.3/node_modules/@types' vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-export-service.ts
```

## Limits and next acceptance

This is the first selected-record JSON export slice, not a complete diagnostic
bundle or proof of reproduction. It has no import or upload. Same-process
receipts are not durable across restart; process crashes may leave a temporary
file and do not have an exactly-once export guarantee. A completed replay proves
the previous write, not continued existence or unchanged content of that file.

The automated DOM transport is a fixture, not Electron native-dialog acceptance.
Main wiring is present, but a future integrated client should exercise the
actual native detail entry and picker, including cancellation, before claiming
packaged product acceptance. No full Electron/Godot build, large profile, native
visible window, model invocation, new package, or signed-release check was run
for this slice. Test outputs are retained in the branch's ignored test-results
directories; no historical evidence was deleted.
