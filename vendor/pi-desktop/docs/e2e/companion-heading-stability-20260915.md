# Companion v4 package and CPU heading regression

Run from an isolated worktree:

    node --test tests/companion-heading-package.test.mjs tests/companion-bounds-package.test.mjs tests/builtin-pet-package.test.mjs
    node tests/godot-components/companion-heading-stability.mjs

Set CRAFTMINE_GODOT_CACHE_DIR to the existing pinned cache when the isolated tree
does not contain it. The probe validates archive/executable hashes, copies the
engine into its own output, starts with --headless and windowsHide, and uses
private environment/profile directories. No model, GPU, player profile, OS input,
focus or Pointer Lock is used.

The baseline process runs both released v3 scripts for 3000 physics frames
(50.004 seconds observed). Each ends at scale approximately
[0.9999630451, 1, 0.9999630451], maximum error 0.0000369549, and
PET_RESTORE_TRANSFORM_UNSUPPORTED from the original validator. The v4 write
process uses the same frames/interpolation, ends after 50.005 seconds with maximum
scale error 0.0000000596, and passes the same validator for both components.
It saves state at explicitly configured city coordinates. A fresh read process
restores exactly matching JSON for identity, settings, sourceSettings, position,
yaw and counter. Malformed child scale and out-of-world coordinates stay rejected.
Baseline/write/read passed 6/15/12 checks respectively.

The 12 package/library checks freeze every previously built companion archive
hash, compare v4 state/config/source-profile contracts with v3, and compare all
package files. Exactly one GDScript heading assignment may differ; all visual and
other files remain identical. Validate the complete builtin catalog and confirm
v4 is each companion's highest available version without deleting earlier rows.

New archive receipts from this build:

| Resource | Archive SHA-256 | Content hash |
| --- | --- | --- |
| Approved Pomeranian v4 | 90d8570e5dce02cb97bbc91dddf6543e9c4ce2b5f3b072d076a672d5342387dc | 0cc8909e124091f3a2aca92411ad0173afa4b755b8e6c289d0854312010bd100 |
| Generic pet v4 | 246cd91d32461c38863cce265a4a1b019e4ddaba68524e554c8967603d803b21 | 34ce066dc7ec262459697dd6e0d6f035fbfa8b9fbe2642d3f07341a40fcf9691 |

The fixture isolates orientation, save and cold restoration. It does not prove
obstacle navigation or visually inspect the model. Existing fixed composition
recipes still reference their original versions; a new library package alone
does not repair those worlds or custom derived scripts.
