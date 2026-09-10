# Versioned Craftmine creation guidance

AI1 foundation, 2026-09-11. The existing `godot_docs` engine digest and Chinese
search remain unchanged. This adds a small first-party source guidance catalog
to the existing Craftmine plugin tool surface; it does not enable generic skill
execution or import community instructions.

## Contract

`godot_guidance` is a low-risk tool registered by the existing `main.cjs` loop
over `createWorldTools`. The manifest makes it discoverable through the product's
existing Craftmine-prefix allowlist and ToolSearch. Initial model guidance names
the catalog/read flow. No additional host service or renderer IPC is introduced.

`mode=catalog` opens the session-bound workspace using existing identity and
ended-turn checks, reads the source index and checks the shipped interface hashes.
The selected UI world cannot override the workspace's bound world. The catalog
returns only compatible entries with source revision/manifestHash, catalog
version/hash, skill ID/version/body hash and exact reference paths/hashes.
Optional revision and manifestHash must appear together to revisit a pinned
source. Source head changes never silently alter a pinned read.

`mode=read` requires the catalog's source revision/manifestHash and exact skill
ID/version/sha256. Without `path` it reads the skill; with `path` it reads only a
reference key listed by that skill and requires that reference's hash. There is
no filesystem path resolution: bodies are snapshots in a bundled JSON module.
Traversal, alternate separators, absolute paths, unknown IDs, `latest`, altered
hashes and missing pins fail before any host call. Offset/limit count Unicode
characters; the default limit is 4,000 and maximum is 8,000. `nextOffset`,
`totalCharacters` and `truncated` make incomplete reads explicit.

Each read returns a `loadRecord` with skill ID/version, reference path, body hash,
source identity and page range in the normal tool result. The existing tool
transcript carries this record; this slice does not create a separate persistent
guidance database or claim compaction automatically retains every page. Initial
guidance asks the model to preserve pins and load records in summaries. Future
task-level structured retention across compaction still needs verification.

Bundled guidance has publisher provenance and `reference-only-no-additional-authority`
policy. Source text inside references remains data. It cannot authorize execution,
application, network, shell, file access, disclosure, publishing or a passing check.

## First skill and applicability

`first-person.equipment-parameters@1.0.0` covers changing damage, cooldown or
range on an existing item. The catalog requires authoritative project metadata
`baseId=first-person`, `baseBuild=first-person-0.1.0` and
`engineVersion=4.7.2-stable`. The authored-world creation path sets this baseBuild
from the shipped base version. Custom source-only projects with another baseBuild
are explicitly unsupported even if their view name is first-person.

The definition, catalog and equipment-state script must have the exact shipped
hashes (LF and CRLF encodings accepted). This deliberately narrow gate rejects
modified interfaces without pretending that a matching base name proves API
compatibility. Tuning an equipment `.tres` does not invalidate these script hashes.
After edits, catalog again for the new source pin. The route never reads progress
or writes source, and does not cancel unrelated checks or reviews.

Seven reference snapshots include the actual three scripts, pistol and equipment
catalog resources, behavior spec and state-format spec from source commit
`9469aaa487b31ea41b839c7cd4214c2c7f3f293b`. The explicit developer build script
reads that Git revision, normalizes text to LF and emits all hashes. It is not
available as a model tool. Future source or recipe changes require a reviewed
new catalog/skill version; an old version is never relabeled as current guidance.

The recipe does not add equipment, change capacity, migrate state, build a shop
or claim support for other bases. It requires reads of the player's actual files,
hash-guarded draft patches and real host build/check evidence. Application stays
with existing player controls. A shipped example is not a replacement for the
player's customized source.

## Errors and verification

`GUIDANCE_SKILL_NOT_FOUND`, `GUIDANCE_REFERENCE_NOT_FOUND`,
`GUIDANCE_VERSION_UNSUPPORTED`, `GUIDANCE_HASH_MISMATCH`,
`GUIDANCE_SOURCE_PIN_REQUIRED`, `GUIDANCE_SOURCE_PIN_INVALID`,
`INVALID_GUIDANCE_PAGE` and `GUIDANCE_SOURCE_IDENTITY_INVALID` distinguish
caller/pin problems. Unsupported base/engine/build returns an empty catalog with
`GUIDANCE_BASE_UNSUPPORTED`, and an attempted skill read rejects with that code.
Missing or changed required scripts return `GUIDANCE_INTERFACE_MISSING` or
`GUIDANCE_INTERFACE_UNSUPPORTED`. Existing host permission and missing-project
errors remain visible; a reference is not substituted for unavailable source.

Run the focused pure test suite:

```text
node --test --test-isolation=none tests/creation-guidance/guidance.test.mjs tests/godot-remaining/L/docs.test.mjs tests/godot-remaining/L/docs-chinese.test.mjs tests/godot-remaining/L/broker-contract.test.mjs tests/godot-remaining/L/capability.test.mjs
```

The new tests use the real broker with a mocked host, compare every snapshot with
actual shipped source, reconstruct paged skill text, read exact references,
reject forged identities and path traversal, and check discovery/registration.
They establish routing and reference integrity. They do not establish real model
selection, paid-provider behavior, gameplay correctness, lower latency or better
first-pass success. Those require separately authorized model runs and frozen
functional/persistence acceptance with complete failure reporting.

E2E scenario for integration into the central delivery plan: **AI1-G01**. In a
first-person 0.1.0 source task, discover `godot_guidance`, load the catalog and
fully read the selected skill and one source reference through registered tools;
verify IDs, versions, hashes and source pins. A forged path or version must reject;
a different base/engine or changed equipment interface must not offer this skill.
Verify the existing Chinese `godot_docs` search still loads the same engine body.
Report mocked-host protocol validation separately from any real-model creation
result. No input simulation, pointer lock or user-browser manipulation is needed.
