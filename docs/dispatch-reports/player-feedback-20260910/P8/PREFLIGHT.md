# P8 implementation preflight

This report covers offline preparation only. No authorized credential file has
been read and no real model request has been sent by these tests.

The finite Main helper and bounded relay were committed first as `e4cc898f`.
The follow-up adds the native driver, durable cross-profile 16-admission journal,
P4 usage reconciliation, fixed ordinary game actions and explicit pending
behavior review. Actual results remain unrun until the integrator supplies the
clean compiled candidate. These reconstructed prompts are not player originals.

Validation (2026-09-10):

- `node --test tests/player-feedback/P8/preflight.test.mjs`: 10/10 synthetic
  loopback/helper/journal/usage cases passed; no upstream network or engine.
- `node --check tests/player-feedback/P8/client-native.mjs`: passed.
- Strict TypeScript compilation of the actual Main helper and imported fixed
  gameplay helper: passed, using read-only integration dependencies and D output.

Main installation adds optional `godot` with the same `GodotGameplayAccess`
already used by the existing fixed gameplay acceptance. No arbitrary game op,
script, selector, RPC or path is accepted from P8 messages.

After source integration/build approval, the development command is:

```powershell
$env:CRAFTMINE_P8_APPROVED_COMMIT = '<actual-clean-built-commit>'
& 'C:/Program Files/nodejs/node.exe' tests/player-feedback/P8/client-native.mjs --source-root D:/cm-fb-20260910 --runtime-source D:/cm-fb-20260910 --deps-app D:/cm-fb-20260910/vendor/pi-desktop/apps/desktop
```

Packaged mode instead requires `--packaged-root`, `--expected-commit` and
`--expected-build-manifest-sha256`, with no development runtime override.
All runs share the root `test-results/p8-authorized-20260910.ndjson`; restarting
the relay or using a new isolated profile must not reset the request allowance.
Do not run either command against an unapproved or old compiled client.

The automatic report distinguishes source/check/apply/save pipeline completion
from pending behavioral assessment. The existing sword/pistol or fixed town route
does not validate new hammer/dog behavior. Failure, unknown usage and unrun fault
cases remain explicit. This preflight is not an installer or player acceptance.
