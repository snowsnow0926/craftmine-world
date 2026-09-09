# Creation package format, static round trip and install planning

Status: CP0 and CP1 implemented in `codex/godot-round2-r4-20260910`.
Owner: task R4 (`godot-round2-20260910/R4-packages-and-installation.md`).

This spec covers the frozen package contract, the static ZIP round trip and the
install planner. It does not cover scene materialization (R3), the RPC/service
registration (R1), the client entry points (R2) or model tools (R7).

## 1 CP0 frozen contract

Seven resource kinds: `base`, `world`, `module`, `object`, `scene`, `raw`,
`data`. Formats: `craftmine.package/1` (ZIP container), `craftmine.resource/1`
(single resource manifest), `craftmine.assets-lock/1` (resolved dependency
lock).

Package layout:

```text
package.json                          index: root AssetRef, resources, every FileRef
resources/<contentHash>/manifest.json immutable resource manifest
resources/<contentHash>/payload/...   scene, source, data, assets, licence files
catalog.json                          names, descriptions and preview index
previews/...                          optional preview files
```

`package.json` lists every archive entry except itself; `manifest.json` is not
listed inside its own payload; the transport identity is `archiveSha256` and
`bytes` over the whole ZIP.

### 1.1 Canonical content identity

Canonical form is the RFC 8785 subset frozen for this product:

- UTF-8, no whitespace, no BOM.
- Object keys sorted by UTF-16 code unit sequence (`String.prototype.<` in JS,
  `encode_utf16()` order in Rust), arrays keep order.
- Strings escape only `"`, `\` and U+0000..U+001F, using `\b \f \n \r \t` where
  applicable and lowercase `\u00xx` otherwise; every other character, including
  non-ASCII and non-BMP, is emitted raw.
- Numbers must be JSON integer literals within ±9007199254740991. Fractional
  or exponent literals are refused with `PACKAGE_FLOAT_NOT_CANONICAL` and larger
  integers with `PACKAGE_NUMBER_OUT_OF_RANGE`. This is deliberate: Rust and
  JavaScript must not be able to disagree about a hash through float
  formatting. A data pack that needs a real number stores it as a string with
  its own schema.
- Duplicate object keys are refused at parse time with `PACKAGE_DUPLICATE_KEY`;
  neither `JSON.parse` nor `serde_json` rejects them by default, so both sides
  use a strict parser.
- `-0` normalizes to `0`.

`contentHash = sha256(canonical(content))`. It covers only the resource
`content` object, never the package path, remote address or display metadata.

The same vector file is executed by both languages:
`tests/godot-round2/R4/vectors/package-format-vectors.json` (Rust:
`library/package_format_tests.rs`; JS:
`tests/godot-round2/R4/package-format.test.mjs`).

### 1.2 Paths

Relative forward-slash paths only. Refused: empty path, absolute path, drive
letter, `..` or `.` segment, empty segment, trailing slash, backslash, `:`
(alternate data stream), Windows reserved device name as any segment
(`CON PRN AUX NUL COM1-9 LPT1-9`, case-insensitive, with or without extension),
and characters whose canonical composition cannot be verified without a shared
Unicode normalization dependency (combining marks U+0300–036F, U+1AB0–1AFF,
U+1DC0–1DFF, U+20D0–20FF, U+FE20–FE2F and the NFC singletons U+2126, U+212A,
U+212B, U+FB00–FB06) → `PACKAGE_PATH_NEEDS_NORMALIZATION`.

Collisions are case-insensitive and exact: `PACKAGE_DUPLICATE_ENTRY`. The
normalization rule is conservative on purpose; see §5 for the R1/R6 decision it
needs.

### 1.3 Kinds and legacy mapping

`craftmine.module/1..4` map to a CP0 kind explicitly:

| legacy kind | CP0 kind |
| --- | --- |
| `object` | `object` |
| `gameplay` | `module` |
| `scene` | `scene` |
| `raw` | `raw` |
| `data` | `data` |
| `world-template` | `world` |
| `base` | `base` |
| `creation` | **ambiguous**: `module`, `object`, `scene`, `world` |
| anything else | `PACKAGE_LEGACY_FORMAT_UNKNOWN` |

`creation` is never guessed from its name; the author must choose.

### 1.4 Dependency lock: one canonical contract

There is exactly one `craftmine.assets-lock/1` document in the product:
`AssetLock` in `crates/craftmine-core/src/content_history/contract.rs`, mirrored
by `plugins/craftmine-world/asset-lock.mjs`. The content history, the asset
catalog, the package layer and the client all validate, canonicalize and hash
the same shape:

```
{format: "craftmine.assets-lock/1", assets: [
  {asset: {assetId, version, contentHash}, installPath,
   files: [{path, sha256, bytes, mediaType}],
   dependencies: [{assetId, version, contentHash}],
   overrides: [{scope, path, contentHash}]}]}
