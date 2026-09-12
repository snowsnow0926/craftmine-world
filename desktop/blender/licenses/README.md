# Blender 5.2.1 LTS distribution notices

Blender is Copyright Blender Foundation and its contributors. The unmodified
official Windows x64 portable binary is distributed under GPL-3.0-or-later.
The GPL v3 text is at `../gpl/GPL-3.0.txt`. Blender's original `copyright.txt`
is beside this file; the complete third-party notices, SPDX texts and component
license inventory are preserved in `upstream/` and in
`../../blender/runtime/license/`. No upstream file has been stripped or changed.

Official licensing explanation: https://www.blender.org/about/license/
Official FAQ: https://www.blender.org/support/faq/

The separate Craftmine Blender Python adapter at
`../../blender/bridge/driver.py` is supplied in source form under
GPL-3.0-or-later (see its SPDX header). This scope does not relicense the host,
other project components, imported assets or generated models. Blender and the
host exchange job files across a separate process; the host does not link bpy.
Generated assets retain their own provenance and any input-material obligations.

## Source and rebuilding

The exact upstream source archive is supplied at
`../../blender/source/blender-5.2.1.tar.xz`. The archive and all runtime file hashes
are recorded in `../../blender/toolchain.lock.json`. Craftmine adapter and broker
source/build scripts are in `../../source/CraftmineWorld-source.zip`.

Upstream source: https://download.blender.org/source/blender-5.2.1.tar.xz
Exact upstream tag: https://projects.blender.org/blender/blender/src/tag/v5.2.1
Build guide: https://developer.blender.org/docs/handbook/building_blender/windows/
Dependency build guide: https://developer.blender.org/docs/handbook/building_blender/dependencies/
Dependency source URLs, hashes and build recipes are in the supplied source at
`build_files/build_environment/cmake/versions.cmake` and the surrounding
`build_files/build_environment/` directory. Bundled-in-source dependency notices
are in `extern/`; additional license/version records are in the portable runtime's
`license/license.md` and `license/licenses.json`.

These are source availability records, not a claim that the Blender source tar
alone contains every third-party Corresponding Source dependency. A distributor
must keep complete corresponding source (including applicable dependency source
and build scripts) available as GPL requires, alongside its binary distribution.
If upstream locations cease to provide it, the distributor remains responsible;
a URL is not a substitute for missing source. This local integration neither
publishes a download nor makes a written source offer on behalf of a publisher.
