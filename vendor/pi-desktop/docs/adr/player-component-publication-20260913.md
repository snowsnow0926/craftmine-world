# Player component publication to the local catalog

Date: 2026-09-13. Status: accepted within the isolated player workflow continuation.

The existing component exporter previously wrote a ZIP through a file dialog.
Players can now save the selected component directly to the existing Rust asset
catalog. This extends the existing pi-desktop package request boundary; it does
not introduce another asset database, filesystem tool, model permission, or
remote publication service.

The trusted plugin extracts a pinned source revision, validates the existing
package format and writes a private staging ZIP. Rust `asset.import` owns the
immutable version and bytes; `asset.annotate` owns searchable annotations.
Catalog IDs use `player.component.*`, so built-in IDs remain immutable. Original
source requirements and attribution are retained only when the installed source
declaration, lock, wrapper and bytes agree. The installer now actually supplies
its resource manifests to the existing declaration writer. Older missing
declarations can be recovered read-only from an exact catalog archive, with the
same resource hash and complete installed-file validation. Missing or changed
evidence is an actionable unsupported condition, not inferred compatibility.

Publication operations freeze metadata, source identity and archive bytes in a
private journal. Exact retries reconcile Rust's existing operation identity;
different parameters under the same operation ID refuse. Cancellation is
durable before native commit dispatch. Once native commit starts, cancellation
returns the real committing/completed state rather than claiming rollback.
World switches are checked before export and native commit. Shutdown/restore
drains publication work before moving the authoritative domain.

A preview may come only from the host's current bound native world frame. It is
stored using existing native preview claims and labelled `source-world-view`.
It is not an isolated component render and provides no application or gameplay
verification. No renderer-controlled paths or image bodies are accepted.

Public sharing and verified redistribution rights remain outside this action.
Player publication records unverified rights and retains explicit source
attribution without manufacturing a license grant.
