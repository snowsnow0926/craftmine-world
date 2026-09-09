// Install / activate / upgrade / rollback / uninstall for L3 part packages.
//
// Rules that the tests pin down:
//   * a package whose bytes do not match its manifest is refused before it is
//     written anywhere;
//   * a package that is not compatible with the running engine/base is refused;
//   * a native package without a B/C/K validation record is refused;
//   * the active version is never silently replaced: every switch is journaled,
//     and the previous version is kept so `rollback` has something real to
//     return to (otherwise it falls back to the built-in default);
//   * an active package cannot be uninstalled, only switched away from first.
import { createHash } from 'node:crypto';
import {
  BUILTIN_PART_ID, PART_INSTALLED_FORMAT, PART_KINDS, PART_MANIFEST_FORMAT, HOST_PART_API_VERSION,
} from './formats.mjs';
import { validatePartManifest, manifestDigest, licenseReady } from './manifest.mjs';
import { checkPartCompatibility } from './compat.mjs';
import { createPartStore } from './store.mjs';

function hashBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createPartManager({ root, host, now = () => new Date().toISOString(), resolveContent = null } = {}) {
  if (!host || typeof host !== 'object') throw new Error('部件管理器需要宿主描述（engineVersion / apiVersion / builtins）');
  const store = createPartStore({ root });
  const hostKinds = Array.isArray(host.kinds) && host.kinds.length ? host.kinds : PART_KINDS;
  const builtins = host.builtins || {};

  const journal = entry => store.appendJournal(entry);

  function index() {
    return store.readIndex();
  }

  function installedRecord(partId, version) {
    return index().installed.find(item => item.partId === partId && item.version === version) || null;
  }

  function verifyProvidedFiles(manifest, files) {
    const entries = manifest.files.map(file => {
      const bytes = Object.hasOwn(files || {}, file.path) ? files[file.path] : null;
      const actual = bytes === null ? 'missing' : hashBytes(bytes);
      const size = bytes === null ? null : Buffer.byteLength(bytes);
      return { path: file.path, expected: file.sha256, actual, bytes: size, declaredBytes: file.bytes, ok: actual === file.sha256 && size === file.bytes };
    });
    const bad = entries.filter(entry => !entry.ok);
    return { passed: bad.length === 0, entries, summary: bad.length ? `包内容与清单不符：${bad.map(entry => entry.path).join('、')}` : `${entries.length} 个文件与清单一致` };
  }

  /** Install a package without activating it. */
  function install({ manifest: rawManifest, files }, { target, nativeValidation = null, requireLicense = false } = {}) {
    const validation = validatePartManifest(rawManifest);
    if (!validation.passed) {
      const result = { status: 'rejected', partId: rawManifest?.partId ?? null, version: rawManifest?.version ?? null, error: validation.errors.join('；'), checks: [] };
      journal({ op: 'install', partId: result.partId, version: result.version, result: 'rejected', detail: result.error });
      return result;
    }
    const manifest = validation.manifest;
    if (!hostKinds.includes(manifest.partKind)) {
      const error = `宿主不支持的部件类型：${manifest.partKind}`;
      journal({ op: 'install', partId: manifest.partId, version: manifest.version, result: 'rejected', detail: error });
      return { status: 'rejected', partId: manifest.partId, version: manifest.version, error, checks: [] };
    }

    const bytesReport = verifyProvidedFiles(manifest, files);
    const compat = checkPartCompatibility(manifest, target, { nativeValidation, resolveContent, requireLicense });
    const checks = [
      { name: '清单格式', passed: true, detail: `digest ${manifestDigest(manifest).slice(0, 12)}` },
      { name: '包内容哈希', passed: bytesReport.passed, detail: bytesReport.summary },
      ...compat.checks,
    ];
    const failed = checks.filter(check => !check.passed);
    if (failed.length) {
      const error = failed.map(check => `${check.name}（${check.detail}）`).join('；');
      journal({ op: 'install', partId: manifest.partId, version: manifest.version, result: 'rejected', detail: error });
      return { status: 'rejected', partId: manifest.partId, version: manifest.version, error, checks };
    }

    const record = store.writePackage(manifest, files);
    const state = index();
    state.installed = state.installed.filter(item => !(item.partId === manifest.partId && item.version === manifest.version));
    state.installed.push({
      format: PART_INSTALLED_FORMAT,
      partId: manifest.partId,
      version: manifest.version,
      partKind: manifest.partKind,
      digest: record.digest,
      native: manifest.native === true,
      license: manifest.license,
      licenseReady: licenseReady(manifest),
      target: target ? { baseId: target.baseId, baseVersion: target.baseVersion, stateFormat: target.stateFormat, engineVersion: target.engineVersion } : null,
      installedAt: now(),
    });
    store.writeIndex(state);
    journal({ op: 'install', partId: manifest.partId, version: manifest.version, partKind: manifest.partKind, result: 'installed', detail: record.digest });
    return { status: 'installed', partId: manifest.partId, version: manifest.version, partKind: manifest.partKind, digest: record.digest, checks };
  }

  /** Activate an already installed version for its kind. */
  function activate(partId, version) {
    const record = installedRecord(partId, version);
    if (!record) {
      journal({ op: 'activate', partId, version, result: 'rejected', detail: '未安装' });
      return { status: 'rejected', error: `部件 ${partId}@${version} 未安装` };
    }
    const verification = store.verifyPackage(partId, version);
    if (!verification.passed) {
      journal({ op: 'activate', partId, version, result: 'rejected', detail: verification.summary });
      return { status: 'rejected', error: verification.summary };
    }
    const state = index();
    const current = state.active[record.partKind] || null;
    if (current && !(current.partId === partId && current.version === version)) {
      const history = state.history[record.partKind] || [];
      state.history[record.partKind] = [...history, current].slice(-5);
    }
    state.active[record.partKind] = { partId, version };
    store.writeIndex(state);
    journal({
      op: 'activate', partId, version, partKind: record.partKind, result: 'activated',
      from: current ? `${current.partId}@${current.version}` : `${record.partKind}:${BUILTIN_PART_ID}`,
      to: `${partId}@${version}`,
    });
    return { status: 'activated', partKind: record.partKind, partId, version, previous: current };
  }

  /** Install then activate. The previous version stays available for rollback. */
  function upgrade(pkg, options) {
    const installResult = install(pkg, options);
    if (installResult.status !== 'installed') return installResult;
    const activation = activate(installResult.partId, installResult.version);
    if (activation.status !== 'activated') return { ...activation, partId: installResult.partId, version: installResult.version };
    journal({ op: 'upgrade', partId: installResult.partId, version: installResult.version, partKind: activation.partKind, result: 'upgraded', detail: `from ${activation.previous ? activation.previous.partId + '@' + activation.previous.version : BUILTIN_PART_ID}` });
    return { ...activation, status: 'upgraded', digest: installResult.digest, checks: installResult.checks };
  }

  /** Return the kind to its previous version, or to the built-in default. */
  function rollback(kind) {
    if (!PART_KINDS.includes(kind)) return { status: 'rejected', error: `未知部件类型：${kind}` };
    const state = index();
    const history = state.history[kind] || [];
    if (history.length) {
      const previous = history[history.length - 1];
      state.history[kind] = history.slice(0, -1);
      state.active[kind] = previous;
      store.writeIndex(state);
      journal({ op: 'rollback', partId: previous.partId, version: previous.version, partKind: kind, result: 'rolled-back', to: `${previous.partId}@${previous.version}` });
      return { status: 'rolled-back', partKind: kind, to: previous, builtin: false };
    }
    if (!state.active[kind]) {
      journal({ op: 'rollback', partKind: kind, result: 'rejected', detail: '没有可回退的版本' });
      return { status: 'rejected', error: `部件类型 ${kind} 没有可回退的版本` };
    }
    delete state.active[kind];
    store.writeIndex(state);
    journal({ op: 'rollback', partKind: kind, result: 'rolled-back', to: `${kind}:${BUILTIN_PART_ID}`, builtin: true });
    return { status: 'rolled-back', partKind: kind, to: { partId: BUILTIN_PART_ID, version: null }, builtin: true };
  }

  function uninstall(partId, version) {
    const record = installedRecord(partId, version);
    if (!record) return { status: 'rejected', error: `部件 ${partId}@${version} 未安装` };
    const state = index();
    const active = state.active[record.partKind];
    if (active && active.partId === partId && active.version === version) {
      journal({ op: 'uninstall', partId, version, result: 'rejected', detail: '正在生效的部件不能卸载，先回退' });
      return { status: 'rejected', error: '正在生效的部件不能卸载，先回退或切换到其它版本' };
    }
    store.removePackage(partId, version);
    state.installed = state.installed.filter(item => !(item.partId === partId && item.version === version));
    store.writeIndex(state);
    journal({ op: 'uninstall', partId, version, partKind: record.partKind, result: 'uninstalled' });
    return { status: 'uninstalled', partId, version };
  }

  function activeParts() {
    const state = index();
    return hostKinds.map(kind => {
      const active = state.active[kind];
      if (!active) return { kind, partId: BUILTIN_PART_ID, version: null, builtin: true };
      const record = installedRecord(active.partId, active.version);
      return { kind, partId: active.partId, version: active.version, builtin: false, digest: record?.digest || null, native: record?.native === true };
    });
  }

  function status() {
    const state = index();
    return {
      format: 'craftmine.godot-part-status/1',
      root: store.rootDir,
      host: { engineVersion: host.engineVersion ?? null, apiVersion: host.apiVersion ?? HOST_PART_API_VERSION, kinds: hostKinds },
      active: activeParts(),
      installed: state.installed,
      history: state.history,
      journalTail: store.readJournal().slice(-10),
    };
  }

  function verify(partId, version) {
    return store.verifyPackage(partId, version);
  }

  return {
    root: store.rootDir,
    store,
    install,
    activate,
    upgrade,
    rollback,
    uninstall,
    activeParts,
    status,
    verify,
    installed: () => index().installed,
    history: kind => index().history[kind] || [],
  };
}

export { PART_MANIFEST_FORMAT };
