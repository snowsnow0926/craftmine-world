// Licensing check tests (node --test). Synthetic trees only; no real input, no window,
// no network. All temporary data is created under $env:PI_SCRATCH_DIR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CHECKER = path.join(REPO_ROOT, 'desktop/delivery/licensing-check.mjs');
const REAL_OFFLINE_ENTRY = path.join(REPO_ROOT, 'desktop/delivery/licensing/offline-entry.json');
const SCRATCH_ROOT = process.env.PI_SCRATCH_DIR ?? os.tmpdir();

const scratch = () => fs.mkdtempSync(path.join(SCRATCH_ROOT, 'licensing-test-'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const writeFile = (file, content) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
};

function runChecker(args) {
  try {
    const stdout = execFileSync(process.execPath, [CHECKER, ...args], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    return {status: 0, stdout, stderr: ''};
  } catch (error) {
    return {status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? ''};
  }
}

function entry(overrides = {}) {
  return {
    id: 'test-component',
    module: 'Synthetic test component',
    paths: ['vendor/example/**'],
    origin: 'third-party',
    rightsHolder: 'Example Authors',
    observedLicense: 'MIT',
    targetLicense: 'MIT',
    licenseFile: null,
    deliveryChannels: ['app-bundle'],
    dependencies: [],
    evidence: [{path: 'desktop/windows-NOTICES.md', note: 'real repository evidence file used by the synthetic test', commit: null}],
    status: 'verified',
    openQuestions: [],
    noticeKey: 'TestComponent',
    licenseTextIds: ['mit'],
    packageProbe: ['resources/licenses/CRAFTMINE-NOTICES.md'],
    ...overrides
  };
}

function inventory(entries) {
  return {format: 'craftmine.license-inventory/1', generatedAt: '2026-09-10T00:00:00.000Z', entries};
}

function offlineEntry(overrides = {}) {
  return {
    format: 'craftmine.offline-license-entry/1',
    package: {
      root: 'resources/licenses',
      entryDocument: 'CRAFTMINE-NOTICES.md',
      required: [{id: 'mit', file: 'texts/LICENSE-MIT.txt', status: 'required', covers: ['test-component'], repoText: 'desktop/delivery/licensing/texts/LICENSE-MIT.txt'}]
    },
    export: {
      root: 'licenses',
      entryDocument: 'EXPORT-NOTICES.md',
      required: [{id: 'export-notices', file: 'EXPORT-NOTICES.md', status: 'required', covers: ['test-component']}]
    },
    ...overrides
  };
}

function completePackage(root) {
  writeFile(path.join(root, 'resources/licenses/CRAFTMINE-NOTICES.md'), '# Notices\n\nTestComponent is MIT.\n');
  writeFile(path.join(root, 'resources/licenses/texts/LICENSE-MIT.txt'), 'MIT License\n');
}

function scenario({entries, offline = offlineEntry(), packageRoot = null, extraArgs = []}) {
  const directory = scratch();
  const inventoryPath = path.join(directory, 'inventory.json');
  const offlinePath = path.join(directory, 'offline-entry.json');
  writeJson(inventoryPath, inventory(entries));
  writeJson(offlinePath, offline);
  const args = ['--inventory', inventoryPath, '--offline-entry', offlinePath, '--root', REPO_ROOT, '--json', ...extraArgs];
  if (packageRoot) args.push('--package', packageRoot);
  return {...runChecker(args), directory, inventoryPath, offlinePath};
}

const parse = result => {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error('checker did not print JSON (exit ' + result.status + '): ' + result.stdout.slice(0, 400) + ' ' + result.stderr.slice(0, 400));
  }
};
const codes = record => new Set(record.failures.map(failure => failure.code));

test('schema: a well-formed inventory validates', () => {
  const result = scenario({entries: [entry()]});
  const record = parse(result);
  assert.equal(record.format, 'craftmine.licensing-check/1');
  assert.equal(record.inventory.format, 'craftmine.license-inventory/1');
  for (const failure of record.failures) assert.ok(!failure.code.startsWith('INVENTORY_'), 'unexpected schema failure: ' + failure.code);
});

test('schema: a missing required field fails', () => {
  const broken = entry();
  delete broken.observedLicense;
  const record = parse(scenario({entries: [broken]}));
  assert.ok(codes(record).has('INVENTORY_ENTRY_OBSERVED_LICENSE'), 'expected INVENTORY_ENTRY_OBSERVED_LICENSE');
  assert.equal(record.status, 'fail');
});

test('unknown-rights shipped entry fails', () => {
  const record = parse(scenario({entries: [entry({origin: 'unknown', status: 'unknown-rightsholder', rightsHolder: 'unknown'})]}));
  assert.ok(codes(record).has('UNKNOWN_RIGHTS_SHIPPED'), 'expected UNKNOWN_RIGHTS_SHIPPED');
  assert.equal(record.status, 'fail');
  assert.ok(record.counts.unknownRightsShipped >= 1);
});

test('shipped entry with no evidence fails', () => {
  const record = parse(scenario({entries: [entry({evidence: []})]}));
  assert.ok(codes(record).has('SHIPPED_COMPONENT_WITHOUT_EVIDENCE'), 'expected SHIPPED_COMPONENT_WITHOUT_EVIDENCE');
  assert.equal(record.status, 'fail');
});

test('missing licence text fails', () => {
  const packageRoot = scratch();
  writeFile(path.join(packageRoot, 'resources/licenses/CRAFTMINE-NOTICES.md'), '# Notices\n\nTestComponent is MIT.\n');
  const record = parse(scenario({entries: [entry()], packageRoot}));
  assert.ok(codes(record).has('LICENCE_TEXT_ABSENT'), 'expected LICENCE_TEXT_ABSENT, got ' + [...codes(record)].join(','));
  assert.equal(record.status, 'fail');
});

test('a text recorded as missing in the offline entry fails with MISSING_LICENCE_TEXT', () => {
  const packageRoot = scratch();
  writeFile(path.join(packageRoot, 'resources/licenses/CRAFTMINE-NOTICES.md'), '# Notices\n\nTestComponent is MIT.\n');
  const offline = offlineEntry();
  offline.package.required[0].status = 'missing';
  offline.package.required[0].reason = 'synthetic gap';
  const record = parse(scenario({entries: [entry()], offline, packageRoot}));
  assert.ok(codes(record).has('MISSING_LICENCE_TEXT'), 'expected MISSING_LICENCE_TEXT, got ' + [...codes(record)].join(','));
});

test('complete synthetic package passes and is not modified', () => {
  const packageRoot = scratch();
  completePackage(packageRoot);
  const notices = path.join(packageRoot, 'resources/licenses/CRAFTMINE-NOTICES.md');
  const before = {listing: fs.readdirSync(packageRoot, {recursive: true}).sort(), hash: createHash('sha256').update(fs.readFileSync(notices)).digest('hex')};
  const result = scenario({entries: [entry()], packageRoot});
  const record = parse(result);
  assert.equal(record.status, 'pass', 'failures: ' + JSON.stringify(record.failures));
  assert.equal(result.status, 0);
  const after = {listing: fs.readdirSync(packageRoot, {recursive: true}).sort(), hash: createHash('sha256').update(fs.readFileSync(notices)).digest('hex')};
  assert.deepEqual(after, before, 'the checker must not modify the inspected tree');
});

test('pending entries are reported as pending, never as pass', () => {
  const packageRoot = scratch();
  completePackage(packageRoot);
  const result = scenario({entries: [entry({status: 'pending-rights-review', openQuestions: ['rights review incomplete']})], packageRoot});
  const record = parse(result);
  assert.equal(record.status, 'pending');
  assert.equal(result.status, 3);
  assert.notEqual(record.status, 'pass');
  assert.ok(record.pending.some(item => item.id === 'test-component'));
  const reported = record.entries.find(item => item.id === 'test-component');
  assert.equal(reported.verdict, 'pending');
  assert.notEqual(reported.verdict, 'pass');
});

test('the real offline entry paths resolve and are relative', () => {
  const offline = JSON.parse(fs.readFileSync(REAL_OFFLINE_ENTRY, 'utf8'));
  assert.equal(offline.format, 'craftmine.offline-license-entry/1');
  for (const scope of ['package', 'export']) {
    assert.ok(offline[scope].root && !path.isAbsolute(offline[scope].root));
    const ids = new Set();
    for (const item of offline[scope].required) {
      assert.ok(!path.isAbsolute(item.file), scope + ' ' + item.id + ' file must be relative');
      assert.ok(!item.file.split(/[\\/]/).includes('..'), scope + ' ' + item.id + ' must not escape the root');
      assert.ok(!ids.has(item.id), 'duplicate offline entry id: ' + item.id);
      ids.add(item.id);
      if (item.repoText) assert.ok(fs.existsSync(path.join(REPO_ROOT, item.repoText)), 'repoText is absent: ' + item.repoText);
    }
  }
});

test('the generated inventory covers the required modules and cites evidence', () => {
  const inventoryPath = path.join(REPO_ROOT, 'desktop/delivery/licensing/inventory.json');
  const record = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  assert.equal(record.format, 'craftmine.license-inventory/1');
  const ids = new Set(record.entries.map(item => item.id));
  for (const required of ['pi-desktop-upstream', 'craftmine-core', 'app-creation-core', 'plugin-craftmine-world', 'world-workshop-3d', 'godot-web-bridge-runtime', 'godot-engine', 'npm-third-party-dependencies', 'cargo-third-party-dependencies', 'bundled-fonts', 'user-created-content', 'ai-generated-output']) {
    assert.ok(ids.has(required), 'inventory is missing ' + required);
  }
  for (const item of record.entries) {
    assert.ok(item.evidence.length > 0, item.id + ' has no evidence');
    for (const evidence of item.evidence) assert.ok(fs.existsSync(path.join(REPO_ROOT, evidence.path.replace(/\s*\(.*\)\s*$/, ''))), item.id + ' evidence path is absent: ' + evidence.path);
  }
  assert.equal(record.entries.find(item => item.id === 'ai-generated-output').status, 'unknown-rightsholder');
});
