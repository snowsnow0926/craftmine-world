# Local issue acceptance

Both scripts use only newly created ignored test directories and keep reports.
Neither calls a model or sends user data externally.

## Service

Set `CRAFTMINE_DEPS_ROOT` to an existing package directory that resolves esbuild,
normally `vendor/pi-desktop/packages/agent-runtime`, then run:

```text
node tests/local-issues/service.mjs
```

This runs the real filesystem service, including separate Node process exits
before/after atomic rename, corruption/link refusal, capacity, concurrency and
storage faults. It does not start Electron or a browser.

## Full workbench DOM and real service over loopback HTTP

```text
node tests/local-issues/workbench-headless.mjs --ui-ref 5a331a0
```

`--ui-ref` defaults to `HEAD`. The script reads the selected Git commit's actual
`workbench-ui.mjs` and its module dependencies into an isolated source snapshot,
records their hashes and bundles them without editing that commit or checkout.
It bundles the current tree's real issue service separately. The fixture
mounts **createWorkbench**, opens its backup page and routes issue requests over
loopback HTTP to the persistent service. Other workbench capabilities and the
formal host identity are fixed fixtures. No runtime, core or Electron host is
substituted into a claim of native validation.

Playwright must be available through the existing browser-tools dependency
resolver (`PLAYWRIGHT_MODULE_PATH` can point to an installed copy). The browser
uses a new independent headless profile. Forms are submitted with page scripts;
no mouse/keyboard/click/fill simulation is used. Focus and Pointer Lock are
forbidden from initialization. Non-loopback requests are blocked and recorded.

Acceptance covers:

- Notebook mounts inside the production backup/diagnostics workbench page.
- A real durable create whose HTTP response is lost retries one operation ID.
- Markup remains inert; the exact submitted textarea value survives UI/detail
  reads, a new service factory, and browser page reload.
- Detail/read/delete and cancel/confirm use the actual ledger.
- World changes isolate records and clear old input.
- Held old-world read, create and list responses cannot overwrite or strand the
  current world. Closing the page cancels deferred redraw. An old mutation's
  completion cannot unlock another pending current-world action.
- No world save, model route, external request, trusted input, focus or Pointer
  Lock occurs. This does not prove a real game's progress because no game runs.

The platform textarea normalizes CRLF to LF; the test compares persistence to
the exact HTTP-submitted value, including all edge whitespace. The service-only
test separately verifies original CRLF preservation without a textarea.

## Regression evidence

With UI commit `de0dffe472b4f72bb9cd88e5438d99a5e7314b6d`, the first five stages
passed, but holding an old-world detail request across `setWorld()` left the new
notebook empty. `setWorld()` cleared the child while workbench `pending` caused
the new `show()` action to return without scheduling a repaint.

Root's UI fix `5a331a02afbb7c959864ee0bbef576820815a782` defers the current-page
redraw until the old action settles. All eleven stages passed against that
commit, including close and busy-ownership cases. The failure is retained
separately from success in `docs/dispatch-reports/plan-issues-20260910`.

These are `workbench-http-service-fixture` reports with `native:false`. They do
not replace the parent task's complete native client or packaged-app evidence.
