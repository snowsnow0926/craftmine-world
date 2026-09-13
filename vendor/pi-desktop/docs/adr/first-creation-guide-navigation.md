# First creation guidance belongs to the existing PI sidebar

Date: 2026-09-13. Status: accepted for implementation.

The earlier guide lived inside the legacy workbench library, omitted direct
catalog use and world-template sharing, and reset when players navigated away.
The current product entry points already live in the PI sidebar and asset
sheet. A second tutorial shell would duplicate those controls and obscure the
normal creation flow.

Place the optional guide alongside the existing sidebar asset entry and route
literal destinations to existing navigation handlers. Remove the old plugin
mount. Persist only the reading bookmark and expansion preference, so closing
and returning is useful without pretending that opening a screen completes a
creative goal. No world or operation authority moves into the guide.

Use the current direct-operation locator store for a world-scoped return link;
the original library performs host reconciliation. Opening the sharing page
only selects the real publication tab. Its consent and source checks remain
unchanged. There is no new IPC route, broad capability, AI call, save, publish,
or source mutation in this interface.
