# Player setup and recovery

The existing General settings world backend row presents three stages: install
and discover, verify/sign in, then verify model access and save. The official
installation guide opens only after a player action. No shell command or browser
is automatically launched during discovery. Existing worlds remain playable.

Discovery probes bounded native candidates from PATH, the current user's Codex
Desktop installation, and known npm package locations. It reports every examined
safe version and incompatibility, choosing the first exact compatible binary
without persisting it. An incompatible early PATH entry cannot mask a compatible
later installation. Players can choose another compatible candidate, which
invalidates account verification. Account/model verification is still required
before saving; the required CLI, gpt-6-astra and xhigh are unchanged.

The current adapter requires `codex-cli 0.154.0-alpha.6.2`. The official general
installer is not evidence that this exact build is publicly downloadable or
redistributable. The UI states this gap and offers provider-backend/existing-world
use while waiting for a compatible update. There is no managed installer or
silent adapter/version/model substitution. Detection of an existing Desktop
runtime does not claim that every public Desktop distribution contains it.

Official source checked 2026-09-14:
[Codex CLI installation and login](https://learn.chatgpt.com/docs/codex/cli).
The page exposes Windows/npm installation routes and account sign-in, but no
verified redistribution pin for this adapter's exact development build.
