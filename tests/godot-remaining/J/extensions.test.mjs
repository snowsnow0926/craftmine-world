// L3 part-extension layer: manifest, compatibility, lifecycle, budget, content refs.
//
// Pure logic, no browser, no input simulation, no Godot process. Every case here
// asserts a refusal as carefully as it asserts an acceptance, because "it did
// not silently install an incompatible part" is the property that matters.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  HOST_PART_API_VERSION, PART_KINDS,
  buildPartPackage, checkPartCompatibility, createPartManager, createPartStore, evaluateCandidate,
  hashContent, licenseReady, measureBudget, resolveContentRef, summarizeBudgets,
  validateContentRef, validatePartManifest,
} from '../../../desktop/godot/extensions/index.mjs';

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

const TARGET = {
  baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable', apiVersion: HOST_PART_API_VERSION,
};

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `craftmine-j-${name}-`));
}

function manifestOf(overrides = {}) {
  return {
    format: 'craftmine.godot-part-manifest/1',
    partId: 'tile-batch-renderer',
    partKind: 'renderPass',
    version: '0.1.0',
    apiVersion: HOST_PART_API_VERSION,
    title: 'Tile batch renderer',
    engine: { name: 'godot', version: '4.7.2-stable', renderer: 'gl_compatibility' },
    compatibleBases: [{ baseId: 'top-down', baseVersion: '>=1.0.0 <2.0.0', stateFormat: 'craftmine.godot-topdown-state/1' }],
    entry: { script: 'res://addons/tile_batch_renderer/part.gd', language: 'gdscript' },
    native: false,
    budgets: { frameMsP95: 1.0, memoryBytes: 1048576, measured: false },
    license: { spdx: 'MIT', source: 'docs/dispatch-reports/godot-remaining/J/J_L3_CANDIDATES.md' },
    selfTests: [{ id: 'batch.keeps-world-state', kind: 'engine-headless', expect: 'world state before and after a frame is identical' }],
    rollback: { builtinFallback: 'default', previousVersion: null },
    ...overrides,
  };
}

function packageOf(overrides = {}, sources = { 'addons/tile_batch_renderer/part.gd': 'extends Node\nfunc run(_ctx):\n\tpass\n' }) {
  return buildPartPackage({ manifest: manifestOf(overrides), sources });
}

function managerFor(root, host = {}) {
  return createPartManager({ root, host: { engineVersion: '4.7.2-stable', apiVersion: HOST_PART_API_VERSION, ...host } });
}

