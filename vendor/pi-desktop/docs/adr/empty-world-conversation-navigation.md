# Restore an empty creation conversation without inventing a task

Date: 2026-09-13. Status: accepted for implementation.

The ordinary New World flow creates a real empty PI session. Before its first
model or editor turn there is no Rust workspace/task binding, so the previous
conversation resolver correctly found nothing on cold reopen. Selecting its
sidebar row in Create mode also lacked a retained world panel. This blocked
offline editing even though the session and world both existed.

Keep Rust task and source ownership unchanged. Store a separate, host-owned
navigation locator after the normal creation flow. The host remembers sessions
it has just created and the world selected before creation. The main-frame
`world.conversation` request with `action: "remember-created"` can register that
session only while it is still empty, in the current project and selected world.
The session-to-world/project tuple is immutable and written atomically under
the profile. A repeated acknowledgement is idempotent. This is not a turn,
workspace, task, source scope, lease, permission grant, or model authorization.

The current project is read from host `workspace.get` and rechecked before
persistence. The first-run project getter may seed the host workspace after
the main-process cache was initialized to null, so that cache is insufficient
for this gate. Canonical existing-directory comparison handles native Windows
path spelling, without changing previously established Rust project hashes.

When resolving a conversation, an actual Rust task binding takes precedence.
An exact navigation locator is usable only if the existing host-only
`maintenance.context` read returns null, proving no workspace exists. A foreign,
running, failed-to-read or project-mismatched workspace never falls back to the
locator. Removed/archived sessions and inactive plugins remain excluded.
Ordinary editing must establish its normal Rust task binding independently.

Existing worlds without a trustworthy locator are not guessed from localStorage
or empty sidebar rows. The explicit Start creating action creates/registers a
new empty conversation for the selected world. New World uses the same path.
Guide navigation itself does not create anything. Renderer recovery keeps all
draft, attachment, archive, session-selection and navigation-intent fences;
verified recovery in Create mode carries only the world panel into that session.
Generic coding conversations are not registered or automatically reassigned.
