# Bind model authoring to immutable Git source identity

Status: accepted, 2026-09-10.

The actual DeepSeek creation run reached `godot_project_patch`, but the broker
omitted the operation context required by the Git-backed Rust core. Writes failed
with `CONTENT_OPERATION_CONTEXT_REQUIRED` before a candidate could be produced.

Expose immutable content identity from the existing revision index and construct
the operation context in the trusted broker. Do not expose new authority fields
in the model schema or relax Rust write checks. Avoid reading mutable HEAD to
construct retries, which would change the request hash after a committed write.

Validate consecutive edits, old-revision rejection, receipt replay after HEAD
movement, altered replays, forged identity and lost replies against the real core.
Real model creation and packaged acceptance remain separate execution evidence.
