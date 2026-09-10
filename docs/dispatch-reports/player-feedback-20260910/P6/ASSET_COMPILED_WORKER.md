# Compiled PNG worker entry repair

The `beb66d76c00a102c755ec7aeaed59b19cf5c68a9` exploratory packaged run
successfully imported the generated PNG through the authorized Main route using
explicit fixture provenance. Actual preview then failed. Core's durable
`asset.previewRead` recorded: `The requested module 'electron' does not provide
an export named 'BrowserWindow'`. Evidence remains in
`D:/cm-fb2-20260910/test-results/desktop-native-assets-oiH6iC/report.json` and
`preview-diagnostic.json`. This run did not pass asset UI acceptance.

`preview-worker.mjs` had spawned its own `import.meta.url`, which becomes Main's
`index.js` after bundling. The fix gives Rollup a fixed decoder-only
`asset-preview-worker.js` entry and has the runner spawn that sibling. The
worker receives only its existing preview request, posts one result, closes its
port and exits. The runner returns normal evidence only after a zero worker
exit. Timeout, cancellation and failed-exit behavior remain bounded; no dynamic
worker path, Electron import, project source execution or input API is added.

Validation: actual Rollup compilation plus real worker threads passed five
assertions (separate dependency graph, real 1x1 PNG decode with exit zero,
compiled caller/result identity, timeout, live cancellation). The archived
report identifies emitted bytes and modules. Four existing worker/cancellation
regressions also passed. These are compiled Node-worker checks, not a substitute
for a rebuilt Electron ASAR/package run. Root must build and rerun the original
asset UI driver; the previous packaged failures are retained unchanged.
