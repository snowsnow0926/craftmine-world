// Canonical `craftmine.assets-lock/1` document.
//
// There is exactly one lock shape in the product. The Rust definition lives in
// `crates/craftmine-core/src/content_history/contract.rs` (`AssetLock`) and is
// consumed by the content history, the asset catalog and the package installer.
// This module is the JavaScript mirror so the package layer, the client and the
// tests validate and hash the *same* document instead of a second, competing
// `{direct, closure, graph}` structure that reused the same format id.
//
// Contract (identical error codes on both sides):
//   - file name `craftmine.assets.lock.json`, format `craftmine.assets-lock/1`;
//   - document `{format, assets[]}`, entry
//     `{asset:{assetId,version,contentHash}, installPath, files[], dependencies[], overrides[]}`;
//   - stored paths are relative, forward-slash, <=240 bytes, <=16 segments,
//     <=80 bytes per segment, no traversal, no device names, no `.git`;
//   - one version per assetId; identical duplicates collapse; conflicting
//     duplicates are `ASSET_LOCK_VERSION_CONFLICT`;
//   - every dependency must resolve to an entry with the *same* AssetRef
//     (`ASSET_LOCK_DEPENDENCY_UNRESOLVED`), and dependency cycles are refused;
//   - canonical text is pretty JSON with two-space indentation, LF endings and
//     exactly one trailing newline; `assetLockHash` is SHA-256 of those bytes.

import {createHash} from 'node:crypto';

export const ASSET_LOCK_FORMAT = 'craftmine.assets-lock/1';
export const ASSET_LOCK_FILE = 'craftmine.assets.lock.json';

const PATH_BYTE_LIMIT = 240;
const PATH_SEGMENT_LIMIT = 16;
const PATH_PART_LIMIT = 80;
const LOCK_BYTE_LIMIT = 8 * 1024 * 1024;

const DOCUMENT_KEYS = ['format', 'assets'];
const ENTRY_KEYS = ['asset', 'installPath', 'files', 'dependencies', 'overrides'];
const ASSET_KEYS = ['assetId', 'version', 'contentHash'];
const FILE_KEYS = ['path', 'sha256', 'bytes', 'mediaType'];
const OVERRIDE_KEYS = ['scope', 'path', 'contentHash'];

/** The shape R4 used before the contract was unified. It is refused, never guessed. */
const LEGACY_KEYS = ['direct', 'closure', 'graph'];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(text) {
  return Buffer.byteLength(text, 'utf8');
}

/** Unknown keys get UNKNOWN_FIELD; a missing or wrongly typed field is
 * INVALID_ASSET_LOCK, exactly like `serde_json::from_value::<AssetLock>`. */
function assertKnownKeys(value, allowed, label) {
  if (!isObject(value)) throw fail('INVALID_ASSET_LOCK');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw fail(`UNKNOWN_FIELD: ${label}.${key}`);
  }
}

function requireString(value, code = 'INVALID_ASSET_LOCK') {
  if (typeof value !== 'string') throw fail(code);
  return value;
}

function optionalArray(value, code = 'INVALID_ASSET_LOCK') {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw fail(code);
  return value;
}

function reservedDeviceName(part) {
  const stem = part.split('.')[0].toUpperCase();
  if (['CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'].includes(stem)) return true;
  return stem.length === 4 && (stem.startsWith('COM') || stem.startsWith('LPT')) && stem[3] >= '0' && stem[3] <= '9';
}

export function validateIdentifier(value, code) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 120
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/.test(value)
    || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw fail(code);
  }
  return value;
}

export function validateSha256(hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw fail('INVALID_SHA256');
  return hash;
}

