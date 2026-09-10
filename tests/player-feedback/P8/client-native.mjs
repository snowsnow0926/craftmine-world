// Run only after the root integrator authorizes this exact compiled candidate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { parameterClientArguments, inspectParameterPackage, isolatedParameterEnvironment } from '../../plan-loop/parameter-client-package.mjs';
import { loadPackageAsar } from '../../../desktop/package-asar.mjs';
import { assertCleanHeadlessShutdown } from '../../player-product/shutdown-exit-audit.mjs';
import { createP8Relay, MODEL } from './relay.mjs';
import { openRequestJournal, ordinaryParents, reconcileMetrics, unwrapP8ProductReply } from './evidence.mjs';
import { deriveAdditiveProgress } from '../../../desktop/godot/shared/progress-migration.mjs';
import { createStopControl } from './stop-control.mjs';
import { p8Authorization } from './authorization.mjs';

const options = parameterClientArguments(process.argv.slice(2)), { root, runtime, deps, packaged } = options;
const app = path.join(root, 'vendor/pi-desktop/apps/desktop'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'P8 source must be clean');
assert.equal(process.env.CRAFTMINE_P8_APPROVED_COMMIT, commit, 'P8 exact compiled candidate authorization is required');
assert.equal(hash(fs.readFileSync(fileURLToPath(import.meta.url))), hash(fs.readFileSync(path.join(root, 'tests/player-feedback/P8/client-native.mjs'))), 'P8 runner must match source');
if (packaged) assert.equal(commit, options.expectedCommit);
const authorization = p8Authorization(process.env, root);
const asar = packaged ? loadPackageAsar(deps) : null, packageInfo = packaged ? await inspectParameterPackage({ ...options, asar }) : null;
const electron = packaged ? null : createRequire(path.join(deps, 'package.json'))('electron');
const main = packageInfo ? packageInfo.main : fs.readFileSync(path.join(app, 'out/main/index.js'));
for (const marker of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance', 'craftmine-acceptance-p8', 'P8_READY_BASE_REQUIRED']) assert.ok(main.includes(Buffer.from(marker)), 'Missing actual Main marker ' + marker);
assert.ok((packageInfo ? packageInfo.preload : fs.readFileSync(path.join(app, 'out/preload/craftmine-headless.cjs'))).includes(Buffer.from('requestPointerLock')));
const core = packageInfo?.core ?? path.join(runtime, 'vendor/pi-desktop/target/release/craftmine-core.exe');
const host = packageInfo?.host ?? path.join(runtime, 'vendor/pi-desktop/target/release/pi-desktop-host-core.exe');
const resources = packaged ? null : JSON.parse(fs.readFileSync(path.join(runtime, 'desktop/build/runtime-resources/runtime-resources.json'), 'utf8'));
if (!packaged) { assert.equal(root, runtime); assert.equal(resources.sourceCommit, commit); }
const parent = path.join(root, 'test-results'); fs.mkdirSync(parent, { recursive: true });
const out = fs.mkdtempSync(path.join(parent, 'desktop-native-p8-')), profile = path.join(out, 'profile'), legacy = path.join(out, 'legacy'), temp = path.join(out, 'temp'), token = randomUUID();
for (const directory of [profile, legacy, temp]) fs.mkdirSync(directory);
fs.writeFileSync(path.join(profile, 'headless-profile.json'), JSON.stringify({ format: 'craftmine.headless-profile/1', token, legacySource: legacy }));
const report = { format: 'craftmine.p8-client/1', passed: false, commit, out, profile, mode: packaged ? 'packaged' : 'development', mainSha256: hash(main), coreSha256: hash(fs.readFileSync(core)), hostSha256: hash(fs.readFileSync(host)), runtimeFilesDigest: packageInfo?.identity.runtimeFilesDigest ?? resources.filesDigest,
  requestedModel: MODEL, authorization, requestLimit: authorization.requestLimit, cumulativeTokenLimit: null, cases: [], steps: [], launches: [], faults: [], limitations: ['Reconstructed synthetic requests; no player profile or original prompt was copied.', 'Actual product chat and model responses are not authored fixtures. An unverified behavior remains pending even if its build passes.', 'No real OS input, foreground window, Pointer Lock, desktop capture or credential reporting.', 'This run is not installer/signing/clean-machine or player acceptance.'] };
if (packageInfo) Object.assign(report, packageInfo.identity);
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const journalPath = authorization.journalPath, journal = openRequestJournal(journalPath, { requestLimit: authorization.requestLimit });
report.requestJournal = journalPath; report.priorAdmissions = journal.entries.length;
let currentCase = null, relay;
let child, ended = true, ready = false, launch, exit; const pending = new Map(), reopen = {};
const stopControl = createStopControl({ out, abort: caseId => p8('abort', caseId), snapshot: caseId => p8('snapshot', caseId), record: event => {
  report.stopEvents ??= []; report.stopEvents.push(event); if (report.stopEvents.length > 32) report.stopEvents.shift(); save();
} });
report.stopFile = stopControl.file;
async function start() {
  if (packageInfo) assert.deepEqual((await inspectParameterPackage({ ...options, asar })).identity, packageInfo.identity);
  ready = false; ended = false; launch = { startedAt: new Date().toISOString() }; report.launches.push(launch);
  const env = { ...isolatedParameterEnvironment(process.env, { out, profile, token, core, host, bases: packageInfo?.bases ?? path.join(runtime, 'desktop/godot') }), TEMP: temp, TMP: temp,
    CRAFTMINE_P8_NATIVE: '1', CRAFTMINE_P8_PROXY_BASE: relay.baseUrl, CRAFTMINE_P8_PROXY_AUTH: relay.auth, CRAFTMINE_P8_REOPEN: JSON.stringify(reopen) };
  child = spawn(packageInfo?.executable ?? electron, packageInfo ? [] : [app], { cwd: packageInfo?.cwd ?? root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => fs.appendFileSync(path.join(out, `client-${report.launches.length}-${stream}.log`), bytes));
  child.on('message', message => {
    if (message?.type === 'craftmine-headless-ready') ready = true;
    if (message?.type === 'craftmine-headless-exit') launch.audit = message;
    if (!['craftmine-headless', 'craftmine-acceptance-p8'].includes(message?.type)) return;
    const task = pending.get(message.id); if (!task || task.type !== message.type) return;
    pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(Error(message.error)) : task.resolve(message.result);
  });
  exit = new Promise(resolve => { const finish = (code, signal, error) => { if (ended) return; ended = true; launch.exit = { code, signal, error: error ? String(error) : null }; for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('P8_CLIENT_EXITED')); } pending.clear(); save(); resolve(); }; child.once('error', error => finish(null, null, error)); child.once('exit', (code, signal) => finish(code, signal)); });
}
function rpc(method, payload = {}, timeout = 30000, type = 'craftmine-headless') {
  return new Promise((resolve, reject) => {
    if (ended || !child.connected) return reject(Error('P8_CLIENT_EXITED'));
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('P8_RPC_TIMEOUT:' + method)); }, timeout);
    pending.set(id, { resolve, reject, timer, type }); child.send({ type, id, method, ...payload });
  });
}
const p8 = async (method, caseId, extra = {}, timeout = 30000) => {
  const value = await rpc(method, { payload: { caseId, ...extra } }, timeout, 'craftmine-acceptance-p8');
  return method === 'submit' || method === 'abort' ? unwrapP8ProductReply(value) : value;
};
const nav = async (channel, payload = {}) => {
  if (channel !== 'world.createOptions') return rpc('worldNavigation', { channel, payload }, 180000);
  return until(async () => { try { return await rpc('worldNavigation', { channel, payload }, 180000); }
    catch (error) { if (error.message === 'Error: Window is not ready' || error.message === 'Window is not ready') return { starting: true }; throw error; }
  }, value => !value.starting, 'main window readiness');
};
const panel = (worldId, channel, payload = {}) => rpc('worldPanel', { channel, payload: { worldId, ...payload } }, 180000);
async function until(fn, accept, label, timeout = 120000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { if (ended) throw Error('P8_CLIENT_EXITED:' + label); last = await fn(); if (accept(last)) return last; await delay(1000); }
  throw Error('P8_TIMEOUT:' + label + ':' + JSON.stringify(last).slice(0, 1000));
}
async function step(name, fn) {
  try { const value = await fn(); report.steps.push({ name, caseId: currentCase, passed: true, value }); save(); console.log('PASS ' + name); return value; }
  catch (error) { report.steps.push({ name, caseId: currentCase, passed: false, error: String(error) }); save(); throw error; }
}
async function stop() {
  if (ended) return;
  try { await rpc('quit', {}, 10000); } catch { /* The independent exit audit remains mandatory. */ }
  await Promise.race([exit, delay(20000)]);
  if (!ended) { launch.forcedStop = true; child.kill(); await Promise.race([exit, delay(5000).then(() => { throw Error('P8_CLIENT_STOP_TIMEOUT'); })]); }
}
async function auditStop() {
  const status = await rpc('status'); assert.deepEqual(status.violations, []); assert.deepEqual(status.pageErrors, []); assert.deepEqual(status.shutdownFailures, []);
  assert.ok(status.windows.every(window => !window.visible && !window.focused && !window.focusable && window.offscreen));
  await stop(); assertCleanHeadlessShutdown(launch); return launch;
}
async function controllerReady() {
  await until(() => ready, Boolean, 'headless notification');
  await until(async () => {
    const value = await rpc('status'); assert.deepEqual(value.violations, []); assert.deepEqual(value.pageErrors, []); assert.deepEqual(value.shutdownFailures, []);
    assert.ok(value.windows.every(window => !window.visible && !window.focused && !window.focusable && window.offscreen)); return value;
  }, value => value.runtime?.hostAvailable && value.runtime.plugins.includes('craftmine.world') && value.windows.length > 0, 'actual guarded Main/backend readiness');
}
async function loaded(worldId) {
  await until(async () => { try { return await rpc('godotObserve'); } catch (error) { if (/^(?:Error: )?(No world runtime is running|WORLD_BUSY)$/.test(error.message)) return { waiting: error.message }; throw error; } }, value => value?.worldId === worldId && value.instanceId, 'formal runtime', 180000);
  await until(async () => { try { return await rpc('worldNavigationReady'); } catch (error) { if (/^(?:Error: )?World view is not ready$/.test(error.message)) return { ready: false }; throw error; } }, value => value.ready && value.worldId === worldId, 'navigation ready');
}
async function state(worldId) { const value = (await rpc('godotSnapshot')).state; assert.equal(value?.format, 'craftmine.godot-progress/1'); assert.equal(value.worldId, worldId); return value; }
function rawCalls(binding, turnId) {
  const file = path.join(profile, 'pi.sqlite'); ordinaryParents(file); const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT c.observation_json FROM task_metric_calls c JOIN turns t ON t.id=c.turn_id WHERE t.session_id=? AND t.id=? ORDER BY c.call_id').all(binding.sessionId, turnId).map(row => JSON.parse(row.observation_json)); }
  finally { db.close(); }
}
function sourceEvidence(worldId, buildId) {
  const directory = path.join(profile, 'plugins/data/craftmine.world'), file = path.join(directory, 'tasks.sqlite'); ordinaryParents(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT path,kind,sha256,bytes FROM craftmine_godot_build_files WHERE world_id=? AND build_id=? ORDER BY path').all(worldId, buildId);
    assert.ok(rows.length > 0); let total = 0;
    return rows.filter(row => ['source', 'host'].includes(row.kind)).map(row => {
      assert.ok(typeof row.path === 'string' && !path.isAbsolute(row.path) && !row.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..') && !row.path.includes(':'));
      const source = path.join(directory, 'godot-builds', hash(worldId), buildId, 'source', row.path); ordinaryParents(source);
      const stat = fs.lstatSync(source); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size === row.bytes && stat.size <= 4 * 1024 * 1024);
      total += stat.size; assert.ok(total <= 64 * 1024 * 1024); const bytes = fs.readFileSync(source); assert.equal(hash(bytes), row.sha256);
      return { ...row, ...( /\.(gd|godot|tscn|tres|json)$/.test(row.path) ? { text: bytes.toString('utf8') } : {}) };
    });
  } finally { db.close(); }
}
async function capture(name) { const image = await rpc('godotCaptureView'); assert.equal(image.width, 1280); assert.equal(image.height, 720); const bytes = Buffer.from(image.pngBase64, 'base64'); assert.ok(bytes.subarray(1, 4).equals(Buffer.from('PNG'))); const file = path.join(out, name + '.png'); fs.writeFileSync(file, bytes); return { file, sha256: hash(bytes), width: image.width, height: image.height }; }

