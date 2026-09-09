# Fourth-base copy identity

The first isolated commit `4c52356` adds the already-shipped `mining-sandbox`
base to core initialization and project creation allowlists. It changes no
renderer, game rule, content schema or executor permission.

The copy follow-up makes two fixed transformations:

1. For source files, mining's actual loader reads root `world.json` using
   `craftmine.godot-mining-sandbox-world/1`. Only its root `worldId` token and
   `project.godot`'s existing `craftmine.runtime/world_id` value change. This
   preserves other bytes, including entity IDs, scripts, binary bodies and
   source materialization receipts. `worlds/default.json` / `instanceId` belongs
   to side-view; no such pointer is invented or rewritten for mining. The
   native mining save store also partitions saves by SHA-256 of worldId, so the
   copied world does not share the source's progress filename.
2. For progress, the fixed managed/state schemas require and rebind exactly
   envelope `worldId`, `body.worldId`, and `body.state.worldId`. Foreign nested
   identities and unknown mining managed/state formats fail before copy commit.
   Initial-progress mode is validated the same way, without rewriting caller
   state. Inventory, complete chunk edits, positions, flags, ledger strings and
   every other progress field remain unchanged. The host copy service uses the
   same schema transformation for `expectedInitial` and rejects the old partial
   two-field receipt before opening or rebuilding a target.

The existing core source-copy proof remains intact: the formal derived commit
must have exactly the immutable formal parent. Any user draft gets its own
identity-only child; its script changes are preserved and never substituted
for formal rebuild content. Replays validate that exact tree and parent.

Local host service tests:
`node --test --test-isolation=none tests/godot-final/mining-copy-service.test.mjs`
**4/4 passed**. These are service fixtures, not native engine acceptance.

New core tests perform real SQLite/Git initialization/project/copy, fixed source
transformation, formal-versus-draft ancestry, full progress equality and actual
database close/reopen; they also reject a mixed-identity initial state with no
new world row. Build/application receipts are clearly labeled core fixtures.
Requested commands:

```text
cargo test --manifest-path vendor/pi-desktop/Cargo.toml -p craftmine-core mining_copy -- --nocapture
cargo test --manifest-path vendor/pi-desktop/Cargo.toml -p craftmine-core fixed_rebinding_preserves_every_other_byte_in_four_bases -- --nocapture
```

The local first command could not compile: OS error 5 while creating the
worktree's Cargo target temporary directory. Root subsequently reran both:
`test-results/final-mining-copy-core.log` records **2 passed, 0 failed** (3.68s),
and `test-results/final-mining-copy-bytes.log` records **1 passed, 0 failed**.
Both have a separate binary target with zero tests; that is not added to the
pass count. Implementation/tests were committed as `0c318a6`.
The actual offscreen mine-camp copy, independent check/application, gameplay
and client restart remain root's next native acceptance step.

No root dirty files, model credentials, model requests, UI input, or other
agents' test processes were modified.

## Read-only fourth-base route sweep after integration (before follow-up)

- Root's new initialization, project creation and build verifier allowlists now
  include mining. Materializer, observation dispatch, dynamic base catalog and
  runtime inventory also include it. The fixed Town/Ruins acceptance controller
  deliberately handles just its two named routes; the new Mine controller is
  separate, so that is not a missing product allowlist.
- `desktop/delivery/lib/release-manifest-core.mjs:31` still lists only three
  bases. `collectBases` at line 395 iterates that list, so its release-manifest
  component inventory omits mining. The final runtime-resources inventory does
  include mining; this is a separate release-report coverage gap. Its parameterized
  fixture tests iterate the same list, so they cannot reveal the missing fourth
  base. Add mining explicitly and assert all four expected IDs independently.
- `godot-windows-export-service.mjs:76` still rejects mining; Mill owns its
  fourth-base addition and actual export test. Not changed here.
- Mining advertises six `ms.*` reusable components in the catalog, all with
  `install:null`. `shared/components.mjs:266`/285 only handle side-view/top-down
  data mappings; mining falls through to line 325's explicit manual installation
  plan. This does not block creating/playing a mining world, but automatic mining
  component reuse is not delivered by that catalog alone. Keep it marked manual
  or add exact material/ore/recipe/terrain/spawn/station schema handlers and tests.
- The plugin's `main.cjs:191` labels only three bases and falls back to “Godot”
  for mining. This is a presentation omission, not a launch blocker. The native
  four-base creation labels are already being handled by root.
- Remaining “three bases” comments, the old preflight synthetic fixture and
  licensing coverage lists are historical/report scope; do not silently promote
  mining's pending rights or count them as live fourth-base acceptance.

## Release inventory follow-up

The release inventory now explicitly includes `mining-sandbox` and records each
base manifest's `declaredComponentIds`. This field describes authored declarations;
it does not claim automatic installation. The mining catalog's six entries remain
`install:null` with their existing manual installation steps. No component handler
or licensing approval was added.

Independent tests assert the four literal expected base IDs and six literal mining
component IDs, read the actual mining manifest/catalog, and verify the release
inventory's mining manifest byte count and SHA-256. They do not derive expected
coverage solely by iterating the production `BASE_IDS` constant. The plugin label
now displays `Godot 采矿沙盒` for mining.

Local verification: `node --test --test-isolation=none
tests/godot-remaining/K/release-manifest.test.mjs` passed **13/13**, with no failures
or skips. This verifies manifest construction and declared component coverage, not
native gameplay, automatic mining component installation or licensing clearance.
The test output was returned by the tool; no separate raw log file was created.
