# DRAFT — pending legal review; not a contract; not a licence

> **DRAFT — pending legal review; not a contract; not a licence.**
> This is a reviewable outline only. It grants nothing, binds no one and has no legal
> effect. Every bracketed item and every `TODO(unknown)` must be completed by the
> rights holder and reviewed by qualified counsel before it is used. Facts and open
> questions are tracked in `desktop/delivery/licensing/inventory.json`; the governing
> decision record is `docs/LICENSING_STRATEGY.md` (a decision record, not an applied
> licence).

## TODO(unknown) — must be filled in before this draft is usable

- `TODO(unknown)` **Licensor legal entity**: the exact company/person that owns the
  rights being licensed, its jurisdiction and registration data. Not established.
- `TODO(unknown)` **Licensor authority**: evidence that the licensor actually owns or
  has the right to sublicense each covered module, including contributions without a
  signed CLA (see `licensing/drafts/CLA_DRAFT.md`).
- `TODO(unknown)` **Licensee identity**: legal name, entity type, jurisdiction.
- `TODO(unknown)` **Covered module list and versions**: which files/commits are
  covered. `craftmine-core`, `app/` and `plugins/craftmine-world/` are candidates;
  their per-file rights are still `pending-rights-review`.
- `TODO(unknown)` **Commercial terms**: fees, currency, payment schedule, taxes.
- `TODO(unknown)` **Support scope and SLA**: response times, channels, hours.
- `TODO(unknown)` **Term, renewal and termination mechanics**.
- `TODO(unknown)` **Governing law, venue, dispute resolution, liability cap**.
- `TODO(unknown)` **Third-party exclusions**: confirm that no upstream LGPL code, no
  Godot engine, no font and no npm/Rust dependency is covered (see
  `licensing/notices/CRAFTMINE-NOTICES.md`).
- `TODO(unknown)` **Trademark and brand usage** rules for the project name and marks.
- `TODO(unknown)` **Counsel review** of the whole document.

## 1 Scope

- Licensed subject: the project-owned creation core identified in
  `licensing/inventory.json` (candidate ids `craftmine-core`, `app-creation-core`,
  `plugin-craftmine-world`), **only to the extent the licensor has the right to
  license it**.
- Excluded by default: PI-Desktop upstream and its modifications (LGPL-3.0-or-later,
  `pi-desktop-upstream`, `pi-desktop-modifications`), the Godot Engine and its
  bundled third-party components (`godot-engine`, `godot-third-party-components`),
  bundled fonts (`bundled-fonts`), npm and Rust third-party dependencies
  (`npm-third-party-dependencies`, `cargo-third-party-dependencies`), and all user
  content and AI output (`user-created-content`, `ai-generated-output`).
- Community option: the same covered modules remain available under AGPL-3.0-only.
  The commercial licence is an alternative path, not a replacement. Buying it does
  not discharge any third-party licence obligation.
- Charging for a work made with the community edition is not itself a trigger for
  this licence; enterprise identity or revenue is not a trigger either
  (`docs/LICENSING_STRATEGY.md` section 2).

## 2 Covered modules and versions

- `TODO(unknown)`: an explicit module/version table (module id, repository path,
  version, commit, whether modifications are covered).
- The licence covers only the modules listed; anything added later needs a written
  amendment or a new licence.
- No retroactive effect: recipients who already received rights under the AGPL keep
  them (`docs/LICENSING_STRATEGY.md` section 4).

## 3 Closed-source integration

- Permitted only for the covered modules and only as described in the licence grant.
- The licensee must not combine the covered modules with third-party code in a way
  that would require the licensor to grant rights it does not hold.
- `TODO(unknown)`: whether static linking, dynamic linking, process separation or
  network-only integration is covered, and any per-mode conditions.

## 4 Hosting and redistribution

- `TODO(unknown)`: whether the licensee may host the covered modules as a service,
  and whether that service may be offered to third parties.
- `TODO(unknown)`: redistribution rights (binary only, binary plus object code,
  source escrow), territories and channels.
- Corresponding-source and notice obligations for any third-party code that travels
  with the product stay with the licensee.

## 5 Term, updates and support

- Term: `TODO(unknown)`.
- Updates: `TODO(unknown)` — whether new versions are included, and for how long.
- Support: `TODO(unknown)` — separately priced services, if any.
- Software licence fees and service fees are distinct; a service contract does not
  grant a software licence and vice versa (`docs/LICENSING_STRATEGY.md` section 5).

## 6 Fees and services

- `TODO(unknown)`: fee schedule, invoicing, late payment, refunds.
- `TODO(unknown)`: enterprise modules (future proprietary components) are priced
  separately and are not covered by this draft.

## 7 Third-party exclusions and no warranty

- The licensor gives no warranty over third-party code, assets, fonts or content.
- The licensor cannot grant rights in upstream LGPL code, Godot, or any npm/Rust
  dependency; those keep their own licences.
- `TODO(unknown)`: warranty disclaimer, indemnity position and liability cap.
- This draft promises no third-party authorisation and must not be presented as one.

## 8 Termination

- `TODO(unknown)`: termination triggers, cure period, effect on previously shipped
  products, survival clauses and post-termination source obligations.
- Termination of this licence does not retroactively withdraw AGPL rights already
  granted for prior versions.
