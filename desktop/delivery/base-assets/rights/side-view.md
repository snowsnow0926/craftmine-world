# Rights statement: 2D side-view base (shipped base directory)

Scope: every file below `desktop/godot/bases/side-view`, as pinned by
`desktop/delivery/base-assets/bases-side-view.json`.

Status: **project-authored, formal licence application pending.**
This document is a rights statement, not a licence text. It does not grant
anything and it does not replace the licences named below.

## 1 What this base contains

- Authored GDScript, scenes, world data and documentation written for this
  repository.
- No binary art asset: every visual is drawn in code with `Polygon2D`,
  `ImageTexture` and `_draw()` calls. See
  `desktop/godot/bases/side-view/docs/assets-and-provenance.md`.
- Godot-generated `.uid` sidecars and the gitignored import cache.

No third-party image, audio, font, model or Godot plugin is included. There is
no asset licence to audit for this base, and none is claimed.

## 2 Rights holder and evidence

- Rights holder for the authored content: **Craftmine World project**.
- Evidence: the file history of this repository. The base was authored by the
  base task and its runtime draws its own visuals; no external file was
  downloaded or converted.

## 3 Target licence and what is still open

Per `docs/LICENSING_STRATEGY.md` the confirmed targets are MIT for the code a
player-exported game needs, and AGPL-3.0-only or a commercial licence for the
creation core. `desktop/delivery/base-assets/bases-side-view.json` records
`targetLicense` per entry and `rightsStatus: pending-formal-application`.

Still open:

- per-file authorship confirmation before the MIT grant is applied to the export
  runtime files (tracked in `desktop/delivery/licensing/inventory.json`);
- the formal licence text, copyright holder string and commercial scope review by
  counsel;
- the creation-core / export-runtime boundary, currently derived from directory
  and distribution role.

## 4 Not covered here

- The Godot engine, distributed under its own MIT licence; its notices are pinned
  in `desktop/godot/licenses/` and travel with the package and every export.
- PI-Desktop and its modifications (LGPL-3.0-or-later).
- User-created worlds, imported assets and AI output: the project does not claim
  copyright in them and makes no warranty about their origin.
