# H integration audit repair

The old H green status covered two historical probes and their declared files.
It did not cover the newly integrated `desktop/godot/bases/{first-person,top-down,
side-view}` directories. It must not be used as a release clearance for those bases.

This follow-up changes only `desktop/delivery/**` and this H audit evidence/report.
The preceding C lifecycle commit is unchanged. User-owned `LICENSING_STRATEGY.md`,
root licenses, Godot notices, and MIT/AGPL/LGPL policy declarations are untouched.

Implemented fail-closed checks:

- Discover every new base directory and require exact source-directory coverage.
- Reject both `unreviewed` and the former `unrevealed` typo for redistribution.
- Search unpacked packages below the old depth-four cutoff; detect renamed locked
  engine bytes, Godot executable names, and WASM/PCK companion bundles.
- Require an explicit hash-bound reviewed declaration for otherwise unknown WASM.
- Reject package links before reading/traversing them; do not silently truncate
  depth, entry or hash-byte scans into an apparent no-engine result.
- Keep each synthetic test run in a unique directory and preserve older evidence.

Only shared bridge byte/hash pins were refreshed in the three existing manifests.
The reviewed upstream source is task C commit
`86c4a3e4623ab28ba86690dc5a2ee6ba3d8a7891`, integrated before this repair.
License, redistribution and distribution fields retain their prior values. The
first attempt at the new self-test identified duplicate old bridge pins in the
first-person/top-down manifests; refreshing those exact reviewed byte references
resolved that baseline fixture failure without changing rights.

Validation: `node desktop/delivery/preflight-selftest.mjs` reports **34/34**.
The copied raw result is `audit-selftest.json`; test trees remain under the unique
path recorded by the command. Negative cases cover missing new manifests, both
pending spellings in assets/notices, nested engine, locked-byte rename, Web-only
runtime, absent/stale/unreviewed WASM declarations, link traversal guard and
missing engine fingerprint. These are synthetic classification fixtures, not a
new production package or proof of legal sufficiency.

The real integrated-tree `assets` preflight intentionally exits **1** with exactly
five issues, recorded in `audit-assets.json`:

- `ASSET_BASE_MANIFEST_MISSING` for each of the three new base directories.
- `ASSET_UNDECLARED_FILE` for `desktop/godot/web/runtime.mjs` and `runtime.d.mts`.

No permission was invented to turn those failures green. E/F/G and the owning
reviewers must provide the actual rights/source records. The evidence's Git facts
are null because its optional nested Git subprocess was unavailable in this
execution environment; the inspected base was C repair commit `1a1595d` plus this
H working diff, not a claimed clean release commit.

Remaining bounds are explicit in `desktop/delivery/README.md`: no archive/ASAR
extraction or generic unknown-engine binary identification; no OS junction fixture
or native concurrent filesystem attack certification. The pure link test injects
filesystem metadata and proves this scanner does not descend after detecting it.
