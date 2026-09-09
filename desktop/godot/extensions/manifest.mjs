// L3 part package manifest: parse, validate, normalise, digest.
//
// A manifest is data. It never contains executable code that this module runs;
// the host (or a later validated loader) is responsible for actually loading
// `entry.script` inside the managed Godot job.
import { createHash } from 'node:crypto';
import {
  BUILTIN_PART_ID, HOST_PART_API_VERSION, NATIVE_REQUIRED_EXTENSIONS, PART_ID_PATTERN,
  PART_INTERFACES, PART_KINDS, PART_MANIFEST_FORMAT, SAFE_RELATIVE_PATH, SHA256_PATTERN,
  isPlain, parseSemver,
} from './formats.mjs';
import { validateContentRef } from './content-ref.mjs';

// Deterministic JSON so the same manifest always digests to the same value.
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

export function manifestDigest(manifest) {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

function isResPath(value) {
  return typeof value === 'string' && value.startsWith('res://') && !value.includes('..') && !value.includes('\\');
}

function isNativeEntry(script) {
  const lower = String(script ?? '').toLowerCase();
  return NATIVE_REQUIRED_EXTENSIONS.some(extension => lower.endsWith(extension));
}

/**
 * Validate a raw manifest object.
 *
 * Returns a report instead of throwing so callers can show every problem at
 * once: { format, passed, errors, manifest }.
 */
export function validatePartManifest(raw) {
  const errors = [];
  const fail = message => { errors.push(message); };

  if (!isPlain(raw)) {
    return { format: PART_MANIFEST_FORMAT, passed: false, errors: ['部件清单必须是对象'], manifest: null };
  }
  if (raw.format !== PART_MANIFEST_FORMAT) fail(`部件清单 format 必须是 ${PART_MANIFEST_FORMAT}，实际 ${raw.format}`);
  if (!PART_ID_PATTERN.test(String(raw.partId ?? ''))) fail(`partId 无效：${raw.partId}（小写字母开头，可含数字和连字符）`);
  if (!PART_KINDS.includes(raw.partKind)) fail(`partKind 无效：${raw.partKind}；宿主支持 ${PART_KINDS.join('、')}`);
  if (!parseSemver(raw.version)) fail(`version 必须是 x.y.z 形式的语义版本，实际 ${raw.version}`);
  if (raw.apiVersion !== HOST_PART_API_VERSION) fail(`apiVersion 必须是 ${HOST_PART_API_VERSION}，实际 ${raw.apiVersion}`);

  const engine = raw.engine;
  if (!isPlain(engine)) fail('缺少 engine 描述');
  else {
    if (engine.name !== 'godot') fail(`engine.name 必须是 godot，实际 ${engine.name}`);
    if (typeof engine.version !== 'string' || engine.version.trim().length === 0) fail('engine.version 不能为空（必须写死固定版本，不能写 latest）');
    else if (/latest|^any$/i.test(engine.version.trim())) fail('engine.version 不允许写 latest/any，必须固定版本');
  }

  if (!Array.isArray(raw.compatibleBases) || raw.compatibleBases.length === 0) {
    fail('compatibleBases 至少要声明一个底座');
  } else {
    raw.compatibleBases.forEach((entry, index) => {
      if (!isPlain(entry)) { fail(`compatibleBases[${index}] 必须是对象`); return; }
      if (typeof entry.baseId !== 'string' || entry.baseId.trim().length === 0) fail(`compatibleBases[${index}].baseId 不能为空`);
      if (typeof entry.baseVersion !== 'string' || entry.baseVersion.trim().length === 0) fail(`compatibleBases[${index}].baseVersion 必须是版本范围`);
      if (typeof entry.stateFormat !== 'string' || entry.stateFormat.trim().length === 0) fail(`compatibleBases[${index}].stateFormat 不能为空`);
    });
  }

  const entry = raw.entry;
  if (!isPlain(entry)) fail('缺少 entry 描述');
  else {
    if (!isResPath(entry.script)) fail(`entry.script 必须是 res:// 路径且不含 ..，实际 ${entry.script}`);
    if (typeof entry.language !== 'string' || entry.language.trim().length === 0) fail('entry.language 不能为空');
  }

  const native = raw.native === true;
  if (typeof raw.native !== 'boolean') fail('native 必须是布尔值（false 表示纯 GDScript 部件）');
  if (!native && isPlain(entry) && isNativeEntry(entry.script)) {
    fail('entry.script 指向原生扩展文件，但 native 为 false');
  }
  if (native && isPlain(entry) && !isNativeEntry(entry.script)) {
    fail('native 为 true 时 entry.script 必须指向 .gdextension 或本地库文件');
  }

  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    fail('files 至少要列出一个文件');
  } else if (raw.files.length > 64) {
    fail(`files 最多 64 个，实际 ${raw.files.length}`);
  } else {
    const seen = new Set();
    raw.files.forEach((file, index) => {
      if (!isPlain(file)) { fail(`files[${index}] 必须是对象`); return; }
      if (typeof file.path !== 'string' || !SAFE_RELATIVE_PATH.test(file.path)) fail(`files[${index}].path 不是安全的相对路径：${file.path}`);
      else if (seen.has(file.path)) fail(`files[${index}].path 重复：${file.path}`);
      else seen.add(file.path);
      if (!SHA256_PATTERN.test(String(file.sha256 ?? ''))) fail(`files[${index}].sha256 必须是 64 位小写十六进制`);
      if (!Number.isInteger(file.bytes) || file.bytes < 0) fail(`files[${index}].bytes 必须是非负整数`);
    });
  }

  const budgets = raw.budgets;
  if (!isPlain(budgets)) {
    fail('缺少 budgets 声明（性能与资源预算必须显式写出，未测量要写 null）');
  } else {
    for (const key of ['frameMsP95', 'memoryBytes', 'packageBytes']) {
      const value = budgets[key];
      if (value !== null && !(Number.isFinite(value) && value >= 0)) fail(`budgets.${key} 必须是数字或 null，实际 ${value}`);
    }
    if (typeof budgets.measured !== 'boolean') fail('budgets.measured 必须是布尔值');
  }

  const license = raw.license;
  if (!isPlain(license)) fail('缺少 license 声明');
  else {
    if (typeof license.spdx !== 'string' || license.spdx.trim().length === 0) fail('license.spdx 不能为空');
    if (typeof license.source !== 'string' || license.source.trim().length === 0) fail('license.source 不能为空（要能追溯到来源）');
  }

  if (!Array.isArray(raw.selfTests) || raw.selfTests.length < 1 || raw.selfTests.length > 8) {
    fail('selfTests 需要 1–8 条自带测试');
  } else {
    raw.selfTests.forEach((test, index) => {
      if (!isPlain(test)) { fail(`selfTests[${index}] 必须是对象`); return; }
      if (typeof test.id !== 'string' || test.id.trim().length === 0) fail(`selfTests[${index}].id 不能为空`);
      if (!['logic', 'engine-headless'].includes(test.kind)) fail(`selfTests[${index}].kind 必须是 logic 或 engine-headless`);
      if (typeof test.expect !== 'string' || test.expect.trim().length === 0) fail(`selfTests[${index}].expect 不能为空`);
    });
  }

  if (raw.rollback !== undefined) {
    if (!isPlain(raw.rollback)) fail('rollback 必须是对象');
    else {
      if (raw.rollback.builtinFallback !== BUILTIN_PART_ID) fail(`rollback.builtinFallback 必须是内置部件 ${BUILTIN_PART_ID}`);
      if (raw.rollback.previousVersion !== null && !parseSemver(raw.rollback.previousVersion)) {
        fail('rollback.previousVersion 必须是语义版本或 null');
      }
    }
  }

  if (raw.contentRefs !== undefined) {
    if (!Array.isArray(raw.contentRefs)) fail('contentRefs 必须是数组');
    else raw.contentRefs.forEach((ref, index) => {
      const validation = validateContentRef(ref);
      if (!validation.ok) validation.errors.forEach(message => fail(`contentRefs[${index}]：${message}`));
    });
  }

  if (errors.length) return { format: PART_MANIFEST_FORMAT, passed: false, errors, manifest: null };

  const manifest = {
    format: PART_MANIFEST_FORMAT,
    partId: raw.partId,
    partKind: raw.partKind,
    version: raw.version,
    apiVersion: raw.apiVersion,
    title: typeof raw.title === 'string' ? raw.title : raw.partId,
    description: typeof raw.description === 'string' ? raw.description : '',
    engine: { name: 'godot', version: engine.version.trim(), renderer: typeof engine.renderer === 'string' ? engine.renderer : null },
    compatibleBases: raw.compatibleBases.map(item => ({
      baseId: item.baseId, baseVersion: item.baseVersion.trim(), stateFormat: item.stateFormat.trim(),
    })),
    entry: { script: entry.script, language: entry.language.trim(), interface: PART_INTERFACES[raw.partKind].interface, symbol: PART_INTERFACES[raw.partKind].entry },
    native,
    files: raw.files.map(file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes })),
    budgets: {
      frameMsP95: budgets.frameMsP95 ?? null,
      memoryBytes: budgets.memoryBytes ?? null,
      packageBytes: budgets.packageBytes ?? null,
      measured: budgets.measured,
    },
    license: { spdx: license.spdx.trim(), source: license.source.trim(), upstream: typeof license.upstream === 'string' ? license.upstream : null },
    selfTests: raw.selfTests.map(test => ({ id: test.id, kind: test.kind, expect: test.expect })),
    rollback: {
      builtinFallback: BUILTIN_PART_ID,
      previousVersion: isPlain(raw.rollback) && raw.rollback.previousVersion ? raw.rollback.previousVersion : null,
    },
    contentRefs: Array.isArray(raw.contentRefs) ? raw.contentRefs : [],
  };
  return { format: PART_MANIFEST_FORMAT, passed: true, errors, manifest, digest: manifestDigest(manifest) };
}

export function assertPartManifest(raw) {
  const report = validatePartManifest(raw);
  if (!report.passed) throw new Error('部件清单不合法：' + report.errors.join('；'));
  return report;
}

/** True when the manifest declares native code, i.e. it needs B/C/K sign-off. */
export function requiresNativeValidation(manifest) {
  return manifest?.native === true;
}

/** True when a release package may ship this part (license must be resolved). */
export function licenseReady(manifest) {
  const spdx = String(manifest?.license?.spdx ?? '').trim().toUpperCase();
  return spdx.length > 0 && spdx !== 'NOASSERTION' && spdx !== 'UNKNOWN';
}
