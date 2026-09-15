# Craftmine World Windows distribution notices

Original project creation software is licensed under AGPL-3.0-only, with the
explicit original export-runtime scopes separately licensed under MIT. Read
`LICENSE`, `LICENSING.md`, `LICENSE.zh-CN.md` and `THIRD_PARTY_NOTICES.md` beside
this file in `resources/licenses/`. Full supporting texts are in `LICENSES/`.
The original PI Desktop tree, including currently LGPL-covered Craftmine domain
code, keeps its existing LGPL declaration. These project grants do not replace
third-party licenses or clear the rights of generated/imported assets.

Craftmine World / 最中幻想 derives from PI-Desktop, whose pinned upstream revision and provenance are in `UPSTREAM.json`. The upstream copyright and LGPL-3.0-or-later license remain in `PI-Desktop-LICENSE.txt` and the supplied source archive. This file does not replace or relicense upstream material.

The corresponding project source is bundled at `resources/source/CraftmineWorld-source.zip`, with build instructions, Chinese user guidance and a source/hash manifest. Build from that exact archive with the checked-in lockfiles. No remote publishing or proprietary-only redistribution is performed by this local preview build.

The original geometric Craftmine voxel icon is authored for this project in `desktop/windows-brand-assets.mjs`; SVG, PNG and ICO are generated from that source. Upstream PI artwork remains in the corresponding upstream source for provenance and other platforms; the Windows application and installer use the new mark.

Electron and Chromium notices are carried in their normal package files. `resources/licenses/third-party/npm-inventory.json` lists installed build/runtime package names, pinned versions and declared license identifiers, with available top-level LICENSE/NOTICE/COPYING texts copied beside it. The lockfile and package sources determine transitive relationships. The bundled source retains upstream authorship and declarations; missing package license files are represented honestly in the inventory rather than inventing a license.

The locally shipped Geist, Inter, Noto Sans SC and LXGW WenKai font licenses are copied into `resources/licenses/fonts`. Original font files and attribution remain in the corresponding source archive. The Babel parser license is additionally present in the built-in world plugin. User-authored/imported assets retain their own provenance and are not relicensed by this client.

The fixed Godot 4.7.2-stable engine, Web templates and Windows x86-64 templates are staged under `resources/godot/engine/4.7.2-stable`. Godot's MIT text and third-party aggregate are included in `resources/licenses/godot/` and `resources/godot/licenses/`. The broker's host-generated release identity is in `resources/godot/broker/broker-identity.json`.

The complete official Blender 5.2.1 LTS portable runtime is bundled under `resources/blender/runtime/` under GPL-3.0-or-later. Its original third-party notices are retained and copied to `resources/licenses/blender/upstream/`. The GPL text is `resources/licenses/gpl/GPL-3.0.txt`; source, dependency build pointers and adapter scope are documented in `resources/licenses/blender/README.md`. The upstream source tar is in `resources/blender/source/`; its presence alone is not a claim that all third-party Corresponding Source obligations have been discharged. The separate Blender Python adapter is supplied as GPL-3.0-or-later source; this declaration does not relicense the host or generated assets.

The complete pinned MinGit 2.53.0.windows.1 distribution is included under `resources/git/`, including `LICENSE.txt` and its component license trees. `GIT-BUNDLE-PIN.json` records the official archive URL and hash. `resources/runtime-resources.json` records every staged runtime file and the exact Craftmine source commit; the source archive above covers Craftmine and its broker, not the independent upstream Godot/Git repositories.

Windows current-user DPAPI is a system service, not a transferable credential backup format. Portable domain backups exclude credentials. The application, domain files and model-provider account remain independent of any personal PI-Desktop installation.

The optional built-in source library includes selected Kenney Nature Kit 2.1 and Castle Kit 2.0 models under CC0-1.0. Original models, the castle palette, archive/file hashes and the original license texts are preserved in `desktop/godot/components/curated-starter` in the source archive. Each shipped component ZIP under the world plugin's `builtin-source-library` contains its own applicable license texts. Craftmine's new instance wrappers and optional natural-daylight resources carry their own MIT texts; these declarations cover only those resources, not the entire client. Importing these packages into the local library does not install them into a player's world until they are explicitly selected and adopted.
