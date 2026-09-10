# PP3 player supplements and retest state

Base: `ae32974eed097c9b3308ae53c95ca7533e03532a`.
Branch: `codex/issue-followups-20260910`.
Worktree: `C:/Users/WINDOWS/AppData/Local/Temp/cm-issue-followups-20260910`.

## Delivered boundary

The existing local issue detail now accepts a player's additional text and
explicit still-present, player-resolved, and reopened states. Each entry retains
its own timestamp and trusted current formal world/build/instance context.
Original descriptions and original issue/context objects remain unchanged.
Notes do not alter player status. UI labels distinguish player retest from
automated diagnosis or verification.

The existing atomic local ledger reads v1 without modifying its bytes and writes
v2 only on mutation. Followups are capped at 32 per issue, 2048 UTF-16 units /
8192 UTF-8 bytes each, sharing the 2 MiB ledger and 1024 receipts. Every live
record retains a deletion receipt slot. The displayed lifetime allowance now
accounts for supplement receipts rather than implying all 512 create slots
remain available. Deletion removes original and supplementary bodies, preserving
minimal receipts to prevent resurrection.

Two finite panel channels prepare and append a supplement. Preparation returns
Main's context digest and current issue revision. Append checks the exact issue
revision and two current context samples; a stale world/build/instance or an
unready/candidate context fails closed. Existing receipt replay precedes these
checks, so an uncertain committed operation resolves without recapturing a new
scene or duplicating text. No generic record update or filesystem RPC is added.

## Verification

- New actual filesystem service: **8/8**, including v1 compatibility, immutable
  originals, state transitions, cross-world/version/revision rejection,
  corruption/hardlink refusal, quotas, sequential separate-process reopening,
  and real process interruption before write/sync/rename and after rename.
  `raw/followups-service.json` records the source hash and results.
- Production DOM + real local ledger: **8/8**, with a declared runtime-context
  fixture. Lost response retry preserves the exact operation; real stored entries
  retain original/build-b/build-c identities. Stale submit and delayed editor
  responses are rejected, HTML stays inert, and all input/focus/Pointer Lock
  counters remain zero. See `raw/followups-dom.json`, calls and screenshot.
- Existing storage/fault/concurrency/cumulative-capacity regressions: **16/16**
  on the final service source, `raw/legacy-service-regression.json`.
- Existing DOM recording/deletion/stale-response regression: **5/5**,
  `raw/legacy-ui-regression.json`.
- Existing trusted context and finite gateway tests: **6/6** in the tool output.
- Complete desktop TypeScript check: exit **0** using TypeScript 5.9.3,
  `-p vendor/pi-desktop/apps/desktop/tsconfig.json --noEmit`.
- `git diff --check`: pass. E2E original byte prefix preserved during append;
  see `raw/e2e-byte-append.json`.

Dependencies were reused read-only from `D:/cm-plan-loop-20260910`. Test data and
processes belonged exclusively to this new worktree. No existing profile,
release artifact, shared dependency, credential or model account was changed.
No test failure was suppressed; intermediate passing runs remain in the owned
ignored test-results directories. Archived final evidence is byte-hashed in
`raw-evidence-index.json` and has Git text conversion disabled.

## Subsequent actual client acceptance

The initially pending client acceptance is now complete: the independently
compiled client passed 22 actual Electron/Godot checks, including a real new
build, candidate preview refusal, all three player retest states, full client
restarts and complete progress equality. See `actual-client/REPORT.md` for
source/runtime identity, unchanged raw logs and the exact tested boundary.
The initial unit/DOM evidence above remains unchanged. An independent review
subsequently exposed discriminator coercion; b15ca1e fixes it and the new
strict service regression preserves its negative evidence.

The notebook remains local-only and outside world backups, source packages and
uploads. No diagnosis, repair candidate, model request or automatic validation
was implemented. This is the manual supplement/retest portion of PP3, not the
complete PP-A15 record-to-repair-to-adoption loop. Existing Electron profile
exclusivity is still required; separate simultaneous writers and power-loss
durability are not newly claimed.
