# Embedded Craftmine world fullscreen shortcuts

PluginViewHost exposes a Main-owned onWorldFullscreenShortcut callback accepting
only toggle or exit. Main must bind it to the owning BrowserWindow. It does not
change or close the world. Only craftmine.world/world receives a fresh private
scope argument; other plugin views and standalone panels receive none.

F11 uses the shared native policy. Escape uses the shared trusted-event preload
helper and a fixed private exit channel, without adding a pluginBridge method.
The host requires the exact current view, attached owning window, positive
dimensions, exact scope payload and main frame. Hidden, replaced and unrelated
views cannot act. Pagehide disposes the Escape listener. Consumed Escape,
native editing controls, IME and pointer capture remain reserved by the helper.

Controlled tests exercise actual host creation/visibility methods and the real
preload bootstrap. They send no OS input and make no claim about a live canvas
leaving Escape unconsumed. Main callback wiring is a separate integration step.
