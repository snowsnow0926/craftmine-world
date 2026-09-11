import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {parseOptions, snapshotFromRow, readPlayerConfiguration, collectBaseline, writeBaseline, sha256} from '../scripts/godot-agent-baseline.mjs';

const binding = {id: 'deepseek-player', contextWindow: 1000000, maxTokens: 384000, thinkingLevels: ['off', 'high', 'max'], defaultThinkingLevel: 'max', supportsImages: true, supportsDocuments: false, availableForSubagents: true};
const row = {id: 'session-selected', provider_id: 'provider-a', model_id: binding.id, thinking_level: 'max', mode: 'agent', permission_mode: 'inherit', updated_at: 1789131876828, vendor_key: 'deepseek', protocol: 'openai_compatible', api_style: 'chat_completions', base_url: 'https://api.deepseek.com', default_model_id: 'deepseek-other', config_json: JSON.stringify({models: [binding], privateValue: 'SECRET_CONFIG_SENTINEL'})};
const context = {sourceDatabase: '/fixture/pi.sqlite', explicit: true, sampledAt: '2026-09-12T00:00:00.000Z'};
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-gu0-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}
function fixture(t) {
  const directory = temporary(t), file = path.join(directory, 'pi.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE sessions(id TEXT, provider_id TEXT, model_id TEXT, thinking_level TEXT, mode TEXT, permission_mode TEXT, updated_at INTEGER, title TEXT);
    CREATE TABLE providers(id TEXT, vendor_key TEXT, protocol TEXT, api_style TEXT, base_url TEXT, default_model_id TEXT, config_json TEXT, secret_ref TEXT);
    CREATE TABLE messages(content TEXT); INSERT INTO messages VALUES ('PRIVATE_DIALOG_SENTINEL');`);
  db.prepare('INSERT INTO providers VALUES (?,?,?,?,?,?,?,?)').run(row.provider_id, row.vendor_key, row.protocol, row.api_style, row.base_url, row.default_model_id, row.config_json, 'CREDENTIAL_SENTINEL');
  const insert = values => db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)').run(values.id, values.provider_id, values.model_id, values.thinking_level, values.mode, values.permission_mode, values.updated_at, 'PRIVATE_TITLE_SENTINEL');
  insert(row);
  insert({...row, id: 'session-newer', updated_at: row.updated_at + 1, thinking_level: 'high'});
  db.close();
  return {directory, file};
}

test('explicit arguments only: no auto-discovery, relative paths or runtime limit options', () => {
  const base = ['--player-db', path.resolve('fixture.sqlite'), '--out', path.resolve('output')];
  assert.equal(parseOptions(base).sessionId, undefined);
  assert.throws(() => parseOptions([]), /PLAYER_DB_AND_OUT_REQUIRED/);
  assert.throws(() => parseOptions(['--player-db', 'relative', '--out', '/absolute']), /ABSOLUTE_PATH_REQUIRED/);
  assert.throws(() => parseOptions([...base, '--max-requests', '4']), /UNKNOWN_OPTION/);
  assert.throws(() => parseOptions([...base, '--session-id', 'x', '--session-id', 'y']), /DUPLICATE_OPTION/);
});

test('actual session model and binding survive unchanged; default is descriptive only', () => {
  const snapshot = snapshotFromRow(row, context);
  assert.equal(snapshot.format, 'craftmine.player-config-snapshot/1');
  assert.equal(snapshot.modelId, 'deepseek-player');
  assert.equal(snapshot.providerDefaultModelId, 'deepseek-other');
  assert.equal(snapshot.selectedIsProviderDefault, false);
  assert.deepEqual(snapshot.modelBinding, binding);
  assert.equal(snapshot.maxTokens, 384000);
  assert.equal(snapshot.thinkingLevel, 'max');
  assert.equal(snapshot.permissionMode, 'inherit');
  assert.equal(snapshot.effectivePermissionUnverified, true);
  assert.equal(snapshot.ordinaryDriverCompatible, true);
  assert.equal(snapshot.foregroundSelectionObserved, false);
  assert.equal(JSON.stringify(snapshot).includes('SENTINEL'), false);
});

test('missing or changed configuration fails without fallback, endpoint secrets or unknown binding fields', () => {
  for (const changed of [
    {model_id: 'missing'}, {thinking_level: 'low'}, {config_json: 'bad json'},
    {config_json: JSON.stringify({models: [{...binding, maxTokens: undefined}]})},
    {config_json: JSON.stringify({models: [{...binding, credential: 'SECRET'}]})},
    {config_json: JSON.stringify({models: [binding, binding]})},
    {base_url: 'https://user:SECRET@example.com'}, {base_url: 'https://example.com?key=SECRET'},
  ]) assert.throws(() => snapshotFromRow({...row, ...changed}, context), /^Error: BASELINE_/);
  const unsupported = snapshotFromRow({...row, vendor_key: 'different'}, context);
  assert.equal(unsupported.vendorKey, 'different');
  assert.equal(unsupported.ordinaryDriverCompatible, false);
});

test('read-only SQLite uses the explicit session, preserves bytes and omits messages, titles and credentials', t => {
  const {file} = fixture(t), before = sha256(fs.readFileSync(file));
  const selected = readPlayerConfiguration(file, 'session-selected');
  assert.equal(selected.selectionBasis, 'explicitly-selected-session');
  assert.equal(selected.samples[0].configuration.thinkingLevel, 'max');
  assert.equal(JSON.stringify(selected).includes('SENTINEL'), false);
  assert.equal(sha256(fs.readFileSync(file)), before);
  assert.throws(() => readPlayerConfiguration(file, 'unknown'), /SESSION_NOT_FOUND/);
  assert.equal(sha256(fs.readFileSync(file)), before);
});

test('without session ID, candidates remain unverified and cannot masquerade as normal-player snapshots', t => {
  const {file, directory} = fixture(t), report = readPlayerConfiguration(file);
  assert.equal(report.selectedSessionUnverified, true);
  assert.equal(report.samples[0].configuration.sourceSession.id, 'session-newer');
  assert.equal(report.samples[0].configuration.format, 'craftmine.player-config-candidate/1');
  const out = path.join(directory, 'candidate-output');
  writeBaseline({player: report}, out);
  assert.deepEqual(fs.readdirSync(out), ['baseline.json']);
});

test('incomplete newest session is reported and never silently replaced by an older working session', t => {
  const {file} = fixture(t), db = new DatabaseSync(file);
  db.prepare('UPDATE sessions SET model_id=? WHERE id=?').run('missing', 'session-newer'); db.close();
  const result = readPlayerConfiguration(file);
  assert.equal(result.samples[0].status, 'unavailable');
  assert.equal(result.samples[0].sessionId, 'session-newer');
  assert.equal(result.samples[1].status, 'available');
  assert.equal(result.selectedSessionUnverified, true);
  assert.throws(() => readPlayerConfiguration(file, 'session-newer'), /SELECTED_MODEL_BINDING_MISSING/);
});

test('source hashes and dirty paths are collected without diffs; supplied binary is only hashed', t => {
  const {file, directory} = fixture(t), root = path.join(directory, 'repo');
  fs.mkdirSync(root);
  const git = args => execFileSync('git', ['-C', root, ...args], {windowsHide: true, stdio: 'pipe'});
  git(['init', '-q']);
  for (const relative of ['docs/GODOT_AGENT_CAPABILITY_DEVELOPMENT_PLAN.md', 'plugins/craftmine-world/manifest.json', 'plugins/craftmine-world/world-tools.cjs', 'desktop/godot/toolchain.lock.json']) {
    const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, 'baseline');
  }
  git(['add', '.']); git(['-c', 'user.name=GU0 fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  fs.appendFileSync(path.join(root, 'plugins/craftmine-world/world-tools.cjs'), 'PRIVATE_DIFF_SENTINEL');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'PRIVATE_UNTRACKED_SENTINEL');
  const coreBin = path.join(directory, 'not-executable.exe'); fs.writeFileSync(coreBin, 'hash only');
  const report = collectBaseline({playerDb: file, sessionId: row.id, coreBin}, root);
  assert.equal(report.source.commit.length, 40);
  assert.deepEqual(report.source.dirtyFiles.map(item => item.path).sort(), ['plugins/craftmine-world/world-tools.cjs', 'untracked.txt']);
  assert.equal(report.artifacts.plan.sha256, sha256('baseline'));
  assert.equal(report.coreBinary.sha256, sha256('hash only'));
  assert.equal(report.coreBinary.executed, false);
  assert.equal(report.modelRequests, 0);
  assert.equal(JSON.stringify(report).includes('SENTINEL'), false);
  const out = path.join(directory, 'selected-output'), outputs = writeBaseline(report, out);
  assert.equal(outputs.length, 2);
  for (const output of outputs) assert.equal(sha256(fs.readFileSync(output.file)), output.sha256);
  assert.equal(JSON.parse(fs.readFileSync(outputs[1].file)).format, 'craftmine.player-config-snapshot/1');
  assert.throws(() => writeBaseline(report, out), /EEXIST/);
});

test('CLI errors do not print SQLite values or write output', t => {
  const {file, directory} = fixture(t), db = new DatabaseSync(file);
  db.prepare('UPDATE providers SET config_json=?').run('SECRET_BROKEN_JSON'); db.close();
  const script = fileURLToPath(new URL('../scripts/godot-agent-baseline.mjs', import.meta.url));
  const out = path.join(directory, 'failed-output');
  const result = spawnSync(process.execPath, ['--no-warnings', script, '--player-db', file, '--session-id', row.id, '--out', out], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BASELINE_PROVIDER_CONFIGURATION_INVALID/);
  assert.equal((result.stderr + result.stdout).includes('SECRET'), false);
  assert.equal(fs.existsSync(out), false);
});
