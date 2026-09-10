# Package test prepared; execution pending

The new fixed packaged-client runner, identity/ledger assertions and three small
negative test groups are implemented. `node --check` succeeds and all three test
groups pass; raw output is in `evidence/package-harness-tests.log`.

No Windows package was launched for this preparation. In particular, the older
ae32974 package cannot prove the new path-budget/error behavior. The runner needs
the actual new package directory, expected commit and exact build-manifest hash
from the parent release process. See the standalone specification
`vendor/pi-desktop/docs/spec/06-delivery/godot-task-path-package-acceptance.md` for
the fixed command and assertions. A later report must contain both real exit
audits, same failed-world identity after restart and the corresponding unlaunched
import ledger evidence before package acceptance can be marked passed.
