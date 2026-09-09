# ADR 0304: Open the world without creating a conversation

- Status: Accepted for the downstream Craftmine distribution
- Date: 2026-09-09

The first native run showed an enabled World navigation entry but no world surface. Upstream's `openWorkPanelTab` returns when there is no active conversation. The prior layout fixture had prepopulated the tab and concealed this integration gap.

Retain a renderer-only home work-panel context under `@craftmine/home`. Opening, activating, closing and collapsing panels work on this context when no conversation is selected. Navigation stores and restores it independently from each conversation's context. The key never becomes a host session, project lease, permission grant or Agent execution identity. Opening the world does not create a history row. First-run world navigation waits for bootstrap readiness; an existing conversation or retained resource context is respected.

The actual React layout probe now begins with no tabs and exercises the home panel operations. A pure navigation regression verifies that home resources and two conversations cannot overwrite one another. Native Electron acceptance independently verifies first-run world startup.

When the world narrows the conversation column, localized controls retain their labels. Toolbar groups wrap onto a second row below 520 pixels of composer space instead of squeezing the permission label into a vertical column. Wide desktop layouts retain the existing PI arrangement.
