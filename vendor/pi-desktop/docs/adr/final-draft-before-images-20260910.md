# ADR: Preserve durable before-images for isolated draft application

Date: 2026-09-10

The old journal recorded only new hashes, so its recovery deleted replaced source instead of restoring the previous bytes. Version-2 journals retain before-images and target identities until a commit receipt is durable. Recovery validates the entire undo set before restoration. Failed recovery preserves evidence for another attempt.

Package production writes remain one managed Rust source revision; this helper supplies staging and fault-verification behavior, not a parallel database or a live-world transaction. Canonical locks and instance maps are merged and scene edits are accumulated before that revision is submitted.
