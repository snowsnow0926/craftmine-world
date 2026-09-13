# Prepared source-world preview

Opening the PI asset sheet covers the native world view. Capture one trusted formal frame immediately before opening that sheet, retaining at most one 512 KiB PNG derivative in the main process. Publication may use it only while world ID, formal build ID, runtime instance ID and formal artifact manifest hash still match. A runtime progress checkpoint does not invalidate an unchanged source build. Candidate preview, a switched/reloaded world or a changed source never reuse that frame.

The main renderer requests `library.previewPrepare` with exactly `{worldId}`. The host returns readiness and identity only; renderer pixels, paths and image bytes are not accepted. Failed optional capture leaves publication available with an explicit missing preview. Existing capture visibility guards remain intact. The UI calls it before showing the asset sheet and labels the image “Source world view”, without claiming it was taken at save time.

When cancellation is durably confirmed and clears the retained operation, a later rejected original request cannot replace the cancelled state with an error. Unconfirmed cancellation continues retaining the original operation for recovery.

## Acceptance

Run `node --test apps/desktop/test/player-library.test.mjs` from the vendor root: source/instance changes, candidate state, invalid request and cross-world caches fail closed. Run `node tests/player-library-ui.mjs` from the repository root for ordinary React form cancellation and publication checks. Native acceptance uses `tests/player-library-ui-native.mjs`: open the actual sheet, publish the installed approved Pom, observe a loaded thumbnail and find the exact version by its alias. Native results are recorded separately from renderer fixtures.
