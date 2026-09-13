# Player publication boundaries

The existing source extractor, Rust catalog and Godot initialization services
remain authoritative. Electron main adds a narrow world-template metadata and
native file-picker adapter; private staging paths remain host-only. The renderer
may select an immutable asset reference but never provide an archive path or
arbitrary runtime state. Local publication is not remote sharing or a license
verification claim.

Current saved progress is an explicit author choice for new player templates.
This provides a reproducible chosen starting state without inventing a generic
reset for arbitrary gameplay scripts. Authored defaults in shipped examples are
unchanged. New world identities scope existing source-local component identities.
