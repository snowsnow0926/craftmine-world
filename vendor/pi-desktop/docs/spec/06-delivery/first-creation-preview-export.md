# First creation Windows preview export

The preview22 application keeps the existing PI Desktop packaging pipeline.
`desktop/build-client.ps1` builds from a clean commit, stages pinned Godot,
Blender and MinGit with that commit's runtime source distribution, embeds the
application source archive, seals the output and verifies its bytes. An earlier
release's runtime manifest cannot be relabeled with a new source commit.

`desktop/export-preview.mjs` requires a current clean source commit, that run's
seal and package evidence. It copies the complete sealed output to a new,
nonoverlapping directory. Existing destinations and archives are refused. The
original release is unchanged. The output includes the original evidence,
build identity, a Chinese quick start and a CRLF launcher using relative paths.

The launcher clears inherited Craftmine/PI Desktop test overrides, Electron's
Node mode and Node options. Preview22 uses
`%LOCALAPPDATA%/CraftmineWorld-FirstCreationPreview22`; it does not reuse the
default or preview21 profile. A player launches it themselves after extracting
the complete ZIP. Export and verification do not execute the application.

The ZIP tool is caller-supplied with an explicit SHA-256 pin. Its listing is
checked for paths, aliases and links before extraction into a fresh owned
directory. Extracted files are compared with the complete delivery inventory,
including sources and notices. The archive gets a checksum and separate JSON
evidence. Verification extraction is retained for inspection; cleanup is a
separate owned-path operation. ZIP success proves byte equivalence, not clean
Windows, installer, signature or new-player acceptance.

## Optional reusable examples and player documents

Pass `--extras-manifest <absolute-json-path>` to attach trusted build inputs to
the portable delivery, outside the sealed application. Omission preserves the
original interface. The manifest has exactly `format` and `entries` fields:

```json
{
  "format": "craftmine.preview-extras/1",
  "entries": [
    {"name": "examples/companion-and-rain.zip", "file": "D:/approved/companion-and-rain.zip", "sha256": "<64 lowercase hex digits>", "bytes": 7567907}
  ]
}
```

Entries have exactly `name`, `file`, `sha256` and `bytes`. Names must be safe
relative paths under `examples/` or `docs/`, with no aliases, traversal, links,
case-insensitive duplicates or file/directory collisions. Source paths must be
absolute ordinary files through ordinary ancestors. The JSON is at most 64 KiB,
with 1–16 files, each at most 64 MiB and total at most 256 MiB. Byte size and
SHA-256 are checked before export and after copying. A source change fails the
delivery; no partial output is declared complete. `EXTRAS.json` and `DELIVERY.json`
record the pinned manifest and copied entries, which also participate in full
ZIP extraction verification. No automatic import or catalog registration occurs.

## Verification scenario

Run `node --test tests/preview-export.test.mjs` from the repository root. Set
`CRAFTMINE_PREVIEW_ARCHIVE_TOOL` to a known local 7-Zip executable for the real
small ZIP round trip. Verify the final full release with its actual pinned
tool, then run native packaged-player acceptance independently. Never invoke
the generated launcher during automated tests or send physical input.
Exercise optional templates/documents, a tampered source, an ancestor junction,
duplicate/escaping paths and bounds. The final extracted archive must contain
the exact added templates while the original application seal still verifies.
