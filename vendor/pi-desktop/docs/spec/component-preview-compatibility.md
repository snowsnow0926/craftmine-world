# Preserve component versions across placement-preview bridge updates

The native placement-preview implementation changes only the engine extension
of the runtime bridge. The original runtime bridge, state registry and sandbox
player/adapters are unchanged. Two package builders previously hashed that
extension dynamically into their version 1 manifests: the approved Pomeranian
and controllable rain. Rebuilding them after the bridge update would change
released version 1 bytes and create catalog identity conflicts.

The released version 1 requirement is therefore fixed at the exact released LF
bridge SHA-256 `593ade6619c31f44ab3c86790a79ea8ebc0fbd0ac6b9a5ffee212ad5f8849270`.
No model, behavior, state, source alias, licence or existing package bytes change.

New version 2 packages retain the original three profiles and add the exact
placement-preview bridge cohorts:

- LF: `938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08`
- CRLF: `aaf17d885bfd63125ae850b5d80c40461157c7d7fe074d0433f8653c484d686c`

All other requirements remain exact. A different bridge hash does not match.
The normal source installer still performs its usual source compatibility,
draft, native check and candidate-adoption steps. Declaring an exact known
source profile does not itself certify receiving-world gameplay or save/reopen.

The built-in catalog retains the original `cw.module.approved-pomeranian@1` and
`cw.module.rain-control@1` files and adds `@2` under distinct `.v2.zip` names.
Old worlds and exact references retain version 1; this feature never overwrites
an installed instance. Normal latest browsing selects version 2. Reusing
already-installed old instances requires inspecting their actual source/state,
not automatically replacing them or regenerating their models.

Recipe catalog version 2 uses the two new exact component versions. Recipe
version 1 remains deterministic and continues to resolve old references,
including an explicit adaptation-required result against the new bridge.

Validation includes 28-entry released-byte comparisons, old/new profile matching,
unchanged behavior/state/rights, recipe selection by explicit version, and the
real Rust catalog's latest-versus-all-versus-exact reads. Integrated native
Pom/rain install, interaction and save/cold-reopen on the new bridge, and an old
version 1 world regression, remain required release acceptance. These are not
replaced by the source and catalog tests.
