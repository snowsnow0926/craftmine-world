# ADR 0305: Accept the real desktop without showing or focusing windows

- Status: Accepted for downstream Craftmine testing
- Date: 2026-09-09

Browser adapters did not cover the native plugin environment, first-run panel state or Electron's ordered shutdown. The user prohibits real input, pointer lock, visible test windows and focus changes. Native acceptance therefore needs a separate execution mode with explicit isolation and fail-closed behavior.

`CRAFTMINE_HEADLESS_TEST=1` requires an absolute run directory named `test-results/desktop-native-*`, a contained profile and legacy fixture, a matching marker/token, and a parent IPC channel. Validation runs before normal profile initialization. A malformed probe logs and exits instead of opening an error dialog or using a personal profile. A preload installs nonreplaceable pointer-lock and window-focus guards before application scripts. The opaque game also receives the same guard before runtime initialization. Main-process input, focus, window display, dialogs, shortcuts, native notifications and external openers are blocked. Main windows and plugin surfaces render offscreen. Tray, launcher prewarming, automatic update checks, dev-server navigation and initial maximization are skipped. The existing sandbox and plugin egress policies remain enabled.

The parent-only controller has a fixed operation list: status and guard inspection, actual desktop IPC, world snapshots, import form submission, authenticated respawn messages, captures, close and quit. It is not exposed to the renderer and accepts neither arbitrary evaluation nor shell commands. Its directory picker returns only the contained fixture path; no native dialog is shown. Main and world captures are separate surfaces, not a fabricated composite screenshot.

The acceptance driver launches the built Electron entry and production utility processes. It imports a format-1 fixture, changes actual game state, holds a real SQLite write lock, attempts a native close, verifies retained state and resumed controls, releases the lock, retries close, and restarts the client against the same profile. At exit it records input violations and unhandled page errors. This covers real native transport, persistence and process lifecycle. Physical double-click, visible-window interaction, installer behavior and model creation remain separate acceptance items.

Native testing also exposed shutdown lifecycle notifications that made the renderer reopen disposed plugin views and request an unavailable host. Once the save barrier succeeds and shutdown starts, Electron stops emitting renderer lifecycle updates and rejects late view creation. A failed save leaves `quitting` false, so normal UI updates and retries remain available.

References: [Electron offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering), [WebContentsView preferences](https://www.electronjs.org/docs/latest/api/web-contents-view), [session preloads](https://www.electronjs.org/docs/latest/api/session#sesregisterpreloadscriptscript).
