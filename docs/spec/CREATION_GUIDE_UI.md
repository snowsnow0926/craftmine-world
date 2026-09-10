# Optional creation workflow guide

This PP1 slice explains existing actions. It does not execute a tutorial, track verified milestones, or establish completion of the full PP1 plan.

## Integration contract

`createCreationGuideUI({element, navigate?})` returns `show()`, `clear()` and `dispose()`.

- `show()` mounts one native, initially collapsed `details`. Repeated calls preserve the current expansion state.
- `clear()` removes its content and navigation listeners. The next `show()` starts collapsed. Call this on world or view changes to invalidate pending navigation results.
- `dispose()` clears the component permanently.
- Optional `navigate(tab)` receives only the literal `checks` or `library`, with no world identifiers, source, prompts, paths or state. It may return a promise. The integration must use existing guarded navigation, including its busy/preview restrictions. Without it, the component displays no navigation controls.
- Only navigation submission calls the callback. Opening, collapsing, mounting and clearing never invoke it. While pending, both navigation controls are disabled. Failures show a generic retryable notice; results from an obsolete mount are ignored.

Place the guide inside the workbench/library surface. Do not expand the fixed world header: the separate Godot WebContentsView uses the existing 76-pixel chrome boundary. This standalone change does not alter any host wiring or layout.

## Player-facing boundaries

The six steps cover creating/opening a world, editing a draft, checking, previewing a separate copy, applying to the world, and saving/reopening the formal world. The text explicitly distinguishes a passed check from adopting changes and preview play from formal progress. It makes no promise that a particular template, parameter tool or model is available. Existing UI labels include `作品库`, `检查记录`, `预览副本` and `应用到世界`.

The guide is optional, contains no completion ticks, stores no preference or gameplay state, sends no model prompt and calls no write API. It can be skipped by leaving it collapsed and reopened through the native summary.

## Verification

Run `node tests/player-product/creation-guide-headless.mjs`.

The test loads the actual module in an isolated headless browser profile through a data URL. It blocks network requests and guards focus, Pointer Lock, fetch and storage writes. Native details are changed through DOM properties; navigation uses `requestSubmit()`, never mouse or keyboard simulation. It checks truthful six-step text, idempotent mounting, optional navigation, fixed destinations, retryable failure, duplicate suppression, detached listener cleanup and stale promise rejection after remount. It writes a screenshot and raw report to an independent temporary directory printed on success.

This verifies the module only. Host navigation integration and actual player onboarding remain separate acceptance work.

The 2026-09-10 local run passed all five grouped checks, with zero intercepted network requests and zero guarded focus, Pointer Lock, fetch or storage calls. Raw output and the inspected screenshot are at `C:/Users/WINDOWS/AppData/Local/Temp/craftmine-creation-guide-Cyw2Ua/report.json` and `guide.png` in the same directory. These temporary artifacts are not committed.
