// On-disk part store: package files, the active-version index and the journal.
//
// Everything the store writes is either fully written or not written at all
// (write to a temporary file, then rename). The journal is append-only and is
// the record a human reads when a part misbehaves; the index is derived state
// that can be rebuilt from packages + journal.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PART_STORE_FORMAT, PART_JOURNAL_FORMAT, SAFE_RELATIVE_PATH, SHA256_PATTERN } from './formats.mjs';
import { canonicalJson, manifestDigest } from './manifest.mjs';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function emptyIndex() {
  return { format: PART_STORE_FORMAT, active: {}, history: {}, installed: [] };
}

export function createPartStore({ root }) {
  if (typeof root !== 'string' || root.trim().length === 0) throw new Error('部件库需要一个根目录');
  const rootDir = path.resolve(root);
  const indexFile = path.join(rootDir, 'index.json');
  const journalFile = path.join(rootDir, 'journal.jsonl');
  const packagesDir = path.join(rootDir, 'packages');

  function atomicWriteJson(file, value) {
    ensureDir(path.dirname(file));
    const temp = file + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, file);
  }

  function readIndex() {
    if (!fs.existsSync(indexFile)) return emptyIndex();
    const parsed = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (parsed?.format !== PART_STORE_FORMAT) throw new Error(`部件库索引格式不匹配：${parsed?.format}`);
    return parsed;
  }

  function writeIndex(index) {
    atomicWriteJson(indexFile, index);
    return index;
  }

  function appendJournal(entry) {
    ensureDir(rootDir);
    const record = { format: PART_JOURNAL_FORMAT, at: new Date().toISOString(), ...entry };
    fs.appendFileSync(journalFile, canonicalJson(record) + '\n', 'utf8');
    return record;
  }

  function readJournal() {
    if (!fs.existsSync(journalFile)) return [];
    return fs.readFileSync(journalFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  function packageDir(partId, version) {
    if (!SAFE_RELATIVE_PATH.test(`${partId}/${version}`)) throw new Error(`部件路径不合法：${partId}/${version}`);
    return path.join(packagesDir, partId, version);
  }

  function exists(partId, version) {
    return fs.existsSync(path.join(packageDir(partId, version), 'manifest.json'));
  }

  /** files: { '<relative path>': string | Buffer }. Returns the installed record. */
  function writePackage(manifest, files) {
    const dir = packageDir(manifest.partId, manifest.version);
    ensureDir(path.join(dir, 'files'));
    for (const file of manifest.files) {
      if (!Object.hasOwn(files, file.path)) throw new Error(`部件 ${manifest.partId}@${manifest.version} 缺少文件 ${file.path}`);
      const target = path.join(dir, 'files', file.path);
      const resolved = path.resolve(target);
      if (!resolved.startsWith(path.resolve(path.join(dir, 'files')) + path.sep)) {
        throw new Error(`文件路径逃逸：${file.path}`);
      }
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, files[file.path]);
    }
    atomicWriteJson(path.join(dir, 'manifest.json'), manifest);
    return { partId: manifest.partId, version: manifest.version, partKind: manifest.partKind, digest: manifestDigest(manifest) };
  }

  function readManifest(partId, version) {
    const file = path.join(packageDir(partId, version), 'manifest.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function readFileBytes(partId, version, relative) {
    if (!SAFE_RELATIVE_PATH.test(relative)) throw new Error(`文件路径不合法：${relative}`);
    const file = path.join(packageDir(partId, version), 'files', relative);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  /** Re-hash every declared file on disk. Detects tampering and truncation. */
  function verifyPackage(partId, version) {
    const manifest = readManifest(partId, version);
    if (!manifest) return { passed: false, entries: [], summary: `部件 ${partId}@${version} 未安装` };
    const entries = manifest.files.map(file => {
      const bytes = readFileBytes(partId, version, file.path);
      const actual = bytes === null ? 'missing' : createHash('sha256').update(bytes).digest('hex');
      return { path: file.path, expected: file.sha256, actual, bytes: bytes === null ? null : bytes.length, ok: actual === file.sha256 };
    });
    const changed = entries.filter(entry => !entry.ok);
    return {
      passed: changed.length === 0,
      entries,
      digest: manifestDigest(manifest),
      summary: changed.length ? `文件与清单不符：${changed.map(entry => entry.path).join('、')}` : `${entries.length} 个文件哈希一致`,
    };
  }

  function listPackages() {
    if (!fs.existsSync(packagesDir)) return [];
    const result = [];
    for (const partId of fs.readdirSync(packagesDir)) {
      const partDir = path.join(packagesDir, partId);
      if (!fs.statSync(partDir).isDirectory()) continue;
      for (const version of fs.readdirSync(partDir)) {
        if (fs.existsSync(path.join(partDir, version, 'manifest.json'))) result.push({ partId, version });
      }
    }
    return result.sort((a, b) => `${a.partId}@${a.version}`.localeCompare(`${b.partId}@${b.version}`));
  }

  function removePackage(partId, version) {
    const dir = packageDir(partId, version);
    if (!fs.existsSync(dir)) return { removed: false };
    fs.rmSync(dir, { recursive: true, force: true });
    return { removed: true };
  }

  return {
    rootDir, indexFile, journalFile, packagesDir,
    atomicWriteJson, readIndex, writeIndex, appendJournal, readJournal,
    packageDir, exists, writePackage, readManifest, readFileBytes, verifyPackage, listPackages, removePackage,
  };
}

export function isValidSha256(value) {
  return SHA256_PATTERN.test(String(value ?? ''));
}
