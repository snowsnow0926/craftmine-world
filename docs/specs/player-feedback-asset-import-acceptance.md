# Player asset import and preview acceptance

The Main asset library uses the retained world view's native directory picker. Its `{path, name}` result is normalized to `{sourceRoot: string}`. A directory pick has no selected file; an empty `sourcePath` is resolved from the selected scan item. Explicit file paths remain unchanged.

The world plugin declares only `fs.read` with `root: userSelected`. The generated plugin copies this manifest unchanged. No write permission or arbitrary filesystem RPC is added.

Main supplies `authorizeAssetSource(sourceRoot, sourcePath?)` to the panel gateway. The runtime requires the current world plugin, its read permission, a current user-selected grant, and an exact root match. It uses the existing real-path, protected-path and credential-path checks. A metadata-only preflight rejects linked or nonordinary entries, hard-linked files, protected descendants, more than 1024 entries including the root, or depth greater than 16. The player must select a smaller dedicated asset directory after a limit error. Core retains its own ordinary-file and import validation; this host check is not a filesystem transaction.

`asset.scan` and `asset.import` verify the grant and selected world/session before dispatch and again before returning. A durable import whose response becomes stale is not shown as a current receipt. Replaying its operation requires the current grant again. `asset.preview` and `asset.cancel` accept managed asset identity only. Import maps to the existing `asset.request/importAsset` service. Preview and import do not write world content or progress.

The finite private acceptance helper submits actual import and preview forms. It accepts no picker path. Preview must match both the currently selected asset and its visible version. This helper is only reachable through the existing isolated headless acceptance controller.

Validation layers remain separate: controller tests use finite transports; DOM tests use the real React components with fixture receipts; actual client tests must use a newly frozen compiled source identity and the real core/preview worker. A successful PNG catalog preview is not evidence of use inside a world. That requires a separate creation-package installation, check, candidate adoption, save and restart using the existing product flow.
