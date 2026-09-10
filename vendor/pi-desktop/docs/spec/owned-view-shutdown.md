# Owned browser and plugin renderer shutdown

BrowserPane and PluginViewHost final disposal is an idempotent Promise barrier.
The owner rejects new views immediately, registers destroyed before requesting
close, and keeps both the WebContentsView and its original WebContents alive
until actual destruction. Electron may clear view.webContents during close;
a saved handle, rather than that mutable property, identifies the retired view.
A three-second timeout or close exception remains a named failure. It never
constitutes destruction. A later destroyed event releases retained references
without rewriting the earlier failed result. One failed view cannot skip others.

Plugin eviction and closePlugin use the same retirement accounting. Pending
close preparation is bound to the original entry and cannot close a replacement.
BrowserHost.disposeGuest instead awaits BrowserPane.closeGuest: guest unload
retires the current renderer and resets guest state while leaving the application
pane reusable. Final dispose permanently closes admission. A pending navigation
cannot return success for a disposed or replaced guest. Every Main caller observes
the guest-close Promise; asynchronous plugin lifecycle callbacks log rejection.

After the existing world-save quit gate succeeds, preview, game-export and
running-turn settlement failures are recorded independently. Settlement ordering
is preserved. Every remaining owner is invoked through a separate Promise and
allSettled, so synchronous throws cannot skip other services. Main records all
rejected owner barriers before releasing quit. This reports incomplete shutdown;
it does not promise that Chromium can always be forced to close safely.

Validation: actual owner classes and Main shutdown fragment under controlled
lifecycle faults, plus actual Electron offscreen detached WebContentsViews using
owned test data. The latter creates no BrowserWindow, denies permissions, blocks
Pointer Lock in main-world preload, and performs no input, external navigation,
model request or personal-profile access. These tests establish a lifecycle
contract fix; they do not identify the cause of the historical IOCP crash.
