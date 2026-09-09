# Craftmine World licensing inventory

Status: **facts, targets and reviewable drafts only.** Nothing in this directory
applies a licence, relicenses anything or constitutes legal advice. The governing
decision record is `docs/LICENSING_STRATEGY.md`; it is a decision record, not an
applied licence. Rights verification is deliberately incomplete where evidence is
missing, and every unresolved right stays `pending-rights-review` or
`unknown-rightsholder`.

## Contents

| path | what it is |
| --- | --- |
| `inventory.json` | Per-module inventory, format `craftmine.license-inventory/1`. Generated from evidence plus hand-curated decisions. |
| `offline-entry.json` | Machine-checkable map of where licence texts must appear in a package and in an export. |
| `OFFLINE_LICENSE_ENTRY.md` | Human-readable offline-entry instructions and the list of missing texts. |
| `texts/` | Official licence texts fetched over HTTPS, with `SOURCES.json` provenance. |
| `notices/CRAFTMINE-NOTICES.md` | Generated client/package notices; every entry cites its evidence path. |
| `notices/EXPORT-NOTICES.md` | Generated export notices. |
| `drafts/` | Reviewable drafts (commercial licence, CLA, export notes). Each carries a DRAFT banner and a `TODO(unknown)` list. |
| `evidence/` | Machine-generated facts: upstream diff, npm licence snapshot, Rust dependency walk. |
| `tools/` | Generators. |
| `desktop/delivery/licensing-check.mjs` | Read-only validator/checker CLI. |

## How to regenerate

```powershell
# 1. Official texts (network). Writes texts/LICENSE-*.txt and texts/SOURCES.json.
node desktop/delivery/licensing/tools/fetch-texts.mjs

# 2. Upstream comparison (network once, cached archive). Writes evidence/upstream-diff.json.
#    The archive is pinned in desktop/UPSTREAM.json and its SHA-256 is verified first.
node desktop/delivery/licensing/tools/upstream-diff.mjs --archive <PI-Desktop.zip>

# 3. Dependency evidence from real lockfiles/builds.
#    --package must point at a real win-unpacked build for the npm snapshot;
#    cargo metadata walks the real Rust graph.
node desktop/delivery/licensing/tools/build-inventory.mjs --refresh-evidence --package <win-unpacked>

# 4. Rebuild the inventory from the evidence plus the curated decisions.
node desktop/delivery/licensing/tools/build-inventory.mjs

# 5. Regenerate notices.
node desktop/delivery/licensing/tools/gen-notices.mjs

# 6. Check a real package or export.
node desktop/delivery/licensing-check.mjs --inventory desktop/delivery/licensing/inventory.json --package <win-unpacked>
node desktop/delivery/licensing-check.mjs --inventory desktop/delivery/licensing/inventory.json --export <export dir>
node --test tests/godot-remaining/K/licensing.test.mjs
```

Hand-curated decisions (target licences, status, open questions) live in
`tools/inventory-curation.json`; machine facts live in `evidence/`. The generator
never changes licence metadata or source files.

## What is verified

"Verified" here means the bytes and the declared metadata were checked — not that a
licence is legally sufficient for a particular business use.

- `godot-engine` — MIT text present, SHA-256 pinned in `desktop/godot/toolchain.lock.json` and `desktop/godot/licenses/notices.manifest.json`.
- `bundled-fonts` — four OFL-1.1 texts present with pinned hashes.
- `audio-models` — a repository-wide scan found only five project-generated `.obj` meshes and no audio file at all; fonts are present only via the upstream client.
- Dependency facts: 796 installed npm packages, all matched against `vendor/pi-desktop/pnpm-lock.yaml` (`evidence/npm-licenses.json`); 140 Rust crates reachable from the two shipped binaries, all with declared licence ids (`evidence/cargo-licenses.json`).
- Upstream split: 1078 unchanged / 62 modified / 155 added tracked files against the SHA-256-verified upstream archive (`evidence/upstream-diff.json`).

## What is pending or unknown

- 18 entries are `pending-rights-review`, 1 is `unknown-rightsholder` (`ai-generated-output`).
- Project-owned shipped code (`app/`, `plugins/craftmine-world/`, `craftmine-core`, the web bridge/runtime, the bases, delivery tooling) has no applied licence; the AGPL-3.0-only and MIT targets are not applied.
- `craftmine-core` currently declares LGPL-3.0-or-later while the target is AGPL-3.0-only plus commercial. The difference is intentional and unresolved.
- No CLA/DCO record exists; contributor identity, employer rights and AI assistance are unrecorded.
- 45 installed npm packages ship no licence text; no consolidated Rust third-party notice file exists.
- The Godot `GODOT_COPYRIGHT.txt` aggregate has not been decomposed per component.
- The AGPL/LGPL inclusion question for exports is unresolved (`conditional` in `offline-entry.json`).

## Open legal questions

1. **Unknown rights holders and entities.** The licensor entity for any project licence is not established. Individual contributors, employer/institutional rights and any AI-assisted provenance are unrecorded. Upstream PI-Desktop copyright holders are not enumerated.
2. **Relicensing authority.** Whether the project may relicense `craftmine-core`, `app/` or the plugin under AGPL/commercial terms is unproven; there is no CLA covering existing contributions.
3. **LGPL notice set.** Whether the LGPL-3 supplement text alone satisfies the obligation or the full GPL-3 text must also travel is unresolved.
4. **Derivative-work characterisation.** The 62 modified upstream files are treated as LGPL derivative works; that characterisation has not been legally confirmed.
5. **Export inclusion.** Whether an export ever contains AGPL/LGPL code, and how corresponding source would be provided, is undecided.
6. **Non-standard third-party terms.** MPL-2.0, BlueOak-1.0.0, Unicode-3.0, Zlib and the 45 text-less npm packages have not been reviewed individually.
7. **Generated and AI output.** Copyright status of generator output and AI-generated content depends on jurisdiction and provider terms.
8. **Trademark and naming.** Godot trademark policy and the project's own name/mark usage rules are unreviewed.
9. **Counsel review.** All drafts (`drafts/`) and the module boundaries need review by a software-licensing lawyer before publication; the drafts contain `TODO(unknown)` placeholders that must be completed first.

The checker reports `pending-rights-review` as pending and never as a pass, and exits
non-zero when a shipped component has no evidence. It never modifies the inspected
tree and promises no third-party authorisation.
