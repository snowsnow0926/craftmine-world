# Player workflow implementation

Date: 2026-09-13. This request continues the approved promotion branch at `79ae8ba3` in a dedicated `codex/player-workflow-20260913` worktree. The main checkout, approved archive and sealed Windows delivery are preserved, following the user's isolation requirement.

## Product surface

The existing PI Desktop world chooser contains My worlds, Examples, My templates and New world. The original sidebar, projects, sessions, WorkPanel, Composer, themes and settings remain the shell. My worlds uses the native world list; examples come from delivered creation-sandbox starter metadata, bounded inline PNG previews and source version identities. New worlds use the existing base/starter/title flow, including Godot and Web bases reported by the host.

Choosing an existing world uses save-before-switch and the conversation ownership fence from the prior player slots. Capture the navigation/draft identity before waiting for a switch or build. A changed conversation or draft prevents late presentation handoff and never rebinds the old session. New copies use independent sessions and retain the operation identity for uncertain create receipts. Model connection is not required to open prepared worlds.

The sidebar displays the active world title and exposes the existing AssetLibraryPanel directly. Detail actions append a fixed-version asset reference to the existing Composer without sending a prompt, replacing typed text or dropping attachments. Requests carry their world and session ownership. The model reads actual capability and compatibility metadata before proposing reuse.

Source installation proposals appear within the same conversation. The player initiates the existing native install operation and follows real check status into the existing preview/application surface. Installed source is never described as applied gameplay. Durable proposal receipts restore the same job after remount. No arbitrary Core RPC or filesystem access is added.

## Validation boundaries

Use isolated headless profiles with pointer lock and focus disabled. Page scripts submit ordinary forms; do not drive operating-system input. Fixtures prove renderer behavior and races, native probes prove source/initialization and persistence, and live Codex runs prove actual model behavior separately. Keep time and usage evidence distinct. Do not add model, token or whole-turn evaluation budgets.

The first candidate delivered four examples in one client, Codex connection in Settings General, and the approved Pomeranian library flow. The subsequent isolated player-library delivery adds self-service component/world-template publication, drivable flight, controlled rain, city fragments, native fluency/cancellation and matched real-model reuse measurements. Portable single-world ZIP sharing is verified across independent profiles; a remote community distribution service remains outside this local delivery.

### Navigation and draft recovery

Creating a world never adopts an unrelated pre-existing home draft. Normal home draft materialization carries a pending asset reference into the created session while retaining its world identity. Pending references remain explicitly discardable if target sampling fails. Leaving a creation form during asynchronous preflight fences the continuation before native registration; chooser navigation is disabled during that preflight.

The Composer's missing-CLI hint opens the existing General settings card and scrolls to its connection controls without focusing a test window. Account/model verification is a catalog capability check, not an inference charge. Native binary reuse for this candidate is from the sealed parent: the request changes no Rust or broker source. The previous development-only progress-migration provenance pin was stale; actual bytes match clean Git and the approved parent, so its inventory now records that same source hash.

Example cards use only published, base-scoped authored-default templates; the legacy global starter fallback is not duplicated across Godot/Web bases. Existing training samples remain in their original new-world starter lists. The world chat's existing onboarding checklist links directly to creation AI settings; it does not require an API key or a coding project for a Codex world. An empty new conversation can stage a library reference using the same native creation-target ownership check as its first normal wish.

Integrated verification includes actual PI renderer form submission, real template initialization, native library selection and Composer prefill, plus controlled native Codex account/model verification with zero inference calls. Four-world native save/reopen evidence is in the repository's player-world-template evidence; charged model reuse evidence is retained separately in the isolated live run.

Creation options retain each engine's own starter list, including Web's blank starter. Large template previews are sent only in the base-scoped catalog, avoiding a duplicate copy in the legacy fallback list.

### Demo entry and imported templates (2026-09-15)

Examples retain their existing one-action copy-and-play flow. A single import
shortcut opens My templates, where the normal ZIP import remains explicit.
Concise help locates the demo package's `examples` folder and distinguishes
importing an archive from creating its independent world with saved progress.
No filesystem path, built-in starter, model call or automatic import is invented.
The first creation guide names the actual chooser tabs.

A successful import selects its validated immutable reference, clears the search
and reloads the first host list page. Pagination uses the last completed search,
not unsent search-box edits. Empty search results are distinct from an empty
library. Unmounted chooser callbacks cannot update the next chooser or create a
world. Import success never itself calls world creation.

Template form state belongs to one bridge connection generation. Replacing the
bridge inside the same chooser remounts only that internal form, discarding its
selection, search and pending UI locks. Returning to a prior bridge creates
another generation. Old success/error/finally continuations cannot update the
new connection or unlock its import, and cannot issue a stale follow-up list.
Ordinary busy/locked changes on the same bridge retain the form and retry state.

`locked` means the chooser retains a create attempt, including uncertain or
failed preparation; `busy` separately denotes ongoing work. A locked template
cannot change identity or start a new creation. Only an explicit parent retry
callback can retry, and the chooser supplies the original create-attempt input
and operation identity. The button says Retry preparation and enter rather than
claiming to create a new world. These changes do not alter native import checks,
saved-progress ownership or the normal creation fence.
