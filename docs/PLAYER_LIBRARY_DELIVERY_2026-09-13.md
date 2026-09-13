# Player workflow and reusable library delivery

Maintenance update: the accepted source was subsequently merged and pushed to
`main`. The Windows folder now resides at
`D:/Craftmine Releases/PlayerLibrary-preview21-b8900d63`; old worktrees were
removed after preserving their history. See
[the merge and cleanup record](MAIN_MERGE_AND_SPACE_CLEANUP_2026-09-13.md).

Scope: all six work packages requested on 2026-09-13, developed in
`codex/player-library-20260913` at
`D:/Craftmine Worktrees/player-library-20260913`. The original checkout, accepted
four-world archive and previous sealed Windows build remain separate.

All six work packages have passed their scoped functional acceptance. The final
Windows payload and packaged application checks are recorded alongside each
sealed release, after building from the clean commit containing this report.

## Delivered behavior

| Work package | Result and evidence |
| --- | --- |
| 1. Player fluency | The existing PI chooser opens all four examples as personal worlds. Save, switch, F2 and cold reopening have actual native measurements. Held movement is released when chat takes over. Real Astra/xhigh cancellation preserved the formal world and aborted history. [Fluency](PLAYER_FLUENCY_RESULT_2026-09-13.md), [cancellation](PLAYER_CANCELLATION_RESULT_2026-09-13.md). |
| 2. Player publication and reuse | The original asset sheet saves selected components, aliases, purpose, immutable versions and optional source-view thumbnails. Explicit saved-progress world templates appear in My templates, export/import as one-world ZIPs and create independent worlds. Full native publication, re-publication, installation, rain, cross-profile sharing and cold reopening passed. [Native evidence](evidence/player-library-native-20260913/native.json). |
| 3. Flight | Raw accepted J20 geometry and a separate drivable component are searchable. Real runway boarding, takeoff, gear, camera, collision behavior, airborne save and cold reopening were checked. Landing, taxi and exit have separate native physics coverage. [Flight and city](REUSABLE_FLIGHT_CITY_RESULT_2026-09-13.md). |
| 4. Rain | A reusable weather component provides U suspend/reverse, I ordinary rain and O automatic casting, with persistent state. It preserves the receiving player's controller, camera and source, and refuses conflicting weather/keys. [Contract](../vendor/pi-desktop/docs/spec/reusable-rain-control.md). |
| 5. Buildings and streets | Independent building, gate and street packages include real collision, measured door/route metadata and captured previews. Actual traversal and save/reopen passed. The included sand surface clears the receiving floor by 20 mm; original GLB bytes are preserved. [Flight and city](REUSABLE_FLIGHT_CITY_RESULT_2026-09-13.md). |
| 6. Real reuse comparison | Fresh Astra/xhigh threads created a matched playable courtyard from scratch and from the final library; an existing reference was cloned without inference, with optional Agent review measured separately. All three passed ordinary native traversal, save and cold reopening. [Measured dataset](PLAYER_COURTYARD_REUSE_LIVE_2026-09-13.md). |

The shipped catalog contains 28 entries. The original 22 package identities and
bytes remain unchanged. Six additions distinguish the raw aircraft, drivable
aircraft, rain, house, gate and street. Old installed instances and immutable
versions are not replaced when a new version is published.

The frontend remains PI Desktop: existing sidebar, conversation, Composer,
settings, world view, F2 and original chooser. The asset/history sheets now use
viewport-level portals and opaque theme colors; they cannot be clipped by the
sidebar. No independent frontend shell was introduced.

## Measured time and tokens

For one matched courtyard, including real repair where required:

| Method | Active Agent/tool time | Total tokens | Uncached input / output |
| --- | ---: | ---: | ---: |
| Scratch | 16m12s | 4,445,963 | 165,467 / 25,904 |
| Final component library | 3m04s | 762,268 | 50,816 / 3,484 |
| Reference copy, without Agent review | Zero model calls | 0 | 0 / 0 |

