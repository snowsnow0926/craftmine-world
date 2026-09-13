# Friend playtest handoff and local feedback

Use the existing world-template ZIP workflow. Template details display its exact
asset/version, base version and archive hash, and explain that the same app
version should accompany it. Import validity is not proof of successful play:
the normal check and first-load gate remain required when creating a copy.

The asset sheet contains a collapsible friend feedback panel for the current
world. Players write a problem/reply and reproduction steps/expected outcome.
Screenshots are off by default. Preview freezes the actual Rust world identity,
build, revision/content hash, base/engine/progress versions and packaged client
version/commit. Optional screenshots come exclusively from native world capture
and must match that world/build. Preview shows every exported field and image.
Export requires a separate explicit confirmation and native save dialog.

No account details, conversation, diagnostic logs, source, other issues or saved
progress are collected. The report is JSON data, not a world archive or command.
The immutable `feedback-<sha256>` identity hashes canonical report content
excluding `id`. This detects changes; it is not a signature or proof that an
imported player's statement is true. Reports explicitly remain unverified.

Opening a feedback file validates it and shows a preview without writing domain
state. Confirming attaches it to the selected author's world. Rust stores the
report in `craftmine_playtest_feedback`, separately from the existing local issue
ledger, with a `(world_id,id)` key. Repeated imports are idempotent. Reading an ID
through another world's key fails. Lists distinguish a different source build;
the source world/client/hash remain visible even when a report is attached to a
different local world. Replies are new immutable reports with `replyTo`, requiring
an existing report in the selected world's journal for locally created replies.

The optional AI-review action prepares quoted, explicitly untrusted report data
for the existing selected-world Composer. It does not submit a turn, overwrite a
draft or mark anything repaired. The ordinary authoring/check/application flow
and existing template version publication remain the repair/republication path.
Player replies describe their observations, never automatic verification claims.

## Boundaries

Main-only routes: `playtest.describe`, `preview`, `export`, `importPreview`,
`importCommit`, `list`, `read` under the `playtest.` prefix. The caller supplies
only bounded text, IDs and screenshot consent. Renderer-supplied paths, client
identity, context, report bytes and arbitrary RPC are denied. Native file grants
are never exposed. Up to eight preview grants expire after fifteen minutes;
the oldest grant is replaced when a ninth review is requested, so cancelled
previews do not block subsequent feedback.
World selection/lifecycle and formal build/base/engine/progress-format identity
are rechecked before export. Autosave-only progress changes do not invalidate a
reviewed historical report: its timestamp, revision/content hash and screenshot
remain exactly as previewed. A new formal build requires a fresh preview. The
report is never silently recaptured or rewritten during confirmation.
Reports are at most 800,000 bytes, PNGs at most 512 KiB, and journals at most
100 reports per world. These are file/storage limits, not AI task limits.

Private Rust methods are `playtest.context`, `validate`, `record`, `list`, `read`.
The private plugin-runtime orchestrator allowlist admits exactly those five
methods, in addition to the plugin host router and main-frame panel boundary.
The separately validated `world.brief` product method is also admitted; similarly
named prefixes and arbitrary brief actions gain no blanket permission.
Record validates exact schemas, canonical hash and optional screenshot identity.
Local records must match current Rust formal-content identity; imported records retain original
identity and have no authority over the author's world. No remote service,
upload, messaging, account sharing or background model request is introduced.
