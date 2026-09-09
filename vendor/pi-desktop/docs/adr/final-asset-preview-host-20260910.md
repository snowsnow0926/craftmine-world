# ADR: Resolve preview bytes in the Electron host

Date: 2026-09-10

The existing plugin file-preview API returns a classified display object, not bytes. Serializing AbortSignal across a plugin process also cannot cancel a worker. Use managed asset identities resolved in the main process and explicit job cancellation. Keep the Rust claim as the persistent authority and use a single in-flight promise in each service. Rendering workers remain isolated from plugin/UI paths.

Consequences: private broker and index construction must consume preview and cancel together; tests that directly inject bytes prove only service behavior. A renderer receives preview evidence, never the core blob path.
