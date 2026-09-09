/**
 * CP1 static package ZIP layer.
 *
 * Pure, offline module. The only Node built-in it imports is `node:zlib`
 * (raw deflate/inflate); SHA-256 and CRC-32 are implemented in this file so
 * the package identity never depends on the host crypto module.
 *
 * The canonical JSON / path / resource-manifest rules are the CP0 contract.
 * When `./package-format.mjs` exists it is imported lazily at module load and
 * used directly; otherwise an in-file fallback with the same exported names is
 * used so the ZIP layer and its test are self-contained.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Limits and error helpers
// ---------------------------------------------------------------------------

export const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 4096,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxCompressedBytes: 256 * 1024 * 1024,
  maxDepth: 32,
  maxNameBytes: 240,
  maxRatio: 200,
});

const PACKAGE_FORMAT = 'craftmine.package/1';
const RESOURCE_FORMAT = 'craftmine.resource/1';
// Must equal `ASSET_LOCK_FORMAT` in ./asset-lock.mjs and the Rust
// `content_history::contract::ASSET_LOCK_FORMAT`. This module stays free of
// node:crypto, so the single definition is enforced by
// tests/godot-round3/S3/asset-lock.test.mjs instead of an import.
export const LOCK_FORMAT = 'craftmine.assets-lock/1';
const KINDS = Object.freeze(['base', 'world', 'module', 'object', 'scene', 'raw', 'data']);
const MAX_PATH_BYTES = 240;
const MAX_ASSET_ID_BYTES = 80;
const MAX_VERSION = 100000;
const DEVICES = Object.freeze([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const DOS_TIME = 0x0000; // 1980-01-01 00:00:00, fixed for deterministic output
const DOS_DATE = 0x0021;
const UTF8_FLAG = 0x0800;

function fail(code, detail) {
  const error = new Error(detail === undefined ? code : `${code}: ${detail}`);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// SHA-256 (self-contained) and CRC-32
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value, shift) {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

function sha256Hex(input) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const totalBits = data.length * 8;
  const paddedLength = (((data.length + 9 + 63) >> 6) << 6);
  const block = Buffer.alloc(paddedLength);
  data.copy(block);
  block[data.length] = 0x80;
  block.writeUInt32BE(Math.floor(totalBits / 4294967296), paddedLength - 8);
  block.writeUInt32BE(totalBits >>> 0, paddedLength - 4);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = block.readUInt32BE(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  let out = '';
  for (const value of [h0, h1, h2, h3, h4, h5, h6, h7]) {
    out += value.toString(16).padStart(8, '0');
  }
  return out;
}

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Fallback CP0 format rules (used only when package-format.mjs is absent)
// ---------------------------------------------------------------------------

function quoteCanonical(text) {
  let out = '"';
  for (const character of text) {
    const code = character.codePointAt(0);
    if (character === '"') out += '\\"';
    else if (character === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x09) out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += character;
  }
  return `${out}"`;
}

function canonicalValue(value) {
  let out = '';
  const emit = (item) => {
    if (item === null) {
      out += 'null';
      return;
    }
    const type = typeof item;
    if (type === 'boolean') {
      out += item ? 'true' : 'false';
      return;
    }
    if (type === 'number') {
      if (!Number.isInteger(item)) throw fail('PACKAGE_FLOAT_NOT_CANONICAL');
      if (!Number.isSafeInteger(item)) throw fail('PACKAGE_NUMBER_OUT_OF_RANGE');
      out += item === 0 ? '0' : String(item);
      return;
    }
    if (type === 'string') {
      out += quoteCanonical(item);
      return;
    }
    if (Array.isArray(item)) {
      out += '[';
      item.forEach((entry, index) => {
        if (index > 0) out += ',';
        emit(entry);
      });
      out += ']';
      return;
    }
    if (isPlainObject(item)) {
      const keys = Object.keys(item).sort();
      out += '{';
      keys.forEach((key, index) => {
        if (index > 0) out += ',';
        out += `${quoteCanonical(key)}:`;
        emit(item[key]);
      });
      out += '}';
      return;
    }
    throw fail('INVALID_JSON');
  };
  emit(value);
  return out;
}

function contentHashValue(value) {
  return sha256Hex(Buffer.from(canonicalValue(value), 'utf8'));
}

function pathNeedsNormalization(character) {
  const code = character.codePointAt(0);
  return (code >= 0x0300 && code <= 0x036f)
    || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff)
    || (code >= 0x20d0 && code <= 0x20ff)
    || (code >= 0xfe20 && code <= 0xfe2f)
    || code === 0x2126
    || code === 0x212a
    || code === 0x212b
    || (code >= 0xfb00 && code <= 0xfb06);
}

function validatePath(path) {
  if (typeof path !== 'string' || path.length === 0 || Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES) {
    throw fail('INVALID_PACKAGE_PATH');
  }
  if (path.includes('\\') || path.includes(':') || path.startsWith('/') || path.endsWith('/')) {
    throw fail('INVALID_PACKAGE_PATH');
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') throw fail('INVALID_PACKAGE_PATH');
    const stem = segment.split('.')[0];
    if (DEVICES.some((device) => stem.toLowerCase() === device.toLowerCase())) {
      throw fail('INVALID_PACKAGE_PATH');
    }
    for (const character of segment) {
      if (pathNeedsNormalization(character)) throw fail('PACKAGE_PATH_NEEDS_NORMALIZATION');
    }
  }
  return true;
}

function checkFields(value, allowed) {
  if (!isPlainObject(value)) throw fail('OBJECT_REQUIRED');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw fail('UNKNOWN_FIELD', key);
  }
}

function checkHash(value, key) {
  const text = isPlainObject(value) ? value[key] : undefined;
  if (typeof text !== 'string' || !/^[0-9a-fA-F]{64}$/.test(text)) throw fail('INVALID_HASH', key);
  return text.toLowerCase();
}

function checkAssetId(id) {
  if (typeof id !== 'string' || id.length === 0 || Buffer.byteLength(id, 'utf8') > MAX_ASSET_ID_BYTES
    || !/^[a-z0-9._-]+$/.test(id)) {
    throw fail('INVALID_ASSET_ID');
  }
  return id;
}

function checkVersion(version) {
  if (!Number.isInteger(version) || version <= 0 || version > MAX_VERSION) throw fail('INVALID_VERSION');
  return version;
}

function fallbackFileReference(value) {
  checkFields(value, ['path', 'bytes', 'sha256']);
  if (typeof value.path !== 'string') throw fail('PATH_REQUIRED');
  validatePath(value.path);
  if (!Number.isInteger(value.bytes) || value.bytes < 0) throw fail('BYTES_REQUIRED');
  return { path: value.path, bytes: value.bytes, sha256: checkHash(value, 'sha256') };
}

function fallbackAssetReference(value) {
  checkFields(value, ['id', 'version', 'sha256']);
  return { id: checkAssetId(value.id), version: checkVersion(value.version), sha256: checkHash(value, 'sha256') };
}

function fallbackValidateResourceManifest(value) {
  checkFields(value, ['format', 'content', 'contentHash']);
  if (value.format !== RESOURCE_FORMAT) throw fail('INVALID_RESOURCE_FORMAT');
  const content = value.content;
  checkFields(content, [
    'assetId', 'version', 'kind', 'files', 'dependencies',
    'entry', 'interfaces', 'compatibility', 'state', 'licenses',
  ]);
  const assetId = checkAssetId(content.assetId);
  const version = checkVersion(content.version);
  if (typeof content.kind !== 'string' || !KINDS.includes(content.kind)) throw fail('INVALID_PACKAGE_KIND');
  if (!Array.isArray(content.files)) throw fail('FILES_REQUIRED');
  const files = [];
  const seenFiles = new Set();
  for (const item of content.files) {
    const reference = fallbackFileReference(item);
    const key = reference.path.normalize('NFC').toLowerCase();
    if (seenFiles.has(key)) throw fail('PACKAGE_DUPLICATE_ENTRY', reference.path);
    seenFiles.add(key);
    files.push(reference);
  }
  if (!Array.isArray(content.dependencies)) throw fail('DEPENDENCIES_REQUIRED');
  const dependencies = [];
  const seenDependencies = new Set();
  for (const item of content.dependencies) {
    const dependency = fallbackAssetReference(item);
    if (dependency.id === assetId) throw fail('PACKAGE_SELF_DEPENDENCY');
    const key = `${dependency.id}@${dependency.version}`;
    if (seenDependencies.has(key)) throw fail('PACKAGE_DUPLICATE_DEPENDENCY');
    seenDependencies.add(key);
    dependencies.push(dependency);
  }
  for (const key of ['entry', 'interfaces', 'compatibility', 'state', 'licenses']) {
    if (!isPlainObject(content[key])) throw fail('RESOURCE_SECTION_REQUIRED', key);
  }
  const normalized = {
    assetId,
    version,
    kind: content.kind,
    files,
    dependencies,
    entry: content.entry,
    interfaces: content.interfaces,
    compatibility: content.compatibility,
    state: content.state,
    licenses: content.licenses,
  };
  const expected = contentHashValue(normalized);
  if (value.contentHash !== expected) throw fail('RESOURCE_CONTENT_HASH_MISMATCH');
  return { format: RESOURCE_FORMAT, content: normalized, contentHash: expected };
}

const FALLBACK_FORMAT = Object.freeze({
  PACKAGE_FORMAT,
  RESOURCE_FORMAT,
  LOCK_FORMAT,
  validatePath,
  canonicalValue,
  contentHash: contentHashValue,
  validateResourceManifest: fallbackValidateResourceManifest,
});

const REQUIRED_FORMAT_EXPORTS = ['validatePath', 'canonicalValue', 'contentHash', 'validateResourceManifest'];

let formatApi = FALLBACK_FORMAT;
let formatBackend = 'builtin-fallback';
try {
  const loaded = await import('./package-format.mjs');
  if (REQUIRED_FORMAT_EXPORTS.every((name) => typeof loaded[name] === 'function')) {
    formatApi = loaded;
    formatBackend = 'package-format.mjs';
  }
} catch {
  formatApi = FALLBACK_FORMAT;
  formatBackend = 'builtin-fallback';
}

/** Which CP0 rule source is active: `package-format.mjs` or `builtin-fallback`. */
export const FORMAT_BACKEND = formatBackend;

