# Private managed file installation

`godotProject.applyFiles` is a host-only source operation, not a public model
filesystem capability. Parameters are `context`, `worldId`, `toolCallId`,
`revision`, `manifestHash`, optional `operation` (required for Git), and `files`.
Each file is `{path, bytesBase64, expectedHash}`; `expectedHash` is required and
is null only for an absent file. Files are upserts; omitted paths survive.
Paths remain project-relative. The instance record uses
`craftmine.instances.json`, the canonical lock `craftmine.assets.lock.json`.

The existing project writer checks task/world/lease, expected source revision,
per-file hashes and Git expected HEAD before publishing one revision and its
durable receipt. The same request returns that receipt. Text and binary share
the manifest, Git commit or immutable blob backend, copying and build
materialization. No executable host paths or live runtime files are written.
Limits remain 4 MiB/file, 64 MiB/project, 4096 files; the request JSON is capped
at 8 MiB plus 128 KiB (base64 expansion counts). Binary extensions are png,
jpg, jpeg, webp, wav, ogg and glb. Other approved sources require UTF-8 without
NUL; obj, mtl and uid are text. Import/check remains the sandbox's responsibility.

`godotProject.read` on a binary file returns `encoding: "base64"`,
`bytesBase64`, `offset`, `totalBytes`, `bytes`, `sha256`, and `nextOffset`.
Offset/limit count bytes for binary, characters for text. Limit is at most
16000. Existing text responses are unchanged. The caller assembles pages
against one fixed revision and manifest hash. `godotProject.receipt` accepts
method `godotProject.applyFiles` for a read after the authoring turn ends.

The returned installation is source-only; a checked candidate and explicit
application are still required before it becomes the world's playable build.
