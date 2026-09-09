# Managed asset preview host

The plugin service selects a fixed asset version and file before claiming a preview. Its settings identity includes the selected file hash and effective rendering settings. One service promise owns each live request; retries receive a new core attempt. All read/decode failures after claiming settle that attempt.

Production preview requests contain only jobId, assetId, version, path, settingsHash, engineVersion, attempt and claimId. The Electron host resolves asset.bodyPath through a private core call, refuses links, bounds reads to 64 MiB, verifies bytes and SHA-256, and passes those bytes to its worker. Plugin fs.readPreview is not a byte reader. Cross-process cancellation is an explicit jobId message, never an AbortSignal object. The host deduplicates jobs and retains bounded cancellation tombstones for cancellation before execution.

The host is constructed by main/index.ts; private routes are owned by the plugin broker. This change supplies and tests the service implementation. Full product routing and actual decoder packaging are verified by the root integration task, separately from injected worker tests.

Acceptance: concurrent requests invoke one runner; cancellation rejects late results; A/B files of one asset never share a cache result; a failed attempt can retry; host byte/hash mismatch and user-supplied OS path are refused. No input or visible application is used.
