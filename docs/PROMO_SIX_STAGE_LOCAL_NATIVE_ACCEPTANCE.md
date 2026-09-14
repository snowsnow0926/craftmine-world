# Local six-stage ordinary-library acceptance

This is a zero-model functional acceptance route while the provider is unavailable. It does not prove DeepSeek selected or authored anything autonomously. Run it only when the native/GPU owner has released the lane.

```powershell
$env:CRAFTMINE_CREATION_OUTPUT_ROOT='D:/cm-promo-six-local'
node tests/direct-library-native.mjs --application-root 'ABSOLUTE_CHECKOUT' --packaged-root 'ABSOLUTE_SEALED_WIN_UNPACKED' --scenario promo-six-stage
```

`--resources` may explicitly name that exact package's `resources` directory; other resources are refused for this scenario. The launcher verifies the real executable, package inventory and headless/pointer guards. It uses a new isolated profile, no provider credentials and no user-profile copy.

The actual PI New World form creates a blank creation-sandbox world. The existing asset sheet selects and inspects the packaged broadleaf, meadow, hornlings, heavyblade, hunt and AK47 in that order, then uses its normal check/apply forms. The driver reads the sealed base's actual ground/camera source and verifies six ZIP hashes/root hashes before launch. The placement is limited to that verified 64 m floor: the tree lies outside the arena, the translated monster activity footprint stays on the floor, and the 22 by 28 m hunt footprint remains subject to the product's real physics guard.

Each adopted stage records the operation and exact asset/version reference, source revision/hash, independently assigned instance IDs, frozen before/after component and player progress, and a bound formal-view screenshot. It uses existing engine-only walk/look and normal J/H/2/B/R/3 input segments to inspect sword hits, beast attacks, rifle damage/ammunition and reload. It does not write source, coordinates, DB rows or snapshots. A failed action, release, save or capture remains explicit evidence and stops acceptance. Input records are written before post-input save so that a save failure cannot erase an already executed action.

The final save and normal shutdown are followed by a cold reopen through the ordinary world chooser; formal build, source IDs, all six durable applied operations and complete progress are compared. A failed cold equality is retained for diagnosis rather than silently relaxing the comparison. Cancellation uses the printed `cancel` file or SIGINT and releases active engine inputs before normal shutdown.

The legacy two-companion/cancellation scenario remains the default. The six-stage branch does not run those unrelated tests. Offline checks:

```powershell
node --check tests/direct-library-native.mjs
node --test tests/direct-library-promo-scenario.test.mjs
```