```

Canonical text is pretty JSON (two-space indent, LF, one trailing newline);
`assetLockHash` is SHA-256 over those bytes. Sort order, path rules, one version
per assetId, resolved and acyclic dependencies and the collision rules are the
frozen contract in `tests/godot-remaining/M/contract/asset-lock-vectors.json`;
`tests/godot-round3/S3/vectors/asset-lock-vectors.json` adds the shared
Rust/JavaScript vectors and the media-type table.

The package format keeps its **own** dependency metadata
(`content.dependencies[]` = `{id, version, sha256}`) and converts it explicitly:
`{id, version, sha256}` -> `AssetRef{assetId: id, version: "<n>", contentHash:
sha256}`. A dependency whose declared hash does not equal the resolved
resource's content hash is refused (`PACKAGE_DEPENDENCY_HASH_MISMATCH`). Because
the package manifest file entries carry no media type, the conversion derives it
from the extension with a fixed table shared by both languages.

The former R4 document (`{direct, closure, graph}`) reused this format id with a
different structure and no content hash. It is refused explicitly with
`ASSET_LOCK_LEGACY_SHAPE`; the supported migration is to re-plan the install
from the resource manifests (`package.planInstall`), which produces the
canonical lock.

## 2 CP1 static ZIP round trip

`plugins/craftmine-world/package-zip.mjs` reads and writes the container itself
(`node:zlib` only). Reader and writer support method 0 (store) and 8 (deflate);
the writer is deterministic (sorted entries, fixed timestamp, no extra fields,
no data descriptors, CRC-32 per entry, `package.json` first).

Limits are enforced **before** inflation:
`maxEntries 4096`, `maxEntryBytes 64 MiB`, `maxTotalBytes 512 MiB`,
`maxCompressedBytes 256 MiB`, `maxDepth 32`, `maxNameBytes 240`,
`maxRatio 200`.

Refusals: `ZIP_UNSUPPORTED_METHOD`, `ZIP_ENCRYPTED_ENTRY`, `ZIP_MULTI_DISK`,
`ZIP_BAD_CENTRAL_DIRECTORY`, `ZIP_TRUNCATED_ENTRY`, `ZIP_CRC_MISMATCH`,
`ZIP_DUPLICATE_ENTRY`, `ZIP_SYMLINK_ENTRY`, `ZIP_TOO_MANY_ENTRIES`,
`ZIP_ENTRY_TOO_LARGE`, `ZIP_TOTAL_TOO_LARGE`, `ZIP_COMPRESSED_TOO_LARGE`,
`ZIP_PATH_TOO_DEEP`, `ZIP_NAME_TOO_LONG`, `ZIP_RATIO_EXCEEDED`,
`INVALID_PACKAGE_PATH`, plus `PACKAGE_MISSING_FILE`,
`PACKAGE_FILE_HASH_MISMATCH`, `PACKAGE_ENTRY_NOT_LISTED`,
`PACKAGE_MISSING_DEPENDENCY`, `RESOURCE_CONTENT_HASH_MISMATCH`.

`packStaticPackage` is self-contained: root resource, full dependency
manifests, payload bytes and licence files are all inside the archive. A
package that cannot be completed offline is refused rather than emitted as a
fake-complete package.

## 3 Install planning

`package.planInstall` (Rust `library/installer.rs`) turns a validated package
into a deterministic plan before anything is written:

- dependency-first order with cycle and missing-dependency detection;
- one new identity per resource per `operationId` (`ins-<24hex>`), stable on
  replay and different for a different operation;
- entity map from each template entity id to `<instanceId>-e<n>`;
- a canonical `craftmine.assets-lock/1` document (see 1.4) built from the
  resolved closure, with fixed versions, content hashes, install paths, files
  and the full dependency list;
- conflicts against the destination world's inventory:
  `PACKAGE_CONFLICT_INPUT_ACTION`, `PACKAGE_CONFLICT_AUTOLOAD`,
  `PACKAGE_CONFLICT_GLOBAL_CLASS`, `PACKAGE_CONFLICT_UID`,
  `PACKAGE_CONFLICT_PATH`, `PACKAGE_CONFLICT_ENTITY_ID`, plus
  `PACKAGE_INCOMPATIBLE_BASE`, `PACKAGE_INCOMPATIBLE_BASE_VERSION`,
  `PACKAGE_INCOMPATIBLE_ENGINE`, `PACKAGE_INCOMPATIBLE_STATE_FORMAT`;
- only the input action may be remapped, and only with
  `options.allowInputActionRemap: true`; nothing is silently overwritten;
- `localOverrides: []` is the empty per-instance override baseline.

The plan result is data (`applied: false`). Executing it is R3's materializer
inside a draft, followed by C/R2 candidate and formal application. This module
never writes a world, a project file or a database row.

## 4 Entry points

Rust (register with R1): `package.formatCheck`, `package.planInstall`.
JS: `plugins/craftmine-world/package-format.mjs`,
`plugins/craftmine-world/package-zip.mjs`. The service wiring and RPC
registration patch is `docs/dispatch-reports/godot-round2/R4/REGISTRATION_R4.md`.

## 5 Open CP0 decisions that need R1/R6 co-freeze

1. **Unicode normalization.** Rust has no normalization crate in the workspace.
   The frozen rule therefore refuses characters that could normalize
   differently instead of normalizing. If R1 adds a shared normalization
   dependency, the rule can be relaxed in a new format version; the vectors must
   be extended first.
2. **Integer-only canonical numbers.** A data pack that needs fractional values
   must encode them as strings. If R1/R6 require real floats, a shared
   canonical float algorithm has to be frozen and added to the vectors before
   any package is published.
3. **`content.interfaces` shape.** The planner reads `inputActions`,
   `autoloads`, `globalClasses`, `uids`, `paths` and `content.entry.entities`
   from the resource manifest. This minimal shape is frozen here for the
   planner and the ZIP layer; R3 must confirm it is what the materializer
   consumes.
4. **Resource-relative vs package-relative paths.** `manifest.content.files[]`
   uses resource-relative `payload/...`; `package.json` uses package-relative
   `resources/<contentHash>/...`. Both layers already implement this; R1 must
   keep it when the storage layer is registered.
