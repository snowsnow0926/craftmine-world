# Dispatch C: world workbench and desktop layouts

The existing PI desktop remains the application shell. Project/session navigation, streaming chat and stop controls, settings, resource tabs, native plugin surfaces and themes are not replaced by a separate web application.

The Craftmine plugin adds Library, Memory, Task and Backup tabs beside World and Verification. Every new business method is explicitly advertised by `workbench.capabilities`; unavailable methods show unavailable state or disabled controls. UI code never persists a second authoritative world/library or forwards arbitrary private RPCs.

Library items display exact id/version/hash references, dependencies and actual evidence. Installation returns a draft receipt and still requires verification/review/application. An active model task disables manual installation. Capture selects an actual object/system/behavior and requires host-verified application provenance. Memory displays source and scope; proposed records cannot declare themselves validated, and supersession is checked by the domain.

Task state displays current corrections, saved draft revision, interrupted tasks and persistent request/compaction/token reservations. A stop request is followed by a fresh status read. Resume/discard use host-bound task identity/generation rather than renderer-generated sessions.

Backup UI explicitly covers all worlds and works in the current client profile. A native picker returns an opaque grant and expected hash. The player confirms that profile-wide replacement before restore. Failed/unknown restore retains the operation identity and offers status lookup; no renderer file paths or archive bodies cross the bridge. Credentials display only protected/fallback/unavailable. Returned sanitized diagnostics are exported by the host.

World selection requires the actual game iframe source and nonce, matching current world/build, existing object and increasing selection revision. Late responses cannot reinstate old selection. World switches clear the chip and invalidate old reads. The host independently validates the same authority.

Create/Play are two persisted width presets for the existing PI work panel, not alternate applications. Each remembers its width within the existing 244–720px limits. Changing layout retains active session and existing resource tabs. There is no automatic pointer-lock, focus or window-activation behavior.

## Acceptance scenarios

- Build the actual plugin and run `node tests/dispatch/c/ui-headless.mjs`: fixed versions, escaped user content, draft receipt wording, active-task blocking, selection spoof/stale rejection, scoped memory, explicit recovery/stop, backup replacement scope, failure retention, light/dark and narrow/wide layouts, failed-save world-switch protection.
- Run `node tests/dispatch/c/layout-headless.mjs`: actual React layout component with explicit store fixtures, width bounds/persistence and session/resource retention.
- Run desktop typecheck/build. Root G/F must validate real A/E domain adapters, actual native sessions and final Windows package. Component/bridge fixtures must not be presented as native end-to-end evidence.

All automated browser verification uses an independent headless profile and initializes focus/pointer-lock guards before product scripts. It sends no real mouse or keyboard input.
