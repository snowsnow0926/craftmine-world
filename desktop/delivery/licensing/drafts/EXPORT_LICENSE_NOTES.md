# DRAFT — pending legal review; not a contract; not a licence

> **DRAFT — pending legal review; not a contract; not a licence.**
> These notes describe what a player or creator may do with an exported game and what
> must travel with it. They are not the export licence, grant nothing by themselves
> and must be reviewed by counsel before they are shipped. The machine-checkable
> version is `desktop/delivery/licensing/offline-entry.json`; the generated,
> cite-everything version is `desktop/delivery/licensing/notices/EXPORT-NOTICES.md`.

## TODO(unknown) — must be filled in before these notes are usable

- `TODO(unknown)` **Project legal entity** that would grant any project licence in
  the export, and the copyright-holder string for the MIT export runtime text.
- `TODO(unknown)` **Exact export manifest**: which project files are included in an
  export and which are not. Today the export pipeline copies the Godot engine output,
  the bridge/shell and the base scripts; `desktop/godot/web/runtime.mjs` is
  host-side only and is never copied.
- `TODO(unknown)` **AGPL/LGPL inclusion decision**: whether an export ever includes
  creation-core or client code, and if so how corresponding source is provided.
- `TODO(unknown)` **User-content policy wording**: what the creator must carry for
  imported assets, and how the client helps them do it.
- `TODO(unknown)` **AI-output wording**: what the creator is told about generated
  content and provider terms.
- `TODO(unknown)` **Jurisdiction-specific notice wording** and translation.
- `TODO(unknown)` **Counsel review** of these notes.

## 1 What a player or creator may do with an exported game

- Play, copy and share the exported game, including commercially, subject to the
  licences of everything inside it.
- The Godot Engine is MIT: commercial use, modification and redistribution are
  permitted as part of the export, provided the engine's copyright and licence
  notice travel with it (`licenses/GODOT_LICENSE.txt`,
  `licenses/GODOT_COPYRIGHT.txt`; evidence: `desktop/godot/toolchain.lock.json`,
  `desktop/godot/licenses/notices.manifest.json`).
- The creator's own content stays the creator's. The project does not claim copyright
  in user works and does not relicense them (evidence:
  `desktop/windows-NOTICES.md`, `desktop/godot/licenses/notices.manifest.json`
  `notIncluded`).
- Third-party assets the creator imports keep their own licences; the creator is
  responsible for checking and carrying them.
- Project export-runtime code is a **MIT target**, not an applied grant. Until the
  MIT text with a copyright-holder string exists, no licence is asserted here
  (`desktop/delivery/licensing/inventory.json`, entries `godot-web-bridge-runtime`,
  `godot-probes`, `base-*`; `offline-entry.json` id `mit`, status `missing`).

## 2 What must travel with an export

| path | content | status |
| --- | --- | --- |
| `licenses/GODOT_LICENSE.txt` | Godot Engine MIT text | required, copied today |
| `licenses/GODOT_COPYRIGHT.txt` | Godot bundled third-party notices | required, copied today |
| `licenses/EXPORT-NOTICES.md` | this explanation | required |
| `licenses/CRAFTMINE-MIT.txt` | project export runtime MIT text | **missing** — target not applied |
| `licenses/CRAFTMINE-LICENSE-AGPL-3.0.txt` | AGPL text | conditional — only if AGPL code is included |
| `licenses/LGPL-3.0.txt` | LGPL text | conditional — only if LGPL code is included |
| licence texts for imported third-party/user assets | creator's responsibility | not supplied by the project |

## 3 AGPL and LGPL code in an export needs separate handling

- If an export includes AGPL-3.0-only code (creation core, built-in plugin,
  `craftmine-core`), the export must carry the AGPL text and provide the
  corresponding source for the included code to the recipients the licence requires.
- If an export includes LGPL-3.0-or-later code (PI-Desktop and its modifications),
  the export must carry the LGPL text and provide whatever source, replacement or
  relinking facilities the chosen distribution requires.
- The current export pipeline does not include the client, so both ids are recorded
  as `conditional` and neither is satisfied or violated by default
  (`offline-entry.json`, `docs/LICENSING_STRATEGY.md` section 3).
- "The project does not take a cut of your sales" is not a substitute for
  distribution compliance.

## 4 What the project does not warrant

- No warranty that an export is free of third-party rights, including AI-generated
  content. The project cannot promise third-party authorisation and does not hold
  rights it has not been granted.
- No warranty of merchantability, fitness for a particular purpose, legal
  sufficiency in any jurisdiction, or that the notice set is complete everywhere.
- No warranty about the provenance of content the creator imports or generates.
- The inventory marks unresolved rights `pending-rights-review` or
  `unknown-rightsholder`; those are never a pass (`desktop/delivery/licensing-check.mjs`).
