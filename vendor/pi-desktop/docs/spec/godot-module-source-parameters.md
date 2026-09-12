# Audited module source parameters

The existing `godot_project_query` tool has two additional read-only modes.
`module-parameters` accepts only its mode. `module-parameter-preview` accepts
the mode, the returned SHA-256 `bindingHash`, and a nonempty `changes` object.
The four supported scalar fields are `model_scale_percent` (integer 25–800),
`quarter_turns` (integer 0–3), `solid` (boolean), and `label` (up to 80 Unicode
code points, without ASCII control characters). Label is source metadata; the
audited wrappers do not display it as a visible object name.

Only the two pinned Kenney building/road wrappers are supported. Their original
resource references, wrapper hashes, asset lock, unique installed entity ID,
direct main-scene instance and fresh host scene-object reference must match.
Unknown wrappers, inherited scenes, child overrides, shared source changes and
stale/ambiguous references are refused. A reference through a mesh child must
have the exact matching module ancestor. No runtime object ID becomes durable
entity identity or write authority.

World identity comes from `task.context`; the source revision/hash comes from
the host's frozen `creationTarget`. The loader never opens a workspace or reads
mutable selected-world settings. It reads the complete pinned source index
(at most 512 files), then the six required text files. Binary resources are
checked against the Core source index and asset lock, not downloaded or decoded
by this tool. Text limits are 180,000 bytes per file and 1 MiB in total. A final
source-head check and fresh live sample precede interpretation. These are tool
input limits, not player model token, call-count or whole-turn limits.

The result reports effective source defaults/overrides and their provenance.
It explicitly does not verify current runtime parameter values. Preview returns
at most one `put` operation against the owning parent scene with its expected
hash. Other instances, transforms, shared resources and progress are preserved.
A no-op returns no operations and does not require a new check. A changed
proposal still needs the ordinary source transaction, real candidate check,
progress compatibility, player adoption and cold-open verification. Neither
mode writes, calls `configure()`, grants adoption, or certifies collision safety.

Capability inventory distinguishes missing capture/sampler wiring from unknown
per-target readiness. The production plugin ships both the loader and a bundled
pure helper without imports back into the development checkout.

Original CP0 parameter declarations are separately preserved by the existing
source installer and exporter in `craftmine.instances.json`. They describe the
source; they do not extend this tool's setter allowlist. Legacy missing metadata
stays unknown. See the root module-source-preview and parameter-declaration
specifications for exact binding and re-export validation.
