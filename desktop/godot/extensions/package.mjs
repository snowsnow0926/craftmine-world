// Build a part package from author-supplied sources.
//
// Authors write the manifest fields that describe intent (id, kind, version,
// compatible bases, entry, budgets, license, self tests). The file list and its
// hashes are derived here so a hand-written hash can never drift from the bytes
// that actually ship.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SAFE_RELATIVE_PATH } from './formats.mjs';
import { validatePartManifest, manifestDigest } from './manifest.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeSources(sources) {
  const entries = Object.entries(sources || {});
  if (entries.length === 0) throw new Error('部件包至少需要一个源文件');
  return entries.map(([relative, content]) => {
    if (!SAFE_RELATIVE_PATH.test(relative)) throw new Error(`源文件路径不安全：${relative}`);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    return { path: relative, bytes };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * @param {object} manifest  manifest fields, `files` and `budgets.packageBytes` are derived
 * @param {object} sources   { '<relative path>': string | Buffer }
 */
export function buildPartPackage({ manifest, sources } = {}) {
  const entries = normalizeSources(sources);
  const files = entries.map(entry => ({ path: entry.path, sha256: sha256(entry.bytes), bytes: entry.bytes.length }));
  const packageBytes = files.reduce((total, file) => total + file.bytes, 0);
  const budgets = { ...(manifest?.budgets || {}) };
  if (budgets.packageBytes === undefined || budgets.packageBytes === null) budgets.packageBytes = packageBytes;
  const candidate = { ...manifest, files, budgets };
  const validation = validatePartManifest(candidate);
  if (!validation.passed) throw new Error('部件包不合法：' + validation.errors.join('；'));
  const filesMap = Object.fromEntries(entries.map(entry => [entry.path, entry.bytes]));
  return {
    manifest: validation.manifest,
    digest: manifestDigest(validation.manifest),
    packageBytes,
    files: filesMap,
  };
}

/** Read a previously written package directory back into a loadable package. */
export function readPackageFromDirectory(dir) {
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`目录里没有 manifest.json：${dir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const filesDir = path.resolve(path.join(dir, 'files'));
  const files = {};
  for (const file of manifest.files || []) {
    if (!SAFE_RELATIVE_PATH.test(String(file.path ?? ''))) throw new Error(`包清单里的文件路径不安全：${file.path}`);
    const target = path.resolve(path.join(filesDir, file.path));
    if (!target.startsWith(filesDir + path.sep)) throw new Error(`文件路径逃逸包目录：${file.path}`);
    if (!fs.existsSync(target)) throw new Error(`包缺少文件：${file.path}`);
    files[file.path] = fs.readFileSync(target);
  }
  return { manifest, files };
}