function formatPathValid(name) {
  try {
    const result = formatApi.validatePath(name);
    if (result === false) return false;
    if (result && typeof result === 'object' && result.ok === false) return false;
    return true;
  } catch {
    return false;
  }
}

function formatCanonical(value) {
  if (typeof formatApi.canonicalValue === 'function') {
    try {
      const text = formatApi.canonicalValue(value);
      if (typeof text === 'string') return text;
    } catch {
      // fall through to JSON.stringify
    }
  }
  return JSON.stringify(value);
}

function formatContentHash(value) {
  const result = formatApi.contentHash(value);
  if (typeof result === 'string') return result.toLowerCase();
  if (result && typeof result.hash === 'string') return result.hash.toLowerCase();
  throw fail('RESOURCE_CONTENT_HASH_MISMATCH');
}

function formatManifest(manifest) {
  const result = formatApi.validateResourceManifest(manifest);
  return isPlainObject(result) ? result : manifest;
}

function packageFormatName() {
  return typeof formatApi.PACKAGE_FORMAT === 'string' ? formatApi.PACKAGE_FORMAT : PACKAGE_FORMAT;
}

function resourceFormatName() {
  return typeof formatApi.RESOURCE_FORMAT === 'string' ? formatApi.RESOURCE_FORMAT : RESOURCE_FORMAT;
}