test('a built package derives file hashes and stays valid', () => {
  const pkg = packageOf();
  assert.equal(pkg.manifest.files.length, 1);
  assert.equal(pkg.manifest.files[0].path, 'addons/tile_batch_renderer/part.gd');
  assert.match(pkg.manifest.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(pkg.manifest.budgets.packageBytes, pkg.packageBytes);
  assert.equal(validatePartManifest(pkg.manifest).passed, true);
  assert.match(pkg.digest, /^[a-f0-9]{64}$/);
});

test('manifest validation rejects the mistakes that would widen L3 by accident', () => {
  const cases = [
    ['未知部件类型', { partKind: 'kernelPatch' }],
    ['部件 ID 不合法', { partId: 'Tile Batch' }],
    ['版本号不是语义版本', { version: 'v1' }],
    ['宿主 ABI 版本不符', { apiVersion: 99 }],
    ['引擎版本写成 latest', { engine: { name: 'godot', version: 'latest' } }],
    ['没有声明兼容底座', { compatibleBases: [] }],
    ['入口不是 res:// 路径', { entry: { script: 'C:/outside/part.gd', language: 'gdscript' } }],
    ['原生标志与入口不一致', { native: true }],
    ['缺少预算声明', { budgets: undefined }],
    ['缺少许可声明', { license: undefined }],
    ['自带测试为空', { selfTests: [] }],
  ];
  for (const [label, overrides] of cases) {
    const report = validatePartManifest(manifestOf(overrides));
    assert.equal(report.passed, false, `应当拒绝：${label}`);
    assert.ok(report.errors.length > 0, `应当给出原因：${label}`);
  }
});

test('PART_KINDS stays the host-owned list', () => {
  assert.deepEqual([...PART_KINDS], ['renderPass', 'hudWidget', 'postProcess', 'perfComponent']);
});

test('compatibility gate refuses engine, base, state-format and native gaps', () => {
  const pkg = packageOf();
  assert.equal(checkPartCompatibility(pkg.manifest, TARGET).passed, true);

  assert.equal(checkPartCompatibility(pkg.manifest, { ...TARGET, engineVersion: '4.6.0-stable' }).passed, false);
  assert.equal(checkPartCompatibility(pkg.manifest, { ...TARGET, baseId: 'first-person' }).passed, false);
  assert.equal(checkPartCompatibility(pkg.manifest, { ...TARGET, baseVersion: '2.0.0' }).passed, false);
  assert.equal(checkPartCompatibility(pkg.manifest, { ...TARGET, stateFormat: 'craftmine.godot-topdown-state/2' }).passed, false);
  assert.equal(checkPartCompatibility(pkg.manifest, { ...TARGET, apiVersion: 2 }).passed, false);

  const nativeManifest = packageOf({ native: true, entry: { script: 'res://addons/tile_batch_renderer/part.gdextension', language: 'gdextension' } }).manifest;
  assert.equal(checkPartCompatibility(nativeManifest, TARGET).passed, false, '原生部件没有专项验证必须被拒绝');
  const withRecord = checkPartCompatibility(nativeManifest, TARGET, { nativeValidation: { by: 'C', at: '2026-09-10T00:00:00.000Z', harness: 'sandbox-native-gate' } });
  assert.equal(withRecord.passed, true);
});

test('license must be resolved before a part may ship', () => {
  assert.equal(licenseReady({ license: { spdx: 'MIT' } }), true);
  assert.equal(licenseReady({ license: { spdx: 'NOASSERTION' } }), false);
  const pkg = packageOf({ license: { spdx: 'NOASSERTION', source: 'unknown' } });
  assert.equal(checkPartCompatibility(pkg.manifest, TARGET, { requireLicense: true }).passed, false);
  assert.equal(checkPartCompatibility(pkg.manifest, TARGET, { requireLicense: false }).passed, true);
});

test('content references must resolve to a hash right now', () => {
  const bytes = 'tile-set-bytes';
  const ref = {
    contentId: 'town-tiles', contentVersion: '1.0.0', contentHash: hashContent(bytes),
    baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable',
  };
  assert.equal(validateContentRef(ref).ok, true);
  assert.equal(validateContentRef({ ...ref, contentHash: undefined }).ok, false, '只有指针没有哈希必须被拒绝');
  assert.equal(resolveContentRef(ref, () => ({ found: true, bytes })).ok, true);
  assert.equal(resolveContentRef(ref, () => ({ found: true, bytes: 'other' })).reason, 'hash-mismatch');
  assert.equal(resolveContentRef(ref, () => ({ found: false })).reason, 'missing-content');
  assert.equal(resolveContentRef(ref, null).reason, 'no-resolver');
});

test('install refuses tampered bytes before writing anything', () => {
  const root = tempDir('tamper');
  const manager = managerFor(root);
  const pkg = packageOf();
  pkg.files['addons/tile_batch_renderer/part.gd'] = 'extends Node\n# tampered\n';
  const result = manager.install(pkg, { target: TARGET });
  assert.equal(result.status, 'rejected');
  assert.match(result.error, /包内容哈希/);
  assert.equal(fs.existsSync(path.join(root, 'packages', 'tile-batch-renderer', '0.1.0')), false, '被拒绝的包不能落盘');
  assert.equal(manager.installed().length, 0);
});

test('install refuses an incompatible target without writing the package', () => {
  const root = tempDir('incompat');
  const manager = managerFor(root);
  const result = manager.install(packageOf(), { target: { ...TARGET, engineVersion: '4.6.0-stable' } });
  assert.equal(result.status, 'rejected');
  assert.match(result.error, /引擎版本一致/);
  assert.equal(manager.installed().length, 0);
});

test('install, activate, upgrade, rollback and uninstall follow the journaled order', () => {
  const root = tempDir('lifecycle');
  const manager = managerFor(root);

  const v1 = packageOf({ version: '0.1.0' });
  assert.equal(manager.install(v1, { target: TARGET }).status, 'installed');
  assert.equal(manager.activate('tile-batch-renderer', '0.1.0').status, 'activated');
  assert.deepEqual(manager.activeParts().find(part => part.kind === 'renderPass'), {
    kind: 'renderPass', partId: 'tile-batch-renderer', version: '0.1.0', builtin: false, digest: v1.digest, native: false,
  });

  const v2 = packageOf({ version: '0.2.0' }, { 'addons/tile_batch_renderer/part.gd': 'extends Node\nfunc run(_ctx):\n\tpass\n# v2\n' });
  const upgraded = manager.upgrade(v2, { target: TARGET });
  assert.equal(upgraded.status, 'upgraded');
  assert.equal(upgraded.previous.version, '0.1.0');

  assert.equal(manager.uninstall('tile-batch-renderer', '0.2.0').status, 'rejected', '生效中的部件不能卸载');

  const rolledBack = manager.rollback('renderPass');
  assert.equal(rolledBack.status, 'rolled-back');
  assert.equal(rolledBack.to.version, '0.1.0');
  assert.equal(rolledBack.builtin, false);

  assert.equal(manager.uninstall('tile-batch-renderer', '0.2.0').status, 'uninstalled');

  const toBuiltin = manager.rollback('renderPass');
  assert.equal(toBuiltin.builtin, true);
  assert.equal(manager.activeParts().find(part => part.kind === 'renderPass').partId, 'default');

  const ops = manager.store.readJournal().map(entry => entry.op);
  for (const op of ['install', 'activate', 'upgrade', 'rollback', 'uninstall']) {
    assert.ok(ops.includes(op), `journal 缺少 ${op}`);
  }
  assert.ok(manager.store.readJournal().every(entry => entry.format === 'craftmine.godot-part-journal/1'));
});

test('rollback with nothing to fall back to is refused', () => {
  const manager = managerFor(tempDir('empty-rollback'));
  const result = manager.rollback('postProcess');
  assert.equal(result.status, 'rejected');
  assert.match(result.error, /没有可回退的版本/);
});

test('a tampered installed file blocks activation and is reported', () => {
  const root = tempDir('installed-tamper');
  const manager = managerFor(root);
  const pkg = packageOf();
  manager.install(pkg, { target: TARGET });
  const target = path.join(root, 'packages', 'tile-batch-renderer', '0.1.0', 'files', 'addons', 'tile_batch_renderer', 'part.gd');
  fs.writeFileSync(target, 'extends Node\n# changed after install\n');
  const verification = manager.verify('tile-batch-renderer', '0.1.0');
  assert.equal(verification.passed, false);
  assert.match(verification.summary, /part\.gd/);
  const activation = manager.activate('tile-batch-renderer', '0.1.0');
  assert.equal(activation.status, 'rejected');
});

test('budget accounting never turns "unmeasured" into "passed"', () => {
  const declared = { frameMsP95: 1.0, memoryBytes: 1024, packageBytes: null, measured: false };
  assert.equal(measureBudget({ declared }).status, 'unknown');
  assert.equal(measureBudget({ declared, measured: { samplesMs: [] } }).status, 'unknown');
  assert.equal(measureBudget({ declared, measured: { samplesMs: [0.4, 0.5, 0.6], source: 'engine-headless' } }).status, 'pass');
  assert.equal(measureBudget({ declared, measured: { samplesMs: [0.4, 2.4], source: 'engine-headless' } }).status, 'fail');
  assert.equal(measureBudget({ declared, measured: { samplesMs: [0.4], memoryBytes: 4096, source: 'engine-headless' } }).status, 'fail');
  assert.equal(measureBudget({ declared: { frameMsP95: null, memoryBytes: null, packageBytes: null, measured: false }, measured: { samplesMs: [0.1] } }).status, 'unknown');

  const report = measureBudget({ declared, measured: { samplesMs: [0.1, 0.2, 0.3], source: 'release-package' } });
  assert.equal(report.source, 'release-package');
  const summary = summarizeBudgets([report, measureBudget({ declared })]);
  assert.equal(summary.passed, 1);
  assert.equal(summary.unknown, 1);
  assert.match(summary.summary, /未测量不等于通过/);
});

test('store verifies packages it wrote and can list them', () => {
  const root = tempDir('store');
  const store = createPartStore({ root });
  const pkg = packageOf();
  store.writePackage(pkg.manifest, pkg.files);
  assert.deepEqual(store.listPackages(), [{ partId: 'tile-batch-renderer', version: '0.1.0' }]);
  assert.equal(store.verifyPackage('tile-batch-renderer', '0.1.0').passed, true);
  assert.equal(store.readManifest('tile-batch-renderer', '0.1.0').partId, 'tile-batch-renderer');
});

test('the L3 candidate gate blocks every documented candidate until real evidence exists', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('l3-candidates.json', FIXTURE_DIR), 'utf8'));
  assert.ok(fixture.candidates.length >= 2);
  for (const dossier of fixture.candidates) {
    const report = evaluateCandidate(dossier, { resolveEvidence: () => ({ ok: true, detail: 'ok' }) });
    assert.equal(report.status, 'not-ready', `${dossier.candidateId} 在证据补齐前不得开工`);
    const failed = report.checks.filter(item => !item.passed).map(item => item.name);
    assert.ok(failed.includes('当前基线实测') || failed.includes('冻结输入') || failed.includes('证据可确认'),
      `${dossier.candidateId} 应当因为缺少真实证据/冻结输入/实测基线被拦住`);
  }
});

