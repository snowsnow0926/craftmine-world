# Demo entry and template feedback

Use isolated headless Chromium and actual React components with fixture services.
Disable Pointer Lock and focus; submit ordinary forms through page script. These
checks prove renderer behavior, not a new native or live-model acceptance run.

1. Open Examples. Require the four host-authored cards, their existing create
   buttons, and the single template import shortcut. Submit that shortcut:
   My templates becomes selected and the normal import form appears, with no
   import, world creation or model request dispatched by navigation.
2. Select a template, then search for an absent name. Require No matching
   templates, preserving the selected detail rather than claiming the library
   has no templates. With paged results, change the search text without submitting;
   Load more must retain the completed query and the host's next offset.
3. Import another exact version. Require a fresh first-page host list request,
   cleared search, the returned selected reference and a visible imported row.
   Creation remains a separate explicit action; the saved-progress note remains.
4. Lock a selected template with a retained create attempt. Its input/import and
   ordinary submit are blocked. Supplying an explicit retained-attempt retry
   enables only that callback, with the Retry label and unchanged locked inputs.
   The chooser retries its original input/operation, not the selected form data.
   In the actual chooser/controller fixture, return a registered world with
   failed preparation and a host-supported retry action. Submit the ordinary
   retry form, return ready from `world.creationRetry`, and require entry into
   that same world with a fresh conversation. There must be exactly one initial
   `world.create` call, one retry and no second copy registration.
5. Leave while import or list replies are delayed. Open another chooser and
   resolve the old replies. No old selection, rows, notices or creation may
   appear in the new chooser.
6. Confirm existing source reuse, failed-save navigation and conversation/draft
   fences still pass. Inspect normal and narrow layouts for usable controls.

Preparation in a fresh dependency-mirrored worktree:

```powershell
node vendor/pi-desktop/packages/shared/node_modules/typescript/bin/tsc -p vendor/pi-desktop/packages/shared/tsconfig.json
node tests/player-library-ui.mjs
node tests/player-workflow-ui.mjs
node tests/first-creation-guide-ui.mjs
```

Fixtures write screenshots and compact reports beneath their own `test-results`
directories. Native template import/creation remains covered separately by the
existing player-library native delivery evidence.
