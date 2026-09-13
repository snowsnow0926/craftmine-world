# Reuse the private product host for Codex CLI worlds

Date: 2026-09-13

The project CLI now optionally owns a hidden Electron helper for the product's
formal world view, runtime adapter and candidate coordinator. It remains a
project CLI; the desktop composer continues to use PI. This extends
[Codex project author](codex-project-author.md) without changing its dynamic tool
catalog, model/effort, world identity, rollout or accounting semantics.

The Node process keeps the one CoreClient and profile lock. A narrow private IPC
proxy lets trusted product classes in the helper use Core runtime/application
operations for that fixed world. Neither model calls nor the page receive a
generic RPC or choose a source root/application store. Checked candidate IDs come
from real native jobs; first-load and later adoption retain all current Core and
runner-receipt checks. No native fixture attestation is used.

One-shot operator actions are preferable to a second persistent daemon for this
surface: they avoid overlapping Core owners and make process-cold reopen a
normal path. An authoring turn holds its helper until completion, providing real
observation and capture throughout. Services save before Core shutdown. Explicit
operator adoption stays separate from content authoring, with honest recovery
and failed-save diagnostics.

Reference/feedback image selection is likewise host-owned. The CLI archives and
hashes explicitly selected PNG/JPEG bytes and submits real app-server image
items. No filesystem tool is granted to the content model, and a user image is
not labeled as a model render. See the [interface and tests](../spec/codex-live-world-host.md).
