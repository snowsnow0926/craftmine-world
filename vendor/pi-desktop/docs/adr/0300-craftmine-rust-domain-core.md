# ADR 0300: Craftmine Rust domain core with the full PI desktop

- Status: Accepted for the Craftmine distribution
- Date: 2026-09-09
- Scope: Downstream product; does not amend upstream PI releases

The product owner requests a Rust core from the first Windows version and a desktop experience close to the complete PI application. Keep Electron, React, the pi Agent sidecar, session navigation, settings, and work panels. Add world, creation, candidate, and verification surfaces within those components.

Introduce `crates/craftmine-core` on the existing Cargo build chain. Migrate domain persistence, task transactions, version receipts, cancellation, job ownership and memory indexes in bounded steps. The JavaScript game runtime, compiler and isolated authored-code Workers remain compatibility executors during migration. Each writable data source has exactly one owner at a time.

The first component is a durable task journal. A task binds project, session, turn, task and base-build identity. One SQLite transaction commits a new draft and the tool receipt; restart and duplicate delivery cannot repeat the mutation. Cancellation persists and rejects late writes. A bounded JSON-lines stdio service exposes the journal to the trusted product plugin; a real PluginRuntime process probe covers service startup, host-owned tool identity and shutdown. The journal is not yet connected to live world publishing or the domain compiler. Passing these probes does not establish a completed Windows client.

The local world view contains an opaque sandboxed game iframe. Package the trusted runtime, compiled game code and styles into its srcdoc, with exact script hashes in its CSP. This avoids file-origin module failures without adding same-origin access or unsafe-eval. Generated behavior code stays in the existing Worker executor; the game iframe has no plugin bridge or Node access.

Source and build records remain separate from product changes. The LGPL source and notice obligations apply to the derived distribution. Automatic tests must obey the Craftmine root input restrictions; no visible application or pointer-control tests are authorized by this ADR.
