# Recoverable package draft file sets

Production package installation computes a complete file set and submits it through the Rust managed source transaction. The local apply helper is restricted to private staging workspaces; it is never a write path to the running world.

Plans merge existing canonical lock and instance entries, reject incompatible existing locks and duplicate instance identities, accumulate multiple edits to one scene, and deduplicate identical target writes. Instance metadata is `craftmine.instances.json`, a portable managed source path. All target paths reject traversal, Windows aliases and links.

The private staging apply helper persists synced before-images for every target and a version-2 intent journal before replacement. Targets have unique staging names even when content matches. A process crash restores each original file or removes only a file proved to have been newly created. Unexpected target content fails recovery instead of overwriting it. Legacy journals without before-images are refused. A committed journal is not rolled back when cleanup fails. Same operation/request replays the prior receipt before replanning.

This proves process-crash recovery, not guaranteed survival of every storage controller/power-loss failure. Journal replacement is atomic and file bytes are flushed; Windows directory durability remains platform dependent.

E2E: terminate the helper immediately after it replaces an existing scene, restart recovery, compare old scene, lock and instance-map bytes, then retry. Also install two nodes into one scene, install the same bytes into separate targets, and perform a second installation retaining the first instance.