// ---------------------------------------------------------------------------
// ZIP writer
// ---------------------------------------------------------------------------

function compareEntryNames(left, right) {
  if (left === right) return 0;
  if (left === 'package.json') return -1;
  if (right === 'package.json') return 1;
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function writeZip(entries, { compress = true } = {}) {
  if (!Array.isArray(entries)) throw fail('ZIP_BAD_CENTRAL_DIRECTORY', 'entries');
  const seen = new Set();
  const prepared = entries.map((entry) => {
    if (!isPlainObject(entry) || typeof entry.name !== 'string') {
      throw fail('ZIP_BAD_CENTRAL_DIRECTORY', 'entry');
    }
    if (!formatPathValid(entry.name)) throw fail('INVALID_PACKAGE_PATH', entry.name);
    const key = entry.name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw fail('ZIP_DUPLICATE_ENTRY', entry.name);
    seen.add(key);
    const raw = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes ?? []);
    const shouldCompress = entry.compress === undefined ? Boolean(compress) : Boolean(entry.compress);
    const method = shouldCompress ? 8 : 0;
    const data = method === 8 ? deflateRawSync(raw, { level: 9 }) : raw;
    return { name: entry.name, raw, data, method, crc: crc32(raw) };
  });
  prepared.sort((left, right) => compareEntryNames(left.name, right.name));

  const chunks = [];
  const central = [];
  let offset = 0;
  for (const item of prepared) {
    const nameBuffer = Buffer.from(item.name, 'utf8');
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(item.method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(item.crc, 14);
    local.writeUInt32LE(item.data.length, 18);
    local.writeUInt32LE(item.raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    chunks.push(local, item.data);

    const header = Buffer.alloc(46 + nameBuffer.length);
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    header.writeUInt16LE(0x0014, 4); // version made by: MS-DOS host, no unix mode
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(item.method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(item.crc, 16);
    header.writeUInt32LE(item.data.length, 20);
    header.writeUInt32LE(item.raw.length, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    nameBuffer.copy(header, 46);
    central.push(header);
    offset += local.length + item.data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(prepared.length, 8);
  end.writeUInt16LE(prepared.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, directory, end]);
}

// ---------------------------------------------------------------------------
// ZIP reader
// ---------------------------------------------------------------------------

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= minimum; i -= 1) {
    if (i >= 0 && buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

export function readZip(bytes, limits = DEFAULT_LIMITS) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const effective = { ...DEFAULT_LIMITS, ...(limits || {}) };

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw fail('ZIP_BAD_CENTRAL_DIRECTORY');
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const directoryDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || directoryDisk !== 0) throw fail('ZIP_MULTI_DISK');
  if (entriesOnDisk !== totalEntries) throw fail('ZIP_BAD_CENTRAL_DIRECTORY');
  if (totalEntries > effective.maxEntries) throw fail('ZIP_TOO_MANY_ENTRIES');
  if (directoryOffset + directorySize > buffer.length) throw fail('ZIP_BAD_CENTRAL_DIRECTORY');

  const directoryEnd = directoryOffset + directorySize;
  const records = [];
  const seenNames = new Set();
  let position = directoryOffset;
  let declaredTotal = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (position + 46 > directoryEnd) throw fail('ZIP_BAD_CENTRAL_DIRECTORY');
    if (buffer.readUInt32LE(position) !== CENTRAL_SIGNATURE) throw fail('ZIP_BAD_CENTRAL_DIRECTORY');
    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const crc = buffer.readUInt32LE(position + 16);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const uncompressedSize = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const diskStart = buffer.readUInt16LE(position + 34);
    const externalAttributes = buffer.readUInt32LE(position + 38);
    const localOffset = buffer.readUInt32LE(position + 42);
    const recordEnd = position + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > directoryEnd || recordEnd > buffer.length) throw fail('ZIP_BAD_CENTRAL_DIRECTORY');
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');

    if (diskStart !== 0) throw fail('ZIP_MULTI_DISK', name);
    if ((flags & 0x0001) !== 0) throw fail('ZIP_ENCRYPTED_ENTRY', name);
    if (method !== 0 && method !== 8) throw fail('ZIP_UNSUPPORTED_METHOD', name);
    if (!formatPathValid(name)) throw fail('INVALID_PACKAGE_PATH', name);
    if (nameLength > effective.maxNameBytes) throw fail('ZIP_NAME_TOO_LONG', name);
    if (name.split('/').length > effective.maxDepth) throw fail('ZIP_PATH_TOO_DEEP', name);
    if (uncompressedSize > effective.maxEntryBytes) throw fail('ZIP_ENTRY_TOO_LARGE', name);
    if (compressedSize > effective.maxCompressedBytes) throw fail('ZIP_COMPRESSED_TOO_LARGE', name);
    declaredTotal += uncompressedSize;
    if (declaredTotal > effective.maxTotalBytes) throw fail('ZIP_TOTAL_TOO_LARGE', name);
    if (uncompressedSize > 0
      && (compressedSize === 0 || uncompressedSize > compressedSize * effective.maxRatio)) {
      throw fail('ZIP_RATIO_EXCEEDED', name);
    }
    if ((((externalAttributes >>> 16) & 0xf000) === 0xa000)) throw fail('ZIP_SYMLINK_ENTRY', name);
    const collisionKey = name.normalize('NFC').toLowerCase();
    if (seenNames.has(collisionKey)) throw fail('ZIP_DUPLICATE_ENTRY', name);
    seenNames.add(collisionKey);

    records.push({
      name, method, crc, compressedSize, uncompressedSize, localOffset,
    });
    position = recordEnd;
  }

  const entries = [];
  let actualTotal = 0;
  for (const record of records) {
    const local = record.localOffset;
    if (local + 30 > buffer.length) throw fail('ZIP_TRUNCATED_ENTRY', record.name);
    if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) throw fail('ZIP_TRUNCATED_ENTRY', record.name);
    const localNameLength = buffer.readUInt16LE(local + 26);
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + record.compressedSize;
    if (dataEnd > buffer.length) throw fail('ZIP_TRUNCATED_ENTRY', record.name);
    const compressed = buffer.subarray(dataStart, dataEnd);

    let output;
    if (record.method === 0) {
      if (record.compressedSize !== record.uncompressedSize) throw fail('ZIP_TRUNCATED_ENTRY', record.name);
      output = Buffer.from(compressed);
    } else {
      const cap = Math.min(record.uncompressedSize || effective.maxEntryBytes, effective.maxEntryBytes);
      try {
        output = inflateRawSync(compressed, { maxOutputLength: Math.max(cap, 1) });
      } catch (error) {
        if (error && error.code === 'ERR_BUFFER_TOO_LARGE') throw fail('ZIP_ENTRY_TOO_LARGE', record.name);
        throw fail('ZIP_TRUNCATED_ENTRY', record.name);
      }
    }
    if (output.length !== record.uncompressedSize) throw fail('ZIP_TRUNCATED_ENTRY', record.name);
    if (crc32(output) !== record.crc) throw fail('ZIP_CRC_MISMATCH', record.name);
    actualTotal += output.length;
    if (actualTotal > effective.maxTotalBytes) throw fail('ZIP_TOTAL_TOO_LARGE', record.name);

    entries.push({
      name: record.name,
      method: record.method,
      compressedSize: record.compressedSize,
      uncompressedSize: record.uncompressedSize,
      crc32: record.crc,
      bytes: output,
    });
  }
  return { entries };
}

