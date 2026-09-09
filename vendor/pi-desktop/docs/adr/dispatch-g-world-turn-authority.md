# Host authority for world-creation turns

Status: accepted for Craftmine integration.

World tools already receive durable PI turn identity. Request-time memory and
budget services need the same authority before the first tool call. Electron
therefore records an immutable world binding and enforces an exact tool gate
before forwarding any runtime request. The plugin's private lifecycle bridge
obtains authoritative facts from Rust. Neither a panel's current selection nor
an LLM argument can redirect an existing turn. Read-only UI selection remains a
separate capability and must not confer model invocation authority.
