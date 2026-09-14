# Combat package declaration recovery

The observed DeepSeek session had four `PACKAGE_SINGLE_ENTITY_DECLARATION_REQUIRED`
replies, two schema validation errors, one invalid-parameter error and one wrong
catalog hash. Read the stored tool JSON envelope before counting errors; do not
classify every row with a serialized envelope as successful or print thinking.
The first failure was an intrinsic v1 package contradiction, while subsequent
invented entity/recipe parameters and the wrong hash remain model errors.

CPU source-transaction validation, without Godot execution or inference:

```powershell
$env:CRAFTMINE_CORE_BIN = '<absolute path to the actual craftmine-core.exe>'
node --test tests/builtin-combat-package.test.mjs tests/combat-install-contract.test.mjs tests/source-library-read-hints.test.mjs tests/godot-final-install-assets/source-library.test.mjs
node desktop/build-world-plugin.mjs --output test-results/combat-install-plugin
```

Require v1 SHA-256
`bf763ccd427c0135b59b0e8db9024136c80dd7810de8d5e004157fc526aeaf63`
and 14,134 bytes unchanged. It remains refused by the real source installer with
the original single-entity error and no source revision change. Search/read must
show the intrinsic failure even when receiving-world source is unavailable.

Require v2 to declare one automatic CharacterBody3D monster, all three original
scripts with UID files, and explicit unique-vitals/manual-weapon setup. Through
real Rust catalog import, proposal and source installation, install v2 twice as
one group: two different monster identities, one source CAS/check submission,
all helper files available, no automatically mounted vitals/weapon nodes, and
`applied: false`. Preserve exact archive refs and all compatibility guards.
The test deliberately does not run an engine check or claim combat gameplay.

For the next ordinary player continuation, search/read corrected v2 rather than
retrying v1 with guessed parameters. After installation, read actual source paths,
mount required helper nodes through normal source editing, and check/adopt before
claiming monsters pursue or damage the player. Later sword/AK requests still need
their requested behavior and actual play tests; do not shrink them to the basic
ray weapon or silently add an unrequested weapon during monster setup.
