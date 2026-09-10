# Integrated local preview scope

This checkpoint describes the next Windows rebuild. It does not attest that a
package has passed acceptance; the immutable release directory records the
actual source identity and subsequent results. The application version remains
0.14.3. This is not a new stable version or a signed public release.

## Included changes

- An optional creation guide and a bounded first-person target feedback editor.
  Editing one supported target follows the existing draft, check, preview and
  application transaction. Its runtime requirement is checked against the actual
  candidate instance. Saved gameplay is kept separate from content changes.
- Read-only history comparison with exact file differences, explicit binary and
  truncated text results, and world/formal-version invalidation. Literal Git
  pathspecs prevent a filename such as `a[1].gd` from selecting another file.
- Local issue supplements and explicit player retest states, retaining original
  wording and version context. Duplicate operations and deleted-record receipts
  cannot create duplicate or resurrected issues. These states are player reports,
  not an automatic proof that an issue has been reproduced or fixed.
- Audited client shutdown that waits for owned runtime resources and startup
  work. A zero process exit alone is insufficient for acceptance.
- A bounded Windows task cache path guard. Unsupported import/export layouts
  fail before an engine task is allocated, with `GODOT_TASK_PATH_TOO_LONG` at the
  build stage. Version discovery remains available. The failed world and reason
  survive Core restart. This is an explicit compatibility limit, not arbitrary
  long-path support.

## Evidence before packaging

- Integrated Rust Core: 284 passing tests, 7 ignored. The ignored tests are not
  counted as passing. One documentation test remains ignored.
- The current desktop TypeScript check passed after integration.
- Actual development client acceptance: target parameters and guide (20 steps),
  version comparison (9), and issue followups (22). Each report identifies its
  compiled client and runtime provenance. These are not new package results.
- The Windows path discovery followup exercised the real broker, executor and
  Core, including rejection and restart. It used a recorded debug Core binary;
  an independent integrated release Core has also compiled successfully.
- Original failed trials remain beside the successful evidence. The prior
  `ae32974` package is preserved; its comprehensive run failed in the restore
  assertion wrapper after 50 passed steps. The narrow restore harness correction
  subsequently passed 16 steps on that same old package. Its long-path defect
  still requires a newly built package.

## Required acceptance on this rebuild

The same source must produce the Windows installer, its blockmap, the source
archive and a verified portable derivative. Recheck the four bases, gameplay,
reuse, copies, backup conflict rejection, successful restore and reopen. Run the
parameter/guide story from the portable payload, issue followups and history
comparison through the pinned packaged client, explicit long-path failure and
restart, and independent Windows game export/save/reopen. Preserve full progress
comparisons, strict shutdown audits and package hashes before and after use.
The parameter and Windows export harnesses bound their final forced-stop wait
to five seconds and report `CLIENT_STOP_TIMEOUT` instead of hanging indefinitely.
Forced shutdown remains a failed acceptance; the timeout does not relax cleanup.

## Remaining scope and limits

The separate PP2 default-value action is next-iteration work and is excluded from
this rebuild. General property editing, arbitrary new game types, semantic merge,
universal gameplay verification and automatic issue diagnosis are not delivered
by the finite features above.

Real-model acceptance is not run: authorization for transmitting the isolated
project to the configured model provider and incurring model charges is pending.
No credentials have been read for that acceptance. Deterministic offline inputs
cannot substitute for actual model evidence. Signed distribution, installer
execution, clean-Windows installation, upgrade and uninstall also require their
own evidence; payload inspection must not be described as those tests.

Development continues after this checkpoint. The user's existing plan documents
in the primary checkout are preserved independently from this development tree.
