# Empty world conversation continuity

The original New World/copy flow creates a real PI session with zero messages
and calls `world.conversation` with exactly
`{action: "remember-created", worldId, sessionId}`. This route is main-frame
only. Main validates the selected world before/after the session list read,
real empty session, inactive turn, enabled plugin and current project. A
current-project comparison resolves both paths to their existing native
canonical directory: Windows slash/case spelling differences are equivalent,
while missing paths and different directories are rejected. The session's
established Rust project hash is unchanged.

A
host-created-session observation from that same world/project is required for
first registration. Profile locators are atomic immutable tuples containing
only `worldId`, `sessionId`, and `projectId`. Retrying the same tuple is allowed;
changing world/project or registering an arbitrary old empty row is rejected.

The existing read form `{worldId, sessionId?}` remains compatible. It first
uses actual task binding. For a navigation-matched candidate without a matching
task it performs the existing host-only `maintenance.context` read. Only null
allows a taskless response `{worldId, sessionId}`; no fake `taskId` is returned.
The normal source/editor/Agent access paths do not consume this locator as
authority. After a real task exists, its binding decides recovery.

Opening a world from untouched home can restore its verified conversation in
Play or Create. Create requires an open active world panel; only that panel is
carried into the selected session. Recovery never creates a session, sends a
prompt, consumes home draft/files, switches an existing selected session,
overrides new navigation, or restores an archived/removed session. It continues
to revalidate binding after session detail and workspace alignment.

For an older world with no verified conversation, the existing sidebar offers
an explicit Start creating form while no session is selected. It creates a new
empty conversation in the ordinary current project, registers navigation, and
enters Create after checking selection again. Existing unrelated home drafts
remain in home. This action works without model configuration. It is separate
from expanding or following the first-creation guide.

Verification: `tests/empty-world-conversation-navigation.mjs` covers durable
host locators and task precedence; `tests/fb03-world-conversation-recovery-headless.mjs`
covers the actual hook/store and late navigation guards, including empty Create
recovery; `tests/player-workflow-ui.mjs` covers actual Start creating and retained
home content. These fixtures do not claim native or external-player acceptance.
