# Optional first creation guide

Date: 2026-09-13. This supersedes the workbench-only six-step guide.

The existing PI Desktop world sidebar owns a collapsed, bilingual five-page
guide. It describes opening/creating a world, exact direct asset use, a supported
size/color edit, explicit save and cold reopen, and portable world-template
sharing. It does not promise arbitrary GLB or companion parameter editing.
World-template copy accurately describes the current saved-progress starting
state and exclusion of unapplied drafts.

The guide's only outputs are literal navigation destinations: `worlds`,
`assets`, `create`, `play`, `history`, and `share`. Navigation reuses the
current chooser, guarded preview preparation and asset sheet, layout controls,
history sheet, and existing world publication form. The asset panel's optional
`initialSection` prop selects a tab; it cannot submit or preapprove publication.
The selected world and its normal mutation controls remain authoritative.

`craftmine.first-creation.guide.v1` stores only `{open, step}` in profile local
storage. `step` is a reading bookmark, never a verified milestone, world state,
receipt, completion flag or AI context. Invalid preferences fall back to a
collapsed first page; unavailable storage does not prevent reading. Navigation
never advances the bookmark. No world-specific action is enabled without a
selected world. The old guide is no longer mounted in the plugin workbench.

The sidebar derives a return link from the existing direct-operation store,
filtered to the selected world. Its wording is deliberately "Review asset
operations": a persisted locator has no status authority until the library
reads the host. This link neither polls nor restarts operations. The existing
library status reconciliation removes confirmed terminal operations from that
pending link. No receipt, cache, or completion record is added by the guide.

Validation uses actual React components with fixture host data in
`tests/first-creation-guide-ui.mjs`, and the fixed native `worldCreationGuide`
probe for assembled integration. The two existing target-feedback native
harnesses now assert the sidebar contract instead of the retired workbench
mount. Real external first-time users remain separate acceptance evidence.
