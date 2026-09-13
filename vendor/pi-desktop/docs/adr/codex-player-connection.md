# Player-owned Codex connection in existing Settings

Date: 2026-09-13. Status: implemented, fixture validated.

The existing World authoring backend row accepted only an executable path. Add
connection controls to that same row, preserving PI desktop navigation and the
normal Composer. Electron main owns a separate restricted app-server instance
for connection operations. The renderer receives a narrow typed status through
the allowlisted `pi-desktop/settings/codexConnection` preload channel; it cannot
send arbitrary app-server methods, credentials, process arguments or URLs.

The CLI remains separately installed and must report exactly
`codex-cli 0.154.0-alpha.6.2`. Detection examines PATH for native executables;
the file picker handles installations outside PATH. No installer, updater, shell
wrapper, logout action or credential import is introduced. Standard installation
documentation does not guarantee availability of this experimental pinned build.

Verification reads the actual local account and paginated model catalog. It
requires ChatGPT authentication, `gpt-6-astra` and advertised `xhigh` support.
This is a capability check, not a charged inference or a guarantee of remaining
quota. The author runtime still validates the effective model and effort and
reports request-time account failures; no fallback is allowed.

Login uses `account/login/start` only after the player's action. A separate
button opens the returned HTTPS URL after the native service validates its
official host. Matching completion triggers a fresh account/catalog check.
Cancellation closes the owned process, sends cancellation for the owned login
and fences late completions. It never logs out an existing account. Login uses
Codex's own credential store; the application does not read, copy or expose it.
Raw diagnostics, auth URLs and token material do not enter renderer status.

Official protocol reference, read on 2026-09-13:
[Codex App Server](https://learn.chatgpt.com/docs/app-server), account and models
sections. The additive `requireAccount: false` transport startup option is
host-only; normal author startup still requires a ChatGPT account.
