# Offline licence entry (packaged client and exported game)

> Historical 2026-09-09/10 inventory, not a current package inspection. Some
> descriptions below predate the shipped Godot/Blender/GPL resources. Use the
> current [project scope](../../../LICENSING.md), [third-party index](../../../THIRD_PARTY_NOTICES.md),
> and each actual package's inventories. Old missing/pending entries neither
> negate the new original-code grant nor certify third-party clearance.

Status: **facts and paths only. This document is not a licence, not legal advice and it
does not apply any licence.** The machine-checkable mapping is
`desktop/delivery/licensing/offline-entry.json`; the checker is
`desktop/delivery/licensing-check.mjs`.

## 1 Where the texts live

| Context | Root (relative to the application/export directory) | Entry document |
| --- | --- | --- |
| Packaged Windows client | `resources/licenses/` | `resources/licenses/CRAFTMINE-NOTICES.md` |
| Exported standalone game | `licenses/` | `licenses/EXPORT-NOTICES.md` |

A player or reviewer must be able to read these without a network connection. The
paths below are relative to the application or export directory, exactly as the
checker resolves them.

## 2 Packaged client — texts that must be present

| id | path | status | covers |
| --- | --- | --- | --- |
| `lgpl-3.0` | `resources/licenses/PI-Desktop-LICENSE.txt` | required | PI-Desktop upstream and its modifications; `craftmine-core` metadata |
| `gpl-3.0` | `resources/licenses/GPL-3.0.txt` | **missing** | LGPL-3 incorporates GPL-3 by reference |
| `agpl-3.0` | `resources/licenses/CRAFTMINE-LICENSE-AGPL-3.0.txt` | **missing** | creation core (`app/`, plugin, `craftmine-core`) — AGPL target not applied |
| `mit` | `resources/licenses/CRAFTMINE-MIT.txt` | **missing** | project export runtime / example scripts — MIT target not applied |
| `godot-mit` | `resources/licenses/godot/GODOT_LICENSE.txt` | required when the engine is bundled | Godot Engine MIT |
| `godot-copyright` | `resources/licenses/godot/GODOT_COPYRIGHT.txt` | required when the engine is bundled | Godot bundled third-party components |
| `ofl-geist` | `resources/licenses/fonts/OFL-Geist.txt` | required | Geist font |
| `ofl-inter` | `resources/licenses/fonts/OFL-Inter.txt` | required | Inter font |
| `ofl-notosanssc` | `resources/licenses/fonts/OFL-NotoSansSC.txt` | required | Noto Sans SC font |
| `ofl-lxgwwenkai` | `resources/licenses/fonts/OFL-LXGWWenKai.txt` | required | LXGW WenKai font |
| `third-party-inventory` | `resources/licenses/third-party/npm-inventory.json` | required | installed npm dependency inventory |
| `mit-canonical` | `resources/licenses/third-party/LICENSE-MIT.txt` | **missing** | canonical MIT text for npm dependencies |
| `apache-2.0` | `resources/licenses/third-party/LICENSE-Apache-2.0.txt` | **missing** | Apache-2.0 npm/Rust dependencies |
| `isc` | `resources/licenses/third-party/LICENSE-ISC.txt` | **missing** | ISC npm dependencies |
| `bsd-3-clause` | `resources/licenses/third-party/LICENSE-BSD-3-Clause.txt` | **missing** | BSD-3-Clause npm/Rust dependencies |
| `bsd-2-clause` | `resources/licenses/third-party/LICENSE-BSD-2-Clause.txt` | **missing** | BSD-2-Clause npm dependencies |
| `mpl-2.0` | `resources/licenses/third-party/LICENSE-MPL-2.0.txt` | **missing** | MPL-2.0 npm/Rust dependencies |
| `zlib` | `resources/licenses/third-party/LICENSE-Zlib.txt` | **missing** | Zlib Rust dependency |
| `cargo-third-party-notices` | `resources/licenses/third-party/CARGO-NOTICES.md` | **missing** | consolidated Rust attribution |

The corresponding source archive is `resources/source/CraftmineWorld-source.zip`
(the LGPL corresponding-source offer).

## 3 Exported game — texts that must be present

| id | path | status | covers |
| --- | --- | --- | --- |
| `godot-mit` | `licenses/GODOT_LICENSE.txt` | required | Godot Engine MIT |
| `godot-copyright` | `licenses/GODOT_COPYRIGHT.txt` | required | Godot bundled third-party components |
| `export-notices` | `licenses/EXPORT-NOTICES.md` | required | what a player/creator may do and what must travel |
| `mit` | `licenses/CRAFTMINE-MIT.txt` | **missing** | project export runtime MIT target |
| `agpl-3.0` | `licenses/CRAFTMINE-LICENSE-AGPL-3.0.txt` | conditional | only if AGPL code is actually included in the export |
| `lgpl-3.0` | `licenses/LGPL-3.0.txt` | conditional | only if LGPL code is actually included in the export |

The export pipeline copies the two Godot texts today (`desktop/godot/export-probes.mjs`,
`desktop/delivery/base-assets/shared-web.json` `requiredNotices`). The project MIT
text is not written, so it is recorded as missing rather than silently assumed.

## 4 How to open the texts offline

1. Packaged client: open the installation directory, then `resources\licenses\`.
   Start at `CRAFTMINE-NOTICES.md`; it links every other file by relative path.
2. Exported game: open the export directory, then `licenses\`. Start at
   `EXPORT-NOTICES.md`.
3. Nothing in either document requires a network request; no text is fetched at
   runtime.

## 5 Which texts are still missing

Recorded as `missing` in `offline-entry.json` and reported by the checker:

- `GPL-3.0.txt` — LGPL-3 incorporates GPL-3; whether the full text must ship is an
  open legal question (see `desktop/godot/licenses/README.md` and the preflight
  warning in `desktop/delivery/lib/preflight-core.mjs`).
- `CRAFTMINE-LICENSE-AGPL-3.0.txt` — the AGPL-3.0-only target is not applied.
- `CRAFTMINE-MIT.txt` — the MIT target for export runtime/example code is not applied.
- All canonical third-party texts listed in section 2, plus the consolidated
  `CARGO-NOTICES.md`. Individual npm packages copy their own licence files where the
  package ships one; 45 installed packages ship none (see
  `desktop/delivery/licensing/evidence/npm-licenses.json`).
- `GODOT_LICENSE.txt` / `GODOT_COPYRIGHT.txt` under `resources/licenses/godot/` are
  required only when a build actually bundles the engine; the current toolchain lock
  status is `gd0-candidate-not-production-bundled`.

## 6 Verify it

```powershell
# Inventory schema, shipped-rights and notice/text presence against a real package
node desktop/delivery/licensing-check.mjs --inventory desktop/delivery/licensing/inventory.json --package "D:\Craftmine World\desktop\build\windows-preview-batch-07"

# Machine record
node desktop/delivery/licensing-check.mjs --inventory desktop/delivery/licensing/inventory.json --package <dir> --json --evidence <outside-the-package>.json
```

The checker is read-only. It exits `0` only when nothing is pending and nothing
failed, `1` on failures, `3` when everything that could be checked passed but
pending-rights-review or unknown-rightsholder entries remain, and `2` on usage or
I/O errors.
