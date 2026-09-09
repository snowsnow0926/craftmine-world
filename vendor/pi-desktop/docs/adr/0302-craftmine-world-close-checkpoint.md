# ADR 0302: Acknowledge world progress before intentional shutdown

- Status: Accepted for the downstream Craftmine distribution
- Date: 2026-09-09

A ten-second autosave cannot protect progress created immediately before closing a window. The original PI shutdown closes the view and stops its plugin service without requesting a final world snapshot. Pre-authorizing the native window to close also lets a second close bypass an unsuccessful save.

Electron now awaits a product-specific lifecycle method on the trusted world panel before shutting down backends. The panel serializes existing operations, freezes the game, flushes gameplay events and saves through the same revision-checked Rust method as normal progress. It acknowledges world ID, revision and build ID only after that write. Even an unchanged snapshot is checked against Rust during close. Authored code remains inside the opaque iframe and cannot access the lifecycle or plugin bridge.

Failure keeps the application alive and the page available for retry. The host cancels preparation after a bounded deadline and resumes the view without waiting indefinitely for its renderer. The panel keeps an unfinished write serialized even after cancellation. World-tab close and explicit plugin disable/uninstall use the same barrier. The world is retained when unrelated plugin views reach the cache limit; ordinary plugin views retain their existing eviction policy.

Abrupt process failure, plugin development reload and OS termination are not clean-close guarantees. Durable task recovery and candidate transactions require their own W2/W3 work. Native Electron validation is tracked separately from the headless browser-to-plugin-to-Rust integration probe.
