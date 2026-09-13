# Codex player connection

The General settings card retains `WorldAgentBackendRow`, with a stable
`world-agent-backend` anchor. The provider backend remains the default. Selecting
Codex exposes detection, executable selection, official installation guidance,
verification, explicit login/browser opening, cancellation, account and model
status. Saving Codex in this UI requires successful verification of the current
path. Editing the path invalidates that result. Leaving settings cancels its
connection work. Existing worlds remain playable without connection.

The IPC accepts only `{ action, path? }`, where action is `detect`, `pick`,
`verify`, `login`, `status`, `cancel`, `openLogin` or `instructions`. Native main
validates the input and refuses connection changes during active author turns.
The existing preload whitelist supplies the boundary. There is no renderer
access to account RPC or general shell execution. A login URL is opened only
from the service's current pending login, never from renderer input.

Results carry a status code, executable path, safe version string, pinned model
and effort, and optional account type/email/plan. The account object is rebuilt
from these fields rather than forwarding RPC payloads. The UI distinguishes
missing executable, incompatible version, missing login, unsupported auth mode,
missing model, unsupported effort, custom endpoint and connection/login failure.

Cancellation invalidates outstanding verification, login and model-list results.
No AI turn, inference limit or authoring budget is created by a connection test.
A 15-second executable-version timeout and output limit protect a local
diagnostic process; these do not affect ordinary model authoring. The app-server
uses its existing restricted host configuration and rejects incoming tool or
credential requests. Quit drains the owned connection subprocess.

English and Simplified Chinese connection copy is provided; the remaining
shipped locales intentionally use the English connection block pending localized
translation. Existing translations are unchanged.

See [the decision](../adr/codex-player-connection.md) and
[verification scenarios](../e2e/codex-player-connection-20260913.md).

The guided discovery/recovery extension is specified in
[Player setup and recovery](player-setup-recovery.md). It retains these exact
authentication and model requirements.
