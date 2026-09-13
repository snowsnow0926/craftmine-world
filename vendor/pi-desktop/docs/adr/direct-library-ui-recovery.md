# Direct library operation recovery in the renderer

Date: 2026-09-13. Status: accepted for the first independent creation feature.

The existing asset sheet unmounts when closed and clears card selection on a
world change. A component-local promise would therefore hide a preparing or
checking operation, and a fresh click could accidentally create a second
operation after a lost acknowledgement.

Use a small external React store with profile-local-storage recovery for the
exact bounded native start request and display label. Persist locators only;
receipts must be read from main again after renderer or application restart.
Keep the
activity surface outside selected card and publication tab state. Main owns
durable operation records, filesystem access and all authorization. Stored
renderer data cannot bypass the native world/reference/source/adoption fences.

Mounting or returning to a world reconciles all known operation locators through
status only. Retain the latest 20 terminal operations and every unresolved one.
Start and apply
remain explicit player actions. Retry resubmits the original operation rather
than allocating a new identity. Terminal receipts cannot be replaced by delayed
nonterminal responses, and responses for another immutable selection are
rejected before entering UI state. No backend, schema, renderer path grant or
model-selection behavior changes are introduced by this retention mechanism.

Alternative rejected: keeping the full hidden asset sheet mounted forever.
That would retain unrelated searches, previews and publication effects. The
small retained operation store preserves the necessary product state without
keeping those surfaces active.
