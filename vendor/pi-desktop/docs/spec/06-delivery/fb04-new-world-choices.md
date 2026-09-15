# Demo new-world choices (FB04-002)

The player-facing `world.createOptions` response hides `first-person`,
`mining-sandbox`, `side-view` and `top-down`. These entries must be absent,
including disabled cards, from the advanced new-world form. Filtering happens
after the host combines its shipped Godot catalog and the Web provider's
options, including the fallback when Godot creation is unavailable.

The Web choice and `creation-sandbox` remain available according to their real
delivery status. The creation world retains its blank starter and the shipped
`promo-mainline`, `promo-flight`, `promo-rain` and `promo-city` examples.
Per-base starter lists retain their ownership; Web must not inherit Godot
examples through the legacy global starter list.

This is presentation policy, not a storage or compatibility migration. The
internal authored-base catalog, request validator, materializer and creation
routes remain intact for existing operations. Listing, opening, recovery and
copying existing saves retain the original base IDs and state. Library template
imports and creation through exact `creation-sandbox` library references keep
their existing validation. No saved world or bundled source is removed.

Targeted validation exercises the real shipped catalog through the coordinator,
preserved old-world rows, Web-only fallback and unchanged creation/materializer
behavior. The related E2E scenario is documented in the delivery test plan;
these logic tests do not claim physical UI or final-package acceptance.
