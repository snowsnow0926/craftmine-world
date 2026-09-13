# Published world templates

The existing PI desktop world picker uses `world.createOptions` and `world.create`.
There is no second world store, profile restore route, or renderer filesystem API.
Four `creation-sandbox` starters are published: `promo-mainline`, `promo-flight`,
`promo-rain`, and `promo-city`. Each starter carries `kind: example`, a label,
description, a bounded PNG data URL, pinned source ID/version/hash, and
`initialState: authored-defaults`. The factory reads this metadata once. The
renderer never receives publisher paths. Preview data is limited to 2 MiB per PNG.

The publisher restores approved archives only in private staging and asks the
native `godotRuntime.exportSource` and `content.readFile` APIs for the exact formal
source closure. SQLite is never accessed by JavaScript. The shipped package
contains only source files, approved preview, provenance and captured initial
state, never a database, account, chat transcript, task journal, or saved player
victory/exploration progress. Existing source-local creation receipts, where
present, remain source provenance rather than user conversations.

Initial state comes from executing the authored scene and loading its managed
runtime without a supplied snapshot. Capture uses the pinned engine, a private
headless profile and no external input. Mainline starts with zero wins/attempts;
flight with no flight or landing history; rain with zero casts; city with empty
exploration inventory. This is the authored starting scene, not a fabricated
reset of a played save. The publication records a pre-existing rain-only
supplementary headless probe failure; capturing state does not attest gameplay.

Materialization verifies every source file size/hash and blocks links, unsafe
paths, case aliases, oversized input and reused output directories before writes.
It transforms the declared `project.godot` runtime world identity and source-local
creation receipt world bindings. Object/component IDs remain world-local, exactly
as native world copy; the new world and host runtime instance provide independent
identity. It never replaces arbitrary identifiers inside gameplay scripts.
Authored behavior and binary models retain their original bytes.

The existing factory operation ID creates a distinct world ID and owner receipt;
normal Rust initialization registers its starting state. The ordinary initializer
installs source in serialized batches below the existing Core 8 MiB request limit,
then checks and performs first load before reporting ready. Cancellation, retries,
save, reopen and failure presentation retain their existing contracts. A partly
installed source is never a playable success. No model connection is required.

Validation: `tests/world-templates.test.mjs` checks source immutability, starting
state, corruption rejection and request boundaries. `tests/world-templates-native.mjs`
uses a fresh native domain to register all four worlds, install complete sources,
verify every source hash and reopen the same four-world index. Native storage
validation is separate from actual rendered first-load/gameplay acceptance.