/** Mirrors `content_history::contract::validate_relative_path`. */
export function validateRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || byteLength(value) > PATH_BYTE_LIMIT) {
    throw fail('INVALID_RELATIVE_PATH');
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes(':')) throw fail('PATH_NOT_RELATIVE');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) throw fail('INVALID_RELATIVE_PATH');
  const parts = value.split('/');
  if (parts.length > PATH_SEGMENT_LIMIT || parts.length === 0) throw fail('PATH_TOO_DEEP');
  for (const part of parts) {
    if (part.length === 0 || byteLength(part) > PATH_PART_LIMIT) throw fail('INVALID_RELATIVE_PATH');
    if (part === '.' || part === '..') throw fail('PATH_TRAVERSAL');
    if (part.startsWith(' ') || part.endsWith(' ') || part.endsWith('.')) throw fail('INVALID_RELATIVE_PATH');
    if (/[<>"|?*\u0000]/.test(part)) throw fail('INVALID_RELATIVE_PATH');
    if (reservedDeviceName(part)) throw fail('PATH_RESERVED_NAME');
    if (part.toLowerCase() === '.git' || part.toLowerCase() === 'git~1') throw fail('PATH_TRAVERSAL');
  }
  return value;
}

/** Case-insensitive collision check across a set of paths. */
export function detectPathCollisions(paths) {
  const seen = new Map();
  for (const path of paths) {
    validateRelativePath(path);
    const key = path.toLowerCase();
    if (seen.has(key) && seen.get(key) !== path) throw fail('PATH_COLLISION');
    seen.set(key, path);
  }
  return true;
}

export function validateAssetRef(ref) {
  assertKnownKeys(ref, ASSET_KEYS, 'asset');
  requireString(ref.assetId);
  requireString(ref.version);
  requireString(ref.contentHash);
  validateIdentifier(ref.assetId, 'INVALID_ASSET_ID');
  validateIdentifier(ref.version, 'INVALID_ASSET_VERSION');
  const lowered = ref.version.toLowerCase();
  if (lowered === 'latest' || lowered === 'head') throw fail('ASSET_LOCK_MUTABLE_VERSION');
  validateSha256(ref.contentHash);
  return {assetId: ref.assetId, version: ref.version, contentHash: ref.contentHash};
}

export function validateFileRef(file) {
  assertKnownKeys(file, FILE_KEYS, 'file');
  requireString(file.path);
  requireString(file.sha256);
  requireString(file.mediaType);
  if (!Number.isInteger(file.bytes) || file.bytes < 0) throw fail('INVALID_ASSET_LOCK');
  validateRelativePath(file.path);
  validateSha256(file.sha256);
  if (file.mediaType.length === 0
    || file.mediaType.length > 120
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/.test(file.mediaType)) {
    throw fail('INVALID_MEDIA_TYPE');
  }
  return {path: file.path, sha256: file.sha256, bytes: file.bytes, mediaType: file.mediaType};
}

export function validateOverrideRef(override) {
  assertKnownKeys(override, OVERRIDE_KEYS, 'override');
  requireString(override.scope);
  requireString(override.path);
  requireString(override.contentHash);
  validateIdentifier(override.scope, 'INVALID_OVERRIDE_SCOPE');
  validateRelativePath(override.path);
  validateSha256(override.contentHash);
  return {scope: override.scope, path: override.path, contentHash: override.contentHash};
}

export function validateAssetLockEntry(entry) {
  assertKnownKeys(entry, ENTRY_KEYS, 'entry');
  const asset = validateAssetRef(entry.asset);
  requireString(entry.installPath);
  validateRelativePath(entry.installPath);
  const normalizedFiles = optionalArray(entry.files).map(validateFileRef);
  detectPathCollisions(normalizedFiles.map((file) => file.path));
  const normalizedDependencies = optionalArray(entry.dependencies).map(validateAssetRef);
  const normalizedOverrides = optionalArray(entry.overrides).map(validateOverrideRef);
  const scopes = new Map();
  for (const override of normalizedOverrides) {
    const key = `${override.scope.toLowerCase()}\u0000${override.path.toLowerCase()}`;
    if (scopes.has(key) && scopes.get(key) !== override.path) throw fail('PATH_COLLISION');
    scopes.set(key, override.path);
  }
  return {asset, installPath: entry.installPath, files: normalizedFiles,
    dependencies: normalizedDependencies, overrides: normalizedOverrides};
}

function key(asset) {
  return `${asset.assetId}\u0000${asset.version}`;
}

function compare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameAsset(left, right) {
  return left.assetId === right.assetId
    && left.version === right.version
    && left.contentHash === right.contentHash;
}

/**
 * Validate and canonicalize a lock document. Returns a fresh, sorted object;
 * the input is never mutated. Idempotent: canonical input stays byte-identical.
 */
export function validateAssetLock(lock) {
  if (isObject(lock) && LEGACY_KEYS.some((legacy) => Object.prototype.hasOwnProperty.call(lock, legacy))) {
    // The old R4 document carried no content hash, so it cannot be converted
    // faithfully. The supported migration is to re-plan the install from the
    // package's resource manifests (`package.planInstall`), which produces this
    // canonical lock.
    throw fail('ASSET_LOCK_LEGACY_SHAPE');
  }
  assertKnownKeys(lock, DOCUMENT_KEYS, 'lock');
  requireString(lock.format);
  if (!Array.isArray(lock.assets)) throw fail('INVALID_ASSET_LOCK');
  if (lock.format !== ASSET_LOCK_FORMAT) throw fail('ASSET_LOCK_FORMAT_MISMATCH');

  const known = new Map();
  const normalized = [];
  for (const raw of lock.assets) {
    const entry = validateAssetLockEntry(raw);
    const entryKey = key(entry.asset);
    if (known.has(entryKey)) {
      if (!sameAsset(known.get(entryKey), entry.asset)) {
        throw fail(`ASSET_LOCK_VERSION_CONFLICT: ${entry.asset.assetId}/${entry.asset.version}`);
      }
    } else {
      known.set(entryKey, entry.asset);
    }
    normalized.push(entry);
  }

  for (const entry of normalized) {
    entry.files.sort((left, right) => compare(left.path, right.path));
    entry.files = entry.files.filter((file, index) => index === 0 || file.path !== entry.files[index - 1].path);
    entry.dependencies.sort((left, right) => compare(key(left), key(right)));
    entry.dependencies = entry.dependencies.filter((dependency, index) => index === 0
      || key(dependency) !== key(entry.dependencies[index - 1]));
    entry.overrides.sort((left, right) => compare(`${left.scope}\u0000${left.path}`, `${right.scope}\u0000${right.path}`));
    entry.overrides = entry.overrides.filter((override, index) => index === 0
      || override.scope !== entry.overrides[index - 1].scope
      || override.path !== entry.overrides[index - 1].path);
  }
  normalized.sort((left, right) => compare(key(left.asset), key(right.asset))
    || compare(left.installPath, right.installPath));
  const assets = normalized.filter((entry, index) => index === 0 || !sameEntry(entry, normalized[index - 1]));

  for (const entry of assets) {
    for (const dependency of entry.dependencies) {
      const resolved = known.get(key(dependency));
      if (!resolved || !sameAsset(resolved, dependency)) {
        throw fail(`ASSET_LOCK_DEPENDENCY_UNRESOLVED: ${dependency.assetId}/${dependency.version}`);
      }
    }
  }
  assertNoCycle(assets);
  return {format: ASSET_LOCK_FORMAT, assets};
}

function sameEntry(left, right) {
  return sameAsset(left.asset, right.asset) && left.installPath === right.installPath
    && JSON.stringify(left.files) === JSON.stringify(right.files)
    && JSON.stringify(left.dependencies) === JSON.stringify(right.dependencies)
    && JSON.stringify(left.overrides) === JSON.stringify(right.overrides);
}

function assertNoCycle(assets) {
  const byKey = new Map(assets.map((entry) => [key(entry.asset), entry]));
  const state = new Map();
  const stack = [];
  const visit = (entry) => {
    const entryKey = key(entry.asset);
    const seen = state.get(entryKey) ?? 0;
    if (seen === 2) return;
    if (seen === 1) {
      const label = (asset) => `${asset.assetId}/${asset.version}`;
      const start = stack.findIndex((item) => key(item) === entryKey);
      throw fail(`ASSET_LOCK_DEPENDENCY_CYCLE: ${stack.slice(start).map(label).concat(label(entry.asset)).join(' -> ')}`);
    }
    state.set(entryKey, 1);
    stack.push(entry.asset);
    for (const dependency of entry.dependencies) {
      const target = byKey.get(key(dependency));
      if (target) visit(target);
    }
    stack.pop();
    state.set(entryKey, 2);
  };
  for (const entry of assets) visit(entry);
}

/** serde_json `to_string_pretty` compatible serialization. */
export function prettyJSON(value, depth = 0) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw fail('PACKAGE_NUMBER_OUT_OF_RANGE');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => `${inner}${prettyJSON(item, depth + 1)}`).join(',\n')}\n${pad}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((entry) => `${inner}${JSON.stringify(entry)}: ${prettyJSON(value[entry], depth + 1)}`).join(',\n')}\n${pad}}`;
  }
  throw fail('INVALID_JSON_VALUE');
}

/** Canonical lock text: pretty JSON, LF endings, exactly one trailing newline. */
export function canonicalLockText(lock) {
  return `${prettyJSON(validateAssetLock(lock))}\n`;
}

export function canonicalLockBytes(lock) {
  return Buffer.from(canonicalLockText(lock), 'utf8');
}

export function assetLockHash(lock) {
  return createHash('sha256').update(canonicalLockBytes(lock)).digest('hex');
}

/** Parse arbitrary bytes exactly like `AssetLock::parse`. */
export function parseAssetLock(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.byteLength > LOCK_BYTE_LIMIT) throw fail('ASSET_LOCK_TOO_LARGE');
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
  } catch {
    throw fail('ASSET_LOCK_NOT_UTF8');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail('INVALID_ASSET_LOCK');
  }
  return validateAssetLock(parsed);
}

/** Parse and require the stored bytes to already be canonical. */
export function parseCanonicalAssetLock(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const lock = parseAssetLock(buffer);
  if (!canonicalLockBytes(lock).equals(buffer)) throw fail('ASSET_LOCK_NOT_CANONICAL');
  return lock;
}

/** Build a canonical lock from entries (installer output). */
export function buildAssetLock(entries) {
  return validateAssetLock({format: ASSET_LOCK_FORMAT, assets: entries});
}

/**
 * Convert one package dependency declaration (`craftmine.resource/1`
 * `content.dependencies[]`, a *different* schema) into a canonical AssetRef.
 * The package rule accepts uppercase hex and normalizes it, exactly like the
 * Rust `hash_field`; the canonical AssetRef itself requires lowercase.
 */
export function dependencyToAssetRef(dependency) {
  assertKnownKeys(dependency, ['id', 'version', 'sha256'], 'dependency');
  if (typeof dependency.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(dependency.id)) {
    throw fail('INVALID_ASSET_ID');
  }
  const version = dependency.version;
  if (!Number.isInteger(version) || version <= 0 || version > 100000) throw fail('INVALID_VERSION');
  if (typeof dependency.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(dependency.sha256)) {
    throw fail('INVALID_HASH');
  }
  return validateAssetRef({
    assetId: dependency.id,
    version: String(version),
    contentHash: dependency.sha256.toLowerCase(),
  });
}

/**
 * Media type for an asset-relative payload path. The package manifest does not
 * carry a media type, so the conversion to a canonical FileRef derives it from
 * the extension with a fixed table (no MIME sniffing, no guessing by content).
 */
const MEDIA_TYPES = [
  ['.gd', 'text/x-gdscript'],
  ['.gdshader', 'text/x-gdshader'],
  ['.tscn', 'application/x-godot-scene'],
  ['.tres', 'application/x-godot-resource'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.csv', 'text/csv'],
  ['.md', 'text/markdown'],
  ['.txt', 'text/plain'],
  ['.cfg', 'text/plain'],
  ['.godot', 'text/plain'],
];

export function mediaTypeForPath(path) {
  const lowered = String(path).toLowerCase();
  const index = lowered.lastIndexOf('.');
  const extension = index < 0 ? '' : lowered.slice(index);
  for (const [suffix, mediaType] of MEDIA_TYPES) {
    if (extension === suffix) return mediaType;
  }
  return 'application/octet-stream';
}
