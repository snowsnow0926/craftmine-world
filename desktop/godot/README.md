# Godot GD0 integration probes

This directory pins Godot 4.7.2 stable for Windows x64 and contains two fixed,
authored integration fixtures. It is not a finished runtime adapter or evidence
that the product Agent can author Godot projects.

From the repository root, run:

```powershell
powershell -NoProfile -File desktop/godot/prepare-toolchain.ps1
node tests/godot-headless.mjs
```

Preparation downloads the exact official editor archive into the ignored
`desktop/build/godot/4.7.2-stable` cache. It verifies the pinned byte count and
SHA256, compares unpacked files with the verified archive, and checks the supplied
license bytes. No engine window is opened. `-WithExportTemplates` additionally
downloads and verifies the separately pinned archive; export-template installation
and Web/native export validation are subsequent GD0 work.

The runner copies the verified executable and each source project into a new
`test-results/godot-headless-*` directory. It provides a self-contained editor
directory and separate APPDATA, LOCALAPPDATA, USERPROFILE and temporary paths.
The child receives only required Windows environment values, not model credentials.
It always uses `--headless`, `windowsHide: true`, a 45-second process limit and
bounded captured output. It does not inject keyboard/mouse events, request input
lock, show a window or interact with a running application.

The first-person fixture checks camera-relative weapon transforms, equipment UI
visibility, a real 3D ray intersection, ammo/damage and restart persistence. The
top-down fixture checks movement through the 2D physics engine, shop overlap,
purchase rejection outside the shop, item/currency changes and restart persistence.
Headless Godot uses a dummy render surface; viewport/control measurements do not
prove crosshair appearance, scene graphics or GPU performance.

These fixtures are trusted integration source. An independent directory and
process are not an untrusted-code sandbox. Do not connect arbitrary generated
projects to automatic import or execution until GD0/GD2 supplies and verifies
the required operating-system boundary. Editor tools, resource importers and
native extensions belong to that boundary too.

The matched Godot MIT and third-party notices are retained in `licenses/`.
Client and standalone-game packaging must include applicable notices separately
from existing PI-Desktop LGPL obligations and other assets. See the development
plan for the full distribution scope.

Sources: [official release](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable),
[command-line interface](https://docs.godotengine.org/en/4.7/tutorials/editor/command_line_tutorial.html),
[data paths](https://docs.godotengine.org/en/4.7/tutorials/io/data_paths.html),
[pinned Windows data-path implementation](https://github.com/godotengine/godot/blob/4.7.2-stable/platform/windows/os_windows.cpp).
