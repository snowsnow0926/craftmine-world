# Immersive host integration

The renderer sends `{ active, overlay, overlayBounds, blocked? }` through the
allowlisted `pi-desktop/craftmine/setImmersion` channel. Only the exact main
WebContents main frame is accepted. Booleans, enum values and finite nonnegative
viewport bounds are validated before applying native geometry. The response
uses the standard `Result` envelope. Main emits only `compact`, `full` or
`escape` on `pi-desktop/craftmine/immersionShortcut`.

Native rectangles exclude the measured renderer pane, including visible picker
overflow and the narrow full layout. Requested plugin bounds are retained so
closing creation restores them exactly. Blocking dialogs reserve all native
content. Main never trusts a renderer-supplied world ID because the message
contains none: operations stay attached to the current host runtime.

Overlay input ownership is `active && (blocked || overlay !== closed)`.
It pauses each live Godot instance through the acknowledgement controller while
preserving manual/checkpoint pause. Rapid layout transitions settle to the latest
intent. Stale, disposed or failed-to-start instances are detached. A transport
failure is visible as a host error and does not claim successful gameplay pause.
Failed saves and replacements never override a later manual pause.

The game preload suppresses press/motion events and releases Pointer Lock if
already present; release events are left available to clear held input. Plugin
chrome stays interactive; only its embedded game frames are made inert with
pointer events disabled. The legacy runner has a separate `immersion` message
under its existing parent/origin/channel/nonce check. That hold stops simulation,
prevents enter/revive/interact, and cannot clear a snapshot/save freeze.

Microphone permission is restricted to explicit, short-lived audio requests
from the trusted main frame. Blur, navigation, destruction and cancellation
clear the grant and owned voice jobs. Permission checks deny standing media
access; the request handler consumes one grant. Existing trusted-main sanitized
clipboard writes remain supported. Audio and transcripts are not application
logs, persisted files or external uploads.

Targeted validation uses pure policy tests, actual host classes with deterministic
transport fault injection, actual legacy message handlers with inert fixtures,
and a separate headless React layout fixture. None establish a full installed
client/player acceptance claim. Manual held-movement and live speech checks
remain player acceptance items, not fabricated automated coverage.
