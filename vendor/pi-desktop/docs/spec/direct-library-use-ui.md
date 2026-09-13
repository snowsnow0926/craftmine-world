# Direct use in the existing asset sheet

The selected immutable asset detail offers direct use alongside the existing AI
add and AI modification actions. Direct use requires a selected world and a
host-reported eligible source package. Raw resources, bases, data and complete
worlds cannot masquerade as directly placeable objects. Player world templates
keep their existing independent-world creation form. AI actions keep their
original Composer callback and exact selected version.

The initial eligibility inspection is read-only. It never means the target
world has passed compatibility checks. The player first requests **Check and
prepare**, then explicitly requests **Add to this world** after the native
operation becomes ready. Neither action calls a model or writes a Composer
prompt. Native main remains responsible for source, selection, compatibility,
checks, protected saved progress and adoption.

Omitted position means the package's original default placement. For an exact
host-supported single-root scene, the player can optionally enter X/Y/Z meter
coordinates between -80 and 80. Y is height. The asset thumbnail is not a 3D
placement preview or evidence that the requested site is suitable. Native world
compatibility checks do not certify visual placement or all object overlaps.
The player inspects the actual position after adding.

The activity list belongs to the world, not the selected card or publication
tab. Preparing, checking, ready, applying, applied, cancelled, failed and
interrupted are distinct states. The most recent operation and every active
operation remain visible; earlier terminal operations are available in a
collapsed history. Details expose the actual bounded host error, with concise
localized next-step guidance for ownership changes, busy creation, unsupported
content, geometry and input/weather conflicts. Retained drafts are explicitly
distinguished from the original formal world.

The renderer persists exact requests and display labels as locators in profile
local storage before invoking main. Receipts stay in the external React store
only. A fresh renderer reads every result from main; stored labels and requests
never become cached success or approval. Each panel mount reconciles all known
operations for the world; later polling covers nonterminal operations without
automatically replaying start or apply. This is UI recovery state, not authority
to apply content. Completed history is bounded to the latest 20 operations;
unresolved operations are not evicted.
An uncertain start can be retried only with its original world, immutable asset
reference, coordinates and operation ID. Changing selection or world cannot
transfer this operation. Confirmed terminal results and newer host timestamps
reject stale late responses. Responses with another world, reference, operation,
an unknown status, or a nonzero model-call count are rejected.

Closing the asset sheet retains the native operation and allows the user to
return to inspect it. No cancellation is implied by hiding UI. Cancellation is
an explicit request and displays success only after a host receipt. An app
restart does not automatically resume interrupted creation. Runtime operations
remain host-owned even if profile local storage is unavailable.

Validation: `tests/direct-library-ui.mjs` mounts the actual AssetLibraryPanel
with a deterministic bridge in an independent headless Chromium. It submits
ordinary forms and invokes actual React input handlers through page scripts.
It never uses input simulation, Pointer Lock, real keyboard/mouse or foreground
windows. These fixtures prove renderer behavior only. Native check, adoption,
gameplay, cold world reopening and first-time human success require separate
evidence.
