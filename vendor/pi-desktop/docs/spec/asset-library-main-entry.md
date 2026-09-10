# Main asset metadata entry

The Main navigation asset sheet reads through five explicitly named methods: asset.search, asset.read, asset.versions, asset.usage and asset.previewRead. The only newly reachable write is asset.annotate. It accepts a bounded operationId and assetId and tags and/or favorite. Notes, display names, paths, imports, preview execution and arbitrary asset methods are excluded.

ownerWorldId is a presentation precondition distinct from the optional search worldId filter. The panel binds it to the displayed world and creates a fresh controller on a world change. Main derives its viewed session itself and verifies both world selection and session before private dispatch and before returning a receipt. A selection-free global library requires a null selected world. If ownership changes after dispatch, saving remains unconfirmed to that caller; the host must not claim it cancelled a transaction that may already be durable. Same-ID retries remain core-owned and payload-exact.

The receipt contains only operationId, assetId and browsing tags/favorite. Immutable content, source licensing, version and world state remain untouched.

A finite assetsView probe exists only in the validated private headless controller. It uses semantic forms already used by the actual React UI. Actions are open, read, select, favorite, saveTags, filter and close. Selection is confined to currently observed cards, metadata writes to the actual selected annotation form, and every action validates the observed owner world. No arbitrary DOM selector, evaluation source, RPC, path or real input is accepted. Forms are submitted with requestSubmit; native form values are read on submit without React private state.

Validation separates an actual Main-functions-to-Core case from a real React DOM case with a fixture transport. Full desktop IPC and restart acceptance requires running asset-client-native.mjs on a matching clean development build or an independently hash-verified package. Preparation of that runner alone does not establish product acceptance.
