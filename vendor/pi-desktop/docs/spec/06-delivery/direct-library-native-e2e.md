# Direct library native acceptance

1. In an independent offscreen PI client with no model connection, open a world,
   open a selected immutable companion in the existing library, inspect it and
   start with an explicit placement. Check the exact source package bytes and
   original player/world source, then explicitly apply through native first-load
   and current-progress preservation. Record real stage timings and zero model
   calls. Repeat at another valid placement and verify distinct instance ids.
2. Close the panel while checking, reopen and recover the same operation. Simulate
   lost install/adoption acknowledgements: retries reconcile the exact instance
   and Core adoption, with no second installation.
3. Cancel during installation and during candidate staging. The fence precedes
   the cancellation request; late check completion does not apply. Report source
   already retained in the draft. Change source or switch worlds before apply:
   formal content must not be changed by the stale operation.
4. Restart with an unfinished operation. Display interruption and recovered check
   results; never replay installation or apply automatically. Explicit recovery
   requires the same formal build and a fresh native instance binding.
5. Reject raw/non-package content, world templates and multiple scene roots.
   Reject forged paths/source/context, latest references, changed exact hashes,
   altered retry payloads and out-of-range coordinates.
6. After successful native adoption, use ordinary supported modification, save,
   cold reopen and existing portable export/import to verify durable reuse.

Fixtures: `apps/desktop/test/direct-library.test.mjs` proves operation protocol
and races; repository `tests/godot-final-install-assets/source-library.test.mjs`
proves real static ZIP validation and private source/check authority. They do not
claim human acceptance or clean external Windows execution. Native acceptance
uses page scripts/owned offscreen processes, no mouse/keyboard simulation,
foreground windows or Pointer Lock. Root integration records the actual results.