// ---------------------------------------------------------------------------
// Static package assembly
// ---------------------------------------------------------------------------

function referenceSha256(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
}

function previewName(key) {
  const name = key.startsWith('previews/') ? key : `previews/${key}`;
  if (!formatPathValid(name)) throw fail('INVALID_PACKAGE_PATH', name);
  return name;
}

function fileReference(path, bytes) {
  return { path, bytes: bytes.length, sha256: sha256Hex(bytes) };
}

export function packStaticPackage({ root, resources, catalog, previews = {} } = {}) {
  if (!isPlainObject(root)) throw fail('PACKAGE_MISSING_DEPENDENCY', 'root');
  const rootId = typeof root.id === 'string' ? root.id : root.assetId;
  const rootVersion = root.version;
  if (typeof rootId !== 'string' || !Number.isInteger(rootVersion)) {
    throw fail('PACKAGE_MISSING_DEPENDENCY', 'root');
  }
  if (!Array.isArray(resources) || resources.length === 0) {
    throw fail('PACKAGE_MISSING_DEPENDENCY', 'resources');
  }

  const packed = resources.map((resource) => {
    if (!isPlainObject(resource) || !isPlainObject(resource.manifest)) {
      throw fail('PACKAGE_MISSING_FILE', 'manifest');
    }
    const manifest = formatManifest(resource.manifest);
    if (manifest.format !== undefined && manifest.format !== resourceFormatName()) {
      throw fail('INVALID_RESOURCE_FORMAT');
    }
    const content = manifest.content;
    if (!isPlainObject(content)) throw fail('PACKAGE_MISSING_FILE', 'content');
    const contentHash = referenceSha256(manifest.contentHash) || formatContentHash(content);
    const files = isPlainObject(resource.files) ? resource.files : {};
    const declared = Array.isArray(content.files) ? content.files : [];
    const declaredPaths = new Set(declared.map((reference) => reference && reference.path));
    for (const key of Object.keys(files)) {
      if (!declaredPaths.has(key)) throw fail('PACKAGE_ENTRY_NOT_LISTED', key);
    }
    const payloads = [];
    for (const reference of declared) {
      if (!isPlainObject(reference) || typeof reference.path !== 'string') {
        throw fail('PACKAGE_MISSING_FILE', 'file reference');
      }
      const data = files[reference.path];
      if (data === undefined) throw fail('PACKAGE_MISSING_FILE', reference.path);
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (bytes.length !== reference.bytes || sha256Hex(bytes) !== referenceSha256(reference.sha256)) {
        throw fail('PACKAGE_FILE_HASH_MISMATCH', reference.path);
      }
      payloads.push({ path: reference.path, bytes });
    }
    return { manifest, content, contentHash, payloads };
  });

  const rootResource = packed.find((item) => item.content.assetId === rootId);
  if (!rootResource || rootResource.content.version !== rootVersion) {
    throw fail('PACKAGE_MISSING_DEPENDENCY', `${rootId}@${rootVersion}`);
  }
  for (const item of packed) {
    for (const dependency of item.content.dependencies || []) {
      const found = packed.find((other) => other.content.assetId === dependency.id
        && other.content.version === dependency.version);
      if (!found) throw fail('PACKAGE_MISSING_DEPENDENCY', `${dependency.id}@${dependency.version}`);
      const expected = referenceSha256(dependency.sha256);
      if (expected && expected !== found.contentHash) {
        throw fail('PACKAGE_FILE_HASH_MISMATCH', `${dependency.id}@${dependency.version}`);
      }
    }
  }

  const entries = [];
  const declaredFiles = [];
  const resourceSummaries = [];

  for (const item of [...packed].sort((left, right) => left.contentHash.localeCompare(right.contentHash))) {
    const prefix = `resources/${item.contentHash}/`;
    const manifestBytes = Buffer.from(formatCanonical(item.manifest), 'utf8');
    const manifestPath = `${prefix}manifest.json`;
    entries.push({ name: manifestPath, bytes: manifestBytes });
    const resourceFiles = [fileReference(manifestPath, manifestBytes)];
    for (const payload of item.payloads) {
      const entryName = `${prefix}${payload.path}`;
      if (!formatPathValid(entryName)) throw fail('INVALID_PACKAGE_PATH', entryName);
      entries.push({ name: entryName, bytes: payload.bytes });
      resourceFiles.push(fileReference(entryName, payload.bytes));
    }
    resourceFiles.sort((left, right) => compareEntryNames(left.path, right.path));
    declaredFiles.push(...resourceFiles);
    resourceSummaries.push({
      contentHash: item.contentHash,
      manifest: item.manifest,
      files: resourceFiles,
    });
  }

  if (catalog !== undefined) {
    const catalogBytes = Buffer.from(formatCanonical(catalog), 'utf8');
    entries.push({ name: 'catalog.json', bytes: catalogBytes });
    declaredFiles.push(fileReference('catalog.json', catalogBytes));
  }

  if (isPlainObject(previews)) {
    for (const [key, value] of Object.entries(previews)) {
      const name = previewName(key);
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
      entries.push({ name, bytes });
      declaredFiles.push(fileReference(name, bytes));
    }
  }

  declaredFiles.sort((left, right) => compareEntryNames(left.path, right.path));
  resourceSummaries.sort((left, right) => left.contentHash.localeCompare(right.contentHash));

  const rootSha = referenceSha256(root.sha256) || rootResource.contentHash;
  const packageJson = {
    format: packageFormatName(),
    root: { id: rootId, version: rootVersion, sha256: rootSha },
    resources: resourceSummaries,
    files: declaredFiles,
  };
  entries.push({ name: 'package.json', bytes: Buffer.from(formatCanonical(packageJson), 'utf8') });
  return writeZip(entries);
}

