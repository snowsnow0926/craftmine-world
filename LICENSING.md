# Licensing scope

[简体中文](LICENSE.zh-CN.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Copyright (c) 2026 craftmine world / 最中幻想 contributors.

Links in this document use repository-relative paths. In a packaged client, read
the source archive under `resources/source/` for those paths; copied third-party
texts are alongside this document under `resources/licenses/`.

## Project software

Unless a more specific license applies as described below, the original project-owned source code and its associated documentation in this repository are licensed under the **GNU Affero General Public License, version 3 only (`AGPL-3.0-only`)**. The complete, unmodified terms are in [LICENSE](LICENSE).

This grant includes the original creation software in `app/` and `plugins/craftmine-world/`, project build and development tools, tests, and the original `world-workshop-3d/` prototype source. It does not replace a license already attached to third-party material, previously MIT-licensed components, or the vendored PI Desktop tree. A directory location is not permission to relicense a dependency.

The project owner confirmed on 2026-09-15 that the original project and prototype code was authored by them or is held with authority to modify and publish under the agreed AGPL/MIT policy. This confirmation concerns code; it does not independently clear the rights to every generated model, reference image, brand, or imported asset. See the [application record](docs/LICENSE_APPLICATION_2026-09-15.md).

## Original export runtime: MIT

The project grants the [MIT License](LICENSES/MIT.txt) for its original runtime code in these exact source scopes:

| Scope | Included files |
| --- | --- |
| `desktop/godot/bases/` | Files ending in `.gd`, `.tscn`, `.tres`, or `.godot`. |
| `desktop/godot/components/` | Files ending in `.gd`, `.tscn`, `.tres`, or `.godot`. |
| `desktop/godot/shared/` | Files ending in `.gd`, `.tscn`, `.tres`, or `.godot`, including original runtime scripts inside the reference-world source directories. |
| `desktop/godot/probes/` and `desktop/godot/sandbox/` | Files ending in `.gd`, `.tscn`, `.tres`, or `.godot`. |
| `desktop/godot/web/` | `bridge.js` and `shell.html` only. |

The extension lists apply recursively and cover only project-owned code and scene/resource definitions. References to a model, texture, audio file, font, or other dependency do **not** license that referenced material. A pre-existing third-party notice or a more specific file license remains applicable. Assets are addressed separately below.

The copy at [desktop/godot/licenses/CRAFTMINE-RUNTIME-MIT.txt](desktop/godot/licenses/CRAFTMINE-RUNTIME-MIT.txt) carries this runtime grant into future distributions. Original generated snippets copied substantially from this runtime retain the same MIT terms. Independently generated or user-authored code must be assessed on its own origin; the tool does not assign it this license automatically.

Host-side creation code such as `desktop/godot/web/runtime.mjs`, `desktop/godot/shared/*.mjs`, native build brokers, validation services, and editor logic is **not** part of this MIT runtime scope. Code generated from an editor does not acquire a different license merely because it is called an export.

## Retained licenses and exclusions

| Material | Governing terms |
| --- | --- |
| `vendor/pi-desktop/`, including `crates/craftmine-core/` and covered modifications | Existing **LGPL-3.0-or-later** declarations remain in force. Read [upstream LICENSE](vendor/pi-desktop/LICENSE), the supplementary [GPL text](LICENSES/GPL-3.0-or-later.txt), and [provenance](desktop/UPSTREAM.json). Dependencies keep their own terms. The project does not remove prior LGPL grants to apply the default AGPL license. |
| `desktop/blender/bridge/driver.py` | Its existing **GPL-3.0-or-later** SPDX declaration remains in force. Blender itself and its dependencies retain their own licenses. |
| Existing MIT component declarations | Remain valid for the scope explicitly stated in each component's license. |
| Godot, MinGit, Electron/Chromium, fonts, parsers, and other dependencies | Their original licenses and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). |
| Models, images, audio, fonts, reference material, and other non-code assets | Only their own explicit licenses and provenance. Neither the default AGPL grant nor the runtime MIT grant supplies missing asset rights. |
| User-created/imported content, local profiles, and archived third-party material | Excluded from the default project-code grant; the applicable author or source terms govern. |
| Names, trademarks, and logos | Code licenses do not grant trademark permission or imply official endorsement. |

Earlier lawful recipients retain the rights they already received under applicable licenses. These files do not rewrite the bytes or terms of already sealed preview packages.

## Making and selling games

You may use the community tool to create commercial work. The project imposes no tool royalty or revenue share merely because you sell a game made with it. **Using a tool does not by itself place the work you create under the tool's license.** The actual code and assets incorporated into the work still determine which obligations apply.

MIT-covered runtime can be included in a proprietary game while preserving its copyright and permission notice. If the exported work actually incorporates AGPL, LGPL, GPL, or other separately licensed material, those obligations must be handled for that material and the actual combination; this document is not a blanket exemption.

AGPL permits commercial use. Distribution of covered software and remote interaction with a modified version can carry corresponding-source duties under its terms; enterprise status or revenue alone is not an extra payment condition. Consult the [AGPL text, including section 13](https://www.gnu.org/licenses/agpl-3.0.html#section13) for the actual requirements.

## Alternative commercial licensing

A separate commercial agreement may be discussed for original creation code over which the licensor holds sufficient rights. Contact the maintainer through the [repository](https://github.com/snowsnow0926/craftmine-world). No commercial contract is granted by this README, a purchase inquiry, or the draft documents in `desktop/delivery/licensing/drafts/`.

Commercial terms cannot replace PI Desktop, Blender, Godot, dependency, asset, or other third-party obligations. Existing contributions are not presumed to authorize commercial relicensing just because their commits appear in this repository.

## Distribution and contributions

Keep the applicable license texts, copyright notices, modification records, and corresponding source/build information with covered distributions. Future client builds stage the root license and scope documents alongside existing upstream notices. The supplied preview.27 remains an immutable historical build; its source commit and included notices identify that build's materials.

Contributions must identify external sources and preserve applicable notices. New original contributions follow the license of the target files unless separately agreed in writing. Submitting a contribution does not transfer copyright, sign an unapproved CLA, or grant an unrecorded commercial relicensing right.

The 2026-09-09/10 licensing inventory and generated notices are retained as historical audit snapshots. Their pending third-party checks remain pending; their statements that **no project license has been applied** are superseded for the scopes explicitly granted here. This is a license application, not a claim of a complete third-party rights audit.
