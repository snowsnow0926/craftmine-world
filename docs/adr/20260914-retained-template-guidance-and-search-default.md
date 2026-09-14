# Retain exact template guidance and make optional search scope usable

Status: accepted and implemented.

The shipped mainline template and its ordinary observer upgrade use the released
engine-monitor bridge `593ade66…`, while guidance 1.8.2 covered only the older
bare bridge and the newer placement-preview bridge. The actual player source
therefore failed catalog discovery despite preserving all recipe interfaces.

Add separate, complete, reviewed cohorts for the shipped and observer-upgraded
forms. Keep all old declarations and recipe text/version/hash values. Bump the
catalog version to 1.8.3. Do not add an alternative hash to an existing cohort,
infer compatibility from base ID, or derive trust from mutable player sources.
The archived player index, checked-in template bytes and fixed upgrade bytes
jointly supply provenance; per-member negative tests preserve the trust boundary.

Also define the omitted optional `asset_library` search scope as `local-library`.
This is the existing read-only local catalog capability, with no import or
cross-world mutation. Explicit invalid scopes continue to fail. Keep project
index's existing 32-file bound, and expose it in descriptions and recovery errors
so malformed arguments do not invite repeated guesses or acquire a draft lease.

See [the behavior and validation specification](../specs/player-source-discovery-recovery.md).
