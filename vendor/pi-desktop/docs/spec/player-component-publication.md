# Local player component publication

The existing `package.request` surface adds these player-only methods:

| Method | Parameters | Result |
| --- | --- | --- |
| `publishSource` | `worldId`, `operationId`, `revision`, `manifestHash`, `nodePath`, `assetId`, `version`, `displayName`, optional `tags`, `aliases`, `notes`, `includePreview` | Completed exact `assetRef`, source identity, archive hash, file/requirement counts and preview status; or cancelled |
| `publishSourceStatus` | `worldId`, `operationId` | `not-found`, `preparing`, `prepared`, `committing`, `completed`, or `cancelled` |
| `cancelPublishSource` | `worldId`, `operationId` | State and whether cancellation was accepted |

The renderer obtains `nodePath`, `revision` and `manifestHash` from the existing
`sourceList` result. It cannot send a source path, archive or preview body.
`assetId` is `player.component.<slug>` with at most 80 ASCII characters; version
is 1–100000; display name is at most 200 UTF-8 bytes; tags and aliases together
contain at most 29 entries of 40 UTF-8 bytes each; notes use at most 3000 bytes.
Three reserved searchable tags are added. Aliases and notes are both retained
inside immutable source publication metadata and projected into the existing
catalog search index. Updating a version requires a new version number and
operation ID; overwriting an immutable version refuses.

Metadata and the selected source revision are frozen before import. Publishing
does not mutate world source, adopt a candidate or save live player progress.
The return value keeps `applied:false`. The created catalog package is consumed
by the existing `godot_source_library` search/read/propose and normal source
installer, check and adoption flow. No extra model call is needed to publish.

The exporter still refuses a whole-world root, multiple identities, detectable
external node/signal dependencies, missing source and excessive payloads.
The indexed world may contain up to 64 MiB; copied component source remains
bounded to 4 MiB and the ZIP to 5 MiB. Listing reads only scenes/scripts. Export
loads binary and ancillary dependencies lazily from the same pinned index,
without reading unrelated models. Native import and installation remain the
authoritative validators. Inherited PackedScene roots can be placed by following
at most 16 package-local static scene roots, without script execution.

For installed packages, source requirements and the matching exact runtime
profile survive export; source license/provenance files and declared capabilities
are retained. An old missing declaration may be reconstructed in export memory
from the native catalog only after matching its CP0 resource hash, lock and all
installed files. Edited package bodies whose old declaration no longer matches
currently refuse; ordinary supported scene property overrides are preserved.

Optional previews use at most 700000 base64 characters of a real host PNG.
`previewStatus` is `source-world-view` or `unavailable`; the catalog detail must
say this is the source world's current view, not an isolated object preview.
Native preview `status:ok` means that captured picture exists, not that the
component passed a check. Absent running-frame capability never invents a picture.

Cancellation checks between native source reads stop further extraction work.
Once import is committing, callers poll/retry the same operation; the receipt
does not claim a cancelled commit disappeared. Lost replies replay frozen native
import/annotation operations and return the durable completed receipt.

Targeted validation: 22 logic/source regressions passed, with the optional Core
parameter test skipped in that unit invocation. A separate real Core run using
binary SHA-256 `160c815d5a5d43a404ad6e1961c6346bfd79a2de66487f76da9c021f521afee2`
passed approved-Pomeranian publication, exact legacy declaration recovery,
versions 1 and 2, immutable conflict rejection, alias search and two independent
cross-world installations. The accepted GLB hash remained unchanged and three
exact shared runtime requirements survived. The reproducible entry point is
`tests/player-component-library-native.mjs <core-executable> <built-library-dir>`.
It starts no executor and reports actual `source-saved-check-blocked`; it is not
runtime/adoption/save-reopen acceptance. Native source evidence is retained in
`test-results/player-component-native-ZoJLzc/report.json` in the isolated worktree.
# Main renderer publication routing

The existing PI asset sheet can call the narrow `package.request` subset
`sourceList`, `publishSource`, `publishSourceStatus`, and `cancelPublishSource`.
The navigation gateway validates the matching world envelope; main routes those
calls to the existing package service with a main-frame sender check and shutdown
guard. The package service retains metadata, selected-world and source identity
validation. General ZIP import/export, source installation and candidate adoption
are not exposed through this new navigation route.

World-template publication may request only `godot.runtimeSave` with the selected
world ID and `freeze: false`. Main validates the sender frame and the existing
Godot coordinator captures/saves the actual runtime. The renderer cannot supply
progress, a checkpoint token, a snapshot, or a frozen-save request.

## Re-publication paths

Extracted installed components must not accumulate previous `addons/` ancestry
when republished. The exporter relocates payload into short dependency groups,
rewrites textual resource and attribution references, and keeps relative model
dependencies together. GLB, image and paired import policy bytes remain exact;
shared source requirements retain their original pinned paths. Original archives
and worlds remain unchanged. Existing size/file limits still apply; arbitrary
deep authored paths and unlimited inherited scene wrappers are not promised.
See the root `docs/COMPONENT_PUBLICATION_PATHS_2026-09-13.md` decision and the
ten-generation install/export regression. Actual engine import/adoption is
verified independently by the native library UI acceptance.
