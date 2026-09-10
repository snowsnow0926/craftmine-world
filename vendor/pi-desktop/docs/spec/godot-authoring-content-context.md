# Godot authoring content identity

For Git-backed projects, `godotProject.index` returns `content` with the managed
repository, branch and immutable commit corresponding to the requested revision.
Legacy source indexes return null. Existing source identity and paging remain intact.

The world-tool broker binds `godot_project_patch` to that exact revision and adds
the trusted operation context. Neither model arguments nor current UI selection
can supply repository identity. The current public authoring tool edits main only.
The operation ID derives from the host invocation; applied-content and progress
expectations are null because a source edit does not apply content or change saves.

Repeated invocations with the same request retain the same operation context,
including after HEAD advances. Rust receipt validation recovers a committed write;
changed requests, stale source revisions and concurrent HEAD movement still fail.
Transport uncertainty queries the original receipt without replaying the write.
A recovered build receipt goes through the same executor handoff as a normal
reply, provided its turn is still active; an ended turn never starts execution.
