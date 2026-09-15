# Third-party notices

Craftmine World / 最中幻想 includes separately licensed software and assets. This index identifies their notices; it does not replace the original texts or grant rights that their authors have not granted.

The project's own grants are in [LICENSING.md](LICENSING.md) ([中文说明](LICENSE.zh-CN.md)). More specific copyright, license, and provenance declarations continue to apply to their respective files.

Repository-relative links refer to the source checkout or the corresponding source archive. Packaged-client copies of component texts live under `resources/licenses/` and the component runtime directories described below.

## Software and runtime components

| Component | Declared license and attribution | Repository evidence / full notices |
| --- | --- | --- |
| PI Desktop | LGPL-3.0-or-later; PI Desktop authors and contributors. Fixed upstream commit `ed0a75414e775eef4b4ee6c985cc9ddfe146ced2`. | [Original license](vendor/pi-desktop/LICENSE), [upstream provenance](desktop/UPSTREAM.json), [LGPL supplement](LICENSES/LGPL-3.0-or-later.txt), [GPL text incorporated by LGPL](LICENSES/GPL-3.0-or-later.txt). |
| Godot Engine | MIT; Godot Engine contributors, Juan Linietsky and Ariel Manzur. Build pin: `4.7.2-stable`. Dependencies have their own notices. | [LICENSE](desktop/godot/licenses/GODOT_LICENSE.txt), [dependency copyright aggregate](desktop/godot/licenses/GODOT_COPYRIGHT.txt), [toolchain lock](desktop/godot/toolchain.lock.json), [official explanation](https://godotengine.org/license/). |
| Blender | The repository pins `5.2.1` under GPL-3.0-or-later; Blender Foundation and contributors. Python and bundled dependencies keep their original terms. | [Distribution/source guide](desktop/blender/licenses/README.md), [toolchain/source lock](desktop/blender/toolchain.lock.json), [official explanation](https://www.blender.org/about/license/). |
| Craftmine Blender Python adapter | Existing GPL-3.0-or-later declaration, distinct from the host and generated assets. | [SPDX declaration](desktop/blender/bridge/driver.py), [GPL text](LICENSES/GPL-3.0-or-later.txt). |
| Git for Windows / MinGit | The bundle declares GPL-2.0-only for Git; components have additional licenses. Build pin: `2.53.0.windows.1`. | [Bundle provenance](desktop/delivery/git-bundle.json). The client keeps `resources/git/LICENSE.txt`, `mingw64/share/licenses/`, and `usr/share/licenses/`. |
| Electron and Chromium | Electron's MIT notice and Chromium's individual third-party notices, as supplied by their distributions. | [Desktop dependency manifest](vendor/pi-desktop/apps/desktop/package.json), [pnpm lockfile](vendor/pi-desktop/pnpm-lock.yaml); package files `LICENSE.electron.txt` and `LICENSES.chromium.html`. |
| npm and Rust dependencies | Each dependency's own declared license and copyright. | [pnpm lockfile](vendor/pi-desktop/pnpm-lock.yaml), [Cargo lockfile](vendor/pi-desktop/Cargo.lock), [historical npm inventory](desktop/delivery/licensing/evidence/npm-licenses.json), [historical Rust inventory](desktop/delivery/licensing/evidence/cargo-licenses.json). |

Some lockfiles retain historical status labels. For a particular binary, use its actual `resources/runtime-resources.json`, source/build manifest, original notices, and bundled dependency inventories; a historical status string is not evidence that a runtime is absent from that binary.

## Fonts

The bundled font families retain **SIL Open Font License 1.1**, original author notices, and any Reserved Font Names recorded in these files:

- [Geist](vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-Geist.txt)
- [Inter](vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-Inter.txt)
- [Noto Sans SC](vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-NotoSansSC.txt)
- [LXGW WenKai](vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-LXGWWenKai.txt)

The desktop places these texts under `resources/licenses/fonts/`. Code licensing does not rename fonts or remove font-specific conditions.

## Models, scenes, and other assets

| Material | Applicable record |
| --- | --- |
| Kenney Nature Kit 2.1 | CC0-1.0. [Original notice](desktop/godot/components/curated-starter/licenses/kenney-nature-License.txt), [source and hashes](desktop/godot/components/curated-starter/manifest.json), [official kit](https://kenney.nl/assets/nature-kit). |
| Kenney Castle Kit 2.0 | CC0-1.0. [Original notice](desktop/godot/components/curated-starter/licenses/kenney-castle-License.txt), [source and hashes](desktop/godot/components/curated-starter/manifest.json), [official kit](https://kenney.nl/assets/castle-kit). |
| Previously licensed original geometry, materials, icons, and component wrappers | The exact scope in each component's `LICENSE.txt` or `ORIGINAL_ASSETS_LICENSE.txt`. A wrapper license does not automatically cover a model. |
| Generated/reference-guided Pomeranian and aircraft models | Their records retain unresolved model rights: [Pomeranian provenance](desktop/godot/components/approved-pomeranian/provenance.json), [aircraft notice](desktop/godot/components/reusable-j20/LICENSE.txt). The code license does not clear unrestricted model redistribution. |
| Other promotional assets | Preserve [reference-world sources](desktop/godot/shared/promo-templates/) and original notices. Source declarations and catalog `licenseStatus` values are not independent verification of generated/reference rights. |
| User imports and AI output | Evaluate the actual source, terms, and incorporated material. Neither Godot nor Blender's software license supplies a blanket license for all created content. |

The [reuse catalog](plugins/craftmine-world/reuse-catalog/asset-index.json) records content and known provenance. Inclusion in that catalog, a screenshot, or a demonstration does not authorize every asset's separate redistribution. The 2026-09-15 project-code confirmation does not silently change `unverified` asset records.

## Where notices and source travel

- **Source checkout:** keep this index, root licenses, vendored notices, asset licenses, and provenance together.
- **Future Windows clients:** project texts are staged under `resources/licenses/` alongside PI Desktop, Godot, Blender, font, and npm notices. `resources/source/CraftmineWorld-source.zip` contains that build's project source and build instructions. The Blender source archive is separate under `resources/blender/source/`.
- **Standalone Windows games:** exports carry Godot notices and the original runtime's MIT text/scope notice, together with selected source. Additional included code or assets still need their applicable notices.
- **Library/component/template archives:** preserve their actual license files and source records. Older or independently authored archives do not automatically include the new root notices.

A project source ZIP or Blender source tar alone does not establish that every dependency's corresponding-source or redistribution obligation has been satisfied. Original notices and unresolved inventory entries must remain available.

## Historical inventories

`desktop/delivery/licensing/inventory.json`, its generated notices, and dependency evidence are dated audit snapshots, not current certification for every later build. The [2026-09-15 application record](docs/LICENSE_APPLICATION_2026-09-15.md) supersedes former project-owned-code targets only in the stated scope. Third-party checks are not blanket-approved.

Report missing or incorrect attribution with the affected file and its origin through the [issue tracker](https://github.com/snowsnow0926/craftmine-world/issues).