try {
  relay = await createP8Relay({ requestLimit: authorization.requestLimit, initialAttempts: journal.initialAttempts, persist: async event => {
    if (event.kind === 'request') journal.reserve(event.attempt, currentCase, out);
    fs.writeFileSync(path.join(out, `upstream-${event.attempt.id}-${event.kind}.json`), JSON.stringify(event, null, 2));
    report.relay = relay?.snapshot(); save();
  } });
  await start(); await controllerReady();
  for (const [caseId, baseId, starterId] of [['hammer', 'first-person', 'training-range'], ['dog', 'top-down', 'town']]) {
    currentCase = caseId; const item = { caseId, baseId, outcome: 'running', behavior: 'pending', startedAt: new Date().toISOString() }; report.cases.push(item); save();
    try {
      await until(() => nav('world.createOptions'), value => value.bases?.some(base => base.id === baseId), 'base catalog');
      const world = await step('create fresh ' + caseId + ' world', () => nav('world.create', { baseId, starterId, title: 'P8 reconstructed ' + caseId, operationId: randomUUID() })); item.worldId = world.id;
      await step('actual initialization build/check', () => until(async () => (await nav('world.list')).worlds.find(row => row.id === world.id), row => { assert.ok(!['failed', 'cancelled', 'interrupted'].includes(row?.state), JSON.stringify(row)); return row?.state === 'ready'; }, 'initialization', 900000)); await loaded(world.id);
      const initial = await rpc('godotObserve'); item.initialBuildId = initial.buildId;
      await panel(world.id, 'godot.runtimeSave', { freeze: true }); item.before = await state(world.id);
      const beforeCandidates = new Set((await panel(world.id, 'godot.candidateList', { offset: 0, limit: 32 })).items.map(row => row.candidateId));
      const binding = await step('bind real product chat and exact provider', () => p8('initialize', caseId, { worldId: world.id })); item.binding = binding;
      reopen[caseId] = { sessionId: binding.sessionId, worldId: world.id, providerId: binding.providerId };
      const admissionStart = relay.snapshot().attempts.length;
      const submitted = await step('submit fixed reconstructed request once', () => p8('submit', caseId)); item.submission = submitted; assert.equal(submitted.accepted, true); assert.ok(submitted.turnId);
      const stopBinding = { caseId, turnId: submitted.turnId, sessionId: binding.sessionId };
      fs.writeFileSync(path.join(out, 'control.json'), JSON.stringify({ format: 'craftmine.p8-control/1', stopFile: stopControl.file, request: { format: 'craftmine.p8-stop/1', action: 'abort', caseId, turnId: submitted.turnId } }, null, 2));
      const final = await step('real task reaches a durable terminal state', () => until(async () => {
        const stopped = await stopControl.check(stopBinding);
        if (stopped) { item.stop = stopped; report.stopped = true; if (!stopped.cleanAbort) process.exitCode = 1; return stopped.snapshot; }
        const value = await p8('snapshot', caseId); fs.writeFileSync(path.join(out, caseId + '-latest.json'), JSON.stringify(value, null, 2));
        return value;
      }, value => !value.active && value.metrics?.turnId === submitted.turnId && value.metrics.status !== 'running', 'model task', 1500000));
      item.metrics = final.metrics; item.record = final.record; item.dom = final.dom;
      await until(() => relay.snapshot().attempts.slice(admissionStart), attempts => attempts.every(attempt => attempt.endedAtMs), 'relay response evidence', 10000);
      item.requests = relay.snapshot().attempts.slice(admissionStart); item.calls = rawCalls(binding, submitted.turnId);
      await step('P4 durable usage and generation TPS match raw provider facts', () => reconcileMetrics(final.metrics, item.calls, item.requests, binding));
      const visible = await until(() => p8('snapshot', caseId), value => value.dom?.metrics?.some(metric => metric.turnId === submitted.turnId), 'actual P5 task metrics');
      item.dom = visible.dom; const taskCards = visible.dom.metrics.filter(value => value.turnId === submitted.turnId);
      assert.equal(taskCards.length, 1, 'Exactly one metrics card must represent the durable user turn');
      const metric = taskCards[0];
      assert.equal(metric.coverage, final.metrics.coverage); assert.ok(metric.values.model.includes(MODEL));
      if (final.metrics.usage) assert.ok(metric.values.tokens.includes(new Intl.NumberFormat('zh-CN').format(final.metrics.usage.totalTokens)));
      if (!item.stop) {
        const stopped = await stopControl.check(stopBinding);
        if (stopped) { item.stop = stopped; report.stopped = true; if (!stopped.cleanAbort) process.exitCode = 1; }
      }
      if (item.stop) { item.outcome = 'stopped'; item.behavior = 'not accepted; explicit operator stop'; break; }
      assert.equal(final.metrics.status, 'completed', 'Model task did not complete successfully');
      const candidate = await step('actual model authored checked candidate exists', async () => {
        const list = await panel(world.id, 'godot.candidateList', { offset: 0, limit: 32 }); const latest = list.items.find(row => !beforeCandidates.has(row.candidateId) && row.status === 'ready'); assert.ok(latest, 'No new ready model candidate');
        const read = await panel(world.id, 'godot.candidateRead', { candidateId: latest.candidateId }); assert.equal(read.checkStatus, 'passed'); assert.equal(read.check.passed, true); assert.equal(read.candidate.worldId, world.id); assert.equal(read.buildId, latest.buildId); assert.notEqual(read.buildId, initial.buildId); item.candidate = read; return latest;
      });
      item.source = sourceEvidence(world.id, candidate.buildId); assert.ok(item.source.some(file => file.text?.includes(caseId === 'hammer' ? 'thunder_hammer' : 'p8-dog')), 'Stable authored case identity missing from real built source');
      await step('candidate preview and close preserve formal progress', async () => {
        assert.deepEqual(await panel(world.id, 'godot.candidatePreview', { candidateId: candidate.candidateId }), { status: 'preview', worldId: world.id, candidateId: candidate.candidateId, buildId: candidate.buildId });
        assert.deepEqual(await panel(world.id, 'godot.candidateClose'), { status: 'aborted', worldId: world.id });
        assert.deepEqual(await state(world.id), item.before); assert.equal((await rpc('godotObserve')).buildId, initial.buildId);
      });
      await step('apply actual checked model candidate through product coordinator', async () => {
        await panel(world.id, 'godot.candidatePreview', { candidateId: candidate.candidateId }); const result = await panel(world.id, 'godot.candidateApply', { candidateId: candidate.candidateId });
        assert.equal(result.status, 'applied'); assert.equal(result.worldId, world.id); assert.equal(result.record.world.build.id, candidate.buildId); item.application = result; return { status: result.status, candidateId: result.candidateId };
      });
      item.firstFrame = await capture(caseId + '-adopted'); item.adoptedState = await state(world.id);
      await step('adoption preserves every prior progress field', () => {
        if (caseId === 'hammer') assert.deepEqual(deriveAdditiveProgress(item.before, item.adoptedState).snapshot, item.adoptedState);
        else assert.deepEqual(item.adoptedState, item.before);
        return { retained: true, allowedAdditions: caseId === 'hammer' ? 'existing core-verified target/interactable migration only' : 'none' };
      });
      const play = await p8('exercise', caseId, {}, 120000); item.gameplay = { ...play, actions: play.actions.map((action, index) => { const bytes = Buffer.from(action.image.pngBase64, 'base64'), file = path.join(out, `${caseId}-action-${index}.png`); fs.writeFileSync(file, bytes); return { ...action, image: { file, sha256: hash(bytes), width: action.image.width, height: action.image.height } }; }) };
      await panel(world.id, 'godot.runtimeSave', { freeze: true }); item.saved = await state(world.id);
      item.outcome = 'source-check-apply-save-completed'; item.behavior = 'pending independent inspection of real source/actions/frames';
    } catch (error) { item.outcome = 'failed'; item.error = String(error.stack ?? error); process.exitCode = 1;
      if (item.binding && !ended && !stopControl.requested) { try { await p8('abort', caseId); } catch (abortError) { item.abortError = String(abortError); } }
    } finally { item.finishedAt = new Date().toISOString(); report.relay = relay.snapshot(); save(); }
    if (ended || item.outcome === 'failed' || stopControl.requested || relay.snapshot().attempts.some(attempt => attempt.status === 400 || attempt.status === 401 || attempt.status === 403) || authorization.requestLimit !== null && relay.snapshot().attempts.length >= authorization.requestLimit) break;
  }
  await step('first strict owned shutdown', auditStop);
  const savedCases = report.cases.filter(item => item.saved);
  if (savedCases.length && !report.stopped && !stopControl.requested) {
    await start(); await controllerReady();
    for (const item of savedCases) { currentCase = item.caseId; await until(() => nav('world.list'), value => !!value.activeWorldId, 'restart selection'); await until(() => rpc('worldNavigationReady'), value => value.ready, 'restart initial navigation'); await nav('world.open', { id: item.worldId }); await loaded(item.worldId);
      await p8('initialize', item.caseId, { worldId: item.worldId });
      await step('complete saved state and durable task metrics survive restart', async () => { assert.deepEqual(await state(item.worldId), item.saved); const latest = await p8('snapshot', item.caseId); const { observedAtMs: beforeTime, ...before } = item.metrics, { observedAtMs: afterTime, ...after } = latest.metrics; assert.deepEqual(after, before); assert.deepEqual(sourceEvidence(item.worldId, item.candidate.buildId), item.source); item.restart = { passed: true, observedAtMs: afterTime }; });
    }
    await step('second strict owned shutdown', auditStop);
  }
  // Behavioral assertions require independent inspection of actual generated
  // content. A green build or command sequence cannot silently satisfy them.
  report.pipelinePassed = report.cases.length === 2 && report.cases.every(item => item.outcome === 'source-check-apply-save-completed' && item.restart?.passed);
  report.passed = false; report.reviewRequired = true;
} catch (error) { report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  try { await stop(); if (launch) assertCleanHeadlessShutdown(launch); } catch (error) { report.shutdownError = String(error); report.passed = false; process.exitCode = 1; }
  try { if (relay) { await relay.close(); report.relay = relay.snapshot(); } } catch (error) { report.relayCloseError = String(error); process.exitCode = 1; }
  try { journal.close(); } catch (error) { report.journalCloseError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.cumulativeAdmissions = authorization.previousPhaseAdmissions + (report.relay?.attempts.length ?? journal.entries.length); save(); console.log(JSON.stringify({ out, pipelinePassed: report.pipelinePassed, passed: report.passed, cases: report.cases.map(({ caseId, outcome, error }) => ({ caseId, outcome, error })), requests: report.relay?.attempts.length, error: report.error, shutdownError: report.shutdownError }));
}