// ---------------------------------------------------------------------------
// Static package unpacking
// ---------------------------------------------------------------------------

function requireDeclaredFile(byName, reference) {
  if (!isPlainObject(reference) || typeof reference.path !== 'string') {
    throw fail('PACKAGE_ENTRY_NOT_LISTED', 'file reference');
  }
  const bytes = byName.get(reference.path);
  if (!bytes) throw fail('PACKAGE_MISSING_FILE', reference.path);
  if (bytes.length !== reference.bytes || sha256Hex(bytes) !== referenceSha256(reference.sha256)) {
    throw fail('PACKAGE_FILE_HASH_MISMATCH', reference.path);
  }
  return bytes;
}

export function unpackStaticPackage(bytes, limits = DEFAULT_LIMITS) {
  const archive = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const { entries } = readZip(archive, limits);
  const byName = new Map(entries.map((entry) => [entry.name, entry.bytes]));

  const packageBytes = byName.get('package.json');
  if (!packageBytes) throw fail('PACKAGE_MISSING_FILE', 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(packageBytes.toString('utf8'));
  } catch {
    throw fail('PACKAGE_MISSING_FILE', 'package.json');
  }
  if (packageJson.format !== packageFormatName()) throw fail('INVALID_PACKAGE_FORMAT');
  if (!Array.isArray(packageJson.files)) throw fail('PACKAGE_ENTRY_NOT_LISTED', 'files');

  const declared = new Map();
  for (const reference of packageJson.files) {
    declared.set(reference && reference.path, requireDeclaredFile(byName, reference));
  }
  for (const entry of entries) {
    if (entry.name === 'package.json') continue;
    if (!declared.has(entry.name)) throw fail('PACKAGE_ENTRY_NOT_LISTED', entry.name);
  }

  const resources = [];
  for (const summary of Array.isArray(packageJson.resources) ? packageJson.resources : []) {
    const contentHash = referenceSha256(summary && summary.contentHash);
    if (!contentHash) throw fail('RESOURCE_CONTENT_HASH_MISMATCH', 'contentHash');
    const manifest = summary.manifest;
    if (!isPlainObject(manifest)) throw fail('PACKAGE_MISSING_FILE', 'manifest');
    if (manifest.format !== resourceFormatName()) throw fail('INVALID_RESOURCE_FORMAT');
    if (formatContentHash(manifest.content) !== contentHash) {
      throw fail('RESOURCE_CONTENT_HASH_MISMATCH', contentHash);
    }
    const prefix = `resources/${contentHash}/`;
    const manifestPath = `${prefix}manifest.json`;
    if (!byName.has(manifestPath)) throw fail('PACKAGE_MISSING_FILE', manifestPath);
    const files = new Map();
    for (const reference of Array.isArray(manifest.content.files) ? manifest.content.files : []) {
      const entryName = `${prefix}${reference.path}`;
      const data = byName.get(entryName);
      if (!data) throw fail('PACKAGE_MISSING_FILE', entryName);
      if (data.length !== reference.bytes || sha256Hex(data) !== referenceSha256(reference.sha256)) {
        throw fail('PACKAGE_FILE_HASH_MISMATCH', entryName);
      }
      files.set(reference.path, data);
    }
    resources.push({ contentHash, manifest, files });
  }

  const rootReference = isPlainObject(packageJson.root) ? packageJson.root : {};
  const rootResource = resources.find((resource) => resource.manifest.content.assetId === rootReference.id
    && resource.manifest.content.version === rootReference.version);
  if (!rootResource) throw fail('PACKAGE_MISSING_DEPENDENCY', `${rootReference.id}@${rootReference.version}`);

  const visited = new Set();
  const stack = [rootResource];
  while (stack.length > 0) {
    const current = stack.pop();
    const label = `${current.manifest.content.assetId}@${current.manifest.content.version}`;
    if (visited.has(label)) continue;
    visited.add(label);
    for (const dependency of current.manifest.content.dependencies || []) {
      const found = resources.find((resource) => resource.manifest.content.assetId === dependency.id
        && resource.manifest.content.version === dependency.version);
      if (!found) throw fail('PACKAGE_MISSING_DEPENDENCY', `${dependency.id}@${dependency.version}`);
      stack.push(found);
    }
  }

  let catalog;
  if (byName.has('catalog.json')) {
    try {
      catalog = JSON.parse(byName.get('catalog.json').toString('utf8'));
    } catch {
      throw fail('PACKAGE_MISSING_FILE', 'catalog.json');
    }
  }
  const previews = new Map();
  for (const [name, data] of byName) {
    if (name.startsWith('previews/')) previews.set(name.slice('previews/'.length), data);
  }

  const identity = archiveIdentity(archive);
  return {
    packageJson,
    resources,
    catalog,
    previews,
    archiveSha256: identity.archiveSha256,
    bytes: identity.bytes,
  };
}

export function archiveIdentity(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  return { bytes: buffer.length, archiveSha256: sha256Hex(buffer) };
}