Most measured tokens are cached input. These are one-run observations for a
small courtyard, not a guaranteed speedup, billing estimate or recreation of
the four full promotional worlds. A separate optional reference Agent review
took 3m07s and 1,589,220 tokens. Its historical redundant-check failure remains
in the dataset; the subsequent product fix passed a fresh native regression
without rewriting that model run.

The reference's source-creation stage took 2.19 s and check-to-first-frame took
20.55 s; they exclude helper startup and an orchestration gap. In the four-world
client run, first personal copies took 23–31 s and existing-world switches
11–16 s. The chooser was ready in 3.37 s. Four source/PCK-verified engine samples
reported 60 FPS; this is not physical display latency or a long-session minimum.
Cancellation during actual model streaming acknowledged in 138 ms and reached
durable aborted state in 142 ms. Interrupted-call tokens were unavailable.

## Validation and boundaries

All automatic native clients used independent hidden, non-focusable offscreen
processes and disposable data. Browser validation used page scripts and ordinary
application handlers with Pointer Lock disabled. No real mouse/keyboard, user
browser control, focus emulation, player teleport or model-source replacement
was used. Models remained `gpt-6-astra / xhigh`, with no extra inference, token or
whole-turn test budget. Domain reads/writes stayed behind native Core APIs.

Targeted integrated checks: TypeScript typecheck, desktop production build,
agent runtime bundle, 43 publication/import/catalog tests, 85 city/executor tests
and ten actual React fixture checks passed. One Windows file-symlink fixture
was skipped because that host capability was unavailable; directory-link and
other tamper tests ran. Separate native reports prove gameplay and persistence;
renderer fixtures alone do not establish those results.

The final publication-path fix also passed 15 targeted tests with actual Core,
including ten consecutive managed installation/publication generations. Native
acceptance retained the earlier failed archive/world and published a new archive
through the ordinary PI form. Its approved GLB and paired 81-byte import policy
retained exact hashes; its model path became `r/3/model.glb`. Installation,
preview and adoption into a different world then passed.

The successful first profile opened four worlds after a full process restart,
including the retained diagnostic world's unchanged formal build. The second
empty profile imported only the exported 7,567,907-byte world ZIP: the author's
custom component catalog record was absent before import and after re-publication.
It played rain, republished the companion with exact model/policy bytes,
reexported the same archive SHA-256 and cold reopened. No source profile, account
or model calls were needed. The exported template hash is
`7204918acb0275de541cb2d97fbc1b5d3b433641b9e173cb02dc97cdff7a52d5`.
Some reopened-source publications had no available thumbnail; their UI explicitly
displayed that state. Original author preview decoding and actual rain rendering
were separately verified. Failed probes and driver corrections remain recorded.

The self-service library supports source components with declared independent
identity/dependencies, not arbitrary dynamic world roots. Templates explicitly
retain saved progress, including player position. GLB import policies remain
paired and exact; generated caches are excluded and unsupported image/audio
import sidecars fail explicitly. Native preview absence is displayed honestly.
Captured source-world thumbnails are not isolated object renders or gameplay
certificates. Source rights declarations remain unverified, not a license grant.

The J20 requires a real open runway; the stock 64 m field is insufficient.
Raised street adoption must occur outside the saved player's footprint. Rain
conflicts must be resolved through normal source checks. These are actual
compatibility conditions reported to the Agent and player.

## Windows release record

The target is an unsigned `0.14.4-preview.21` Windows x64 folder build with the
managed Godot and Blender runtimes. The complete directory is required. Each
player uses their own compatible Codex CLI/login; neither the CLI executable
nor developer credentials are distributed. Existing-world play needs no model.

The final release directory contains its clean source commit, source archive,
runtime manifest, third-party notices, payload seal, package verification and
packaged native smoke report. A dedicated preview launcher uses a new data
directory. It is supplied for the user to launch and is not executed by tests.
Installer execution, signing and clean Windows first-install/upgrade/uninstall
are not claimed by a tested folder build.

At the initial delivery, the isolated branch and worktree were retained for user
testing, with no merge or push. The later user-authorized merge and cleanup is
recorded in the maintenance update above.