test('a fully evidenced candidate passes, an unresolvable one does not', () => {
  const hash = hashContent('log-bytes');
  const dossier = {
    format: 'craftmine.godot-l3-candidate/1',
    candidateId: 'example-part',
    partKind: 'perfComponent',
    status: 'hypothesis',
    problem: { summary: '示例问题', affectedBases: ['top-down'] },
    evidence: [{ kind: 'run-log', ref: 'test-results/example.log', sha256: hash, quote: 'frame 8.4ms', observedAt: '2026-09-10T00:00:00.000Z' }],
    frozenInput: { taskId: 'task-01', inputHash: hashContent('task'), reproduce: 'node tests/example.mjs' },
    currentBaseline: { metric: 'frameMsP95', value: 8.4, unit: 'ms', source: 'engine-headless', measuredAt: '2026-09-10T00:00:00.000Z' },
    candidateInterface: { entry: 'step', interface: 'step(ctx: Dictionary) -> Dictionary' },
    budget: { frameMsP95: 1.0, memoryBytes: null, packageBytes: null },
    rollback: { strategy: 'builtin-default' },
    native: false,
    killCriterion: '若普通 GDScript 达标则放弃本候选',
    nextStep: '先做纯 GDScript 对照，再决定是否引入部件',
  };
  assert.equal(evaluateCandidate(dossier, { resolveEvidence: item => ({ ok: item.sha256 === hash, detail: 'ok' }) }).status, 'evidence-ready');
  const unresolved = evaluateCandidate(dossier, { resolveEvidence: () => ({ ok: false, detail: '日志文件不存在' }) });
  assert.equal(unresolved.status, 'not-ready');
  assert.match(unresolved.summary, /证据可确认/);
  assert.equal(evaluateCandidate({ ...dossier, status: 'rejected' }, { resolveEvidence: () => ({ ok: true }) }).status, 'rejected');
});
