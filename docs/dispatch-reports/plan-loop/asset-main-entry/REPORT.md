# AL2 Main asset entry and finite client acceptance support

The earlier AL2 eight-step React-to-Core test did not prove the Main route. Main navigation rejected asset.annotate; asset reads fell through PluginRuntime to an unsupported plugin panel method. The existing panel gateway list also forwarded asset reads to a workbench service without asset handlers. This patch connects five explicit reads and one metadata write through the private asset service.

## Implemented boundary

- Navigation keeps annotate separate from READ_CHANNELS. PluginRuntime uses an exact channel set, not a generic asset prefix. Panel requests reject unknown fields and strip ownerWorldId before the private service. No scan/import/preview writes or filesystem grants are added.
- The React panel binds its bridge to the displayed world; world changes remount the controller. The host checks its selected world and viewed session before dispatch and after the result. A changed owner means an unconfirmed response, not reversal of an already durable write. The same original transaction can be retried.
- Writes accept only operationId, assetId, optional tags/favorite. Receipts expose only those identities and browsing metadata, never notes, paths or content.
- Real navigation/card/annotation/filter/close forms support normal submit behavior. The headless-only assetsView helper permits fixed actions and observed card identities; no selector, script, RPC or filesystem input is accepted. No React internals or simulated click/input events are needed.

## Executed evidence

- 35/35 Node tests: 18 existing R6, 12 annotation/controller, 5 new Main-route/probe/runner-mode checks. The Main-route case executes navigation-host -> panel-gateway -> actual createHostRequests -> asset-service -> existing compatible packaged Core. It proves actual metadata persistence, identical retry, operation conflict, and unchanged body/license/hash/version/world list. It is not an Electron IPC run.
- 10/10 actual CraftmineNavigation/React form checks in an independent headless browser, fixed transport fixture. Focus and pointer lock counts are zero. This proves DOM/form/helper behavior separately from the real Main/Core case.
- Strict scoped TypeScript checking passes for Main gateway/helper/navigation plus asset panel/editor/controller. The actual navigation components also bundled and executed in the DOM case. The full desktop typecheck and Electron run remain the integrator's checks.
- Native runner is prepared and syntax-checked, not executed here. It requires explicit development or packaged mode; package launches revalidate inspectParameterPackage, expected source commit and independent build-manifest hash. The same selected Core seeds two local PNG assets, then actual UI/Main forms perform edits and a restart. Eight checks include two strict shutdown audits and immutable readback. No installed/old package is relabelled as this new code.

## Preserved failures and limitations

The first new DOM run at test-results/asset-forms-bKGqiy/report.json failed because its expected tag display order did not use the production canonical sorted order; the corrected expectation passes at test-results/asset-forms-WKqci5/report.json. Both original directories remain. An initial controlled Main fixture lacked core.start; the actual Core case passed independently, and adding only that fixture lifecycle stub made the owner negative case executable. No native acceptance was run or claimed.

Import/decoding, multi-window behavior and durable retry journals across closing the panel are outside this slice. Tags/favorites do not make AL2 complete. No model or credential access, Rust compilation, Electron/Godot execution, dependency installation or deletion occurred.

## Commands

Set ASSET_TEST_DEPS to the integrator's existing desktop dependency directory and ASSET_TEST_CORE to its compatible existing Core executable.

~~~powershell
node --test tests/plan-loop/asset-main-route.test.mjs tests/plan-loop/asset-annotation-controller.test.mjs tests/godot-round2/R6/asset-library.test.mjs
node tests/plan-loop/asset-forms-headless.mjs
node tests/plan-loop/asset-client-native.mjs --mode development --source-root C:/COMMITTED-INTEGRATION --deps-app C:/DEPENDENCIES/vendor/pi-desktop/apps/desktop --output-parent C:/OWNED/test-results
node tests/plan-loop/asset-client-native.mjs --mode packaged --source-root C:/FROZEN-SOURCE --deps-app C:/DEPENDENCIES/vendor/pi-desktop/apps/desktop --output-parent C:/OWNED/test-results --packaged-root C:/NEW-PACKAGE/win-unpacked --expected-commit FULL_COMMIT --expected-build-manifest-sha256 INDEPENDENT_SHA256
~~~

The native commands are preparation instructions, not evidence of a completed run.
