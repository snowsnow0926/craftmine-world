// Run only after the root integrator authorizes this exact compiled candidate.
// One process runs exactly the cases named by CRAFTMINE_P8_CASES, on its own
// ledger, profile, relay port and log directory, so two cases can run in parallel
// and a single-case result can never be read as a two-case pass.
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
import { p8Authorization, stripCaseArgument } from './authorization.mjs';
import { readLedgerSummary, admissionAccounting } from './ledger.mjs';
import { evaluateGameplay } from './gameplay-criteria.mjs';
import { summarizeRun, CASE_PIPELINE_COMPLETE } from './run-outcome.mjs';
import { pollWorldInitialization, INITIALIZATION_DEADLINE_MS } from './initialization-poll.mjs';
/** One initial request plus the three fixed continuations the product allows. */
const MAX_ROUNDS = 4;
const CASE_PLAN = Object.freeze({ hammer: { baseId: 'first-person', starterId: 'training-range' }, dog: { baseId: 'top-down', starterId: 'town' } });
const DRIVER_MODULES = ['client-native.mjs', 'authorization.mjs', 'ledger.mjs', 'evidence.mjs', 'relay.mjs', 'stop-control.mjs', 'gameplay-criteria.mjs', 'run-outcome.mjs', 'review-merge.mjs'];

// This driver owns `--case`; the generic parameter parser stays untouched, so an
// unknown argument still fails there.
const driverArgv = process.argv.slice(2), { argv: parameterArgv } = stripCaseArgument(driverArgv);
const options = parameterClientArguments(parameterArgv), { root, runtime, deps, packaged } = options;
const app = path.join(root, 'vendor/pi-desktop/apps/desktop'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'P8 source must be clean');
assert.equal(process.env.CRAFTMINE_P8_APPROVED_COMMIT, commit, 'P8 exact compiled candidate authorization is required');
assert.equal(hash(fs.readFileSync(fileURLToPath(import.meta.url))), hash(fs.readFileSync(path.join(root, 'tests/player-feedback/P8/client-native.mjs'))), 'P8 runner must match source');
if (packaged) assert.equal(commit, options.expectedCommit);
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
const out = fs.mkdtempSync(path.join(parent, 'desktop-native-p8-')), profile = path.join(out, 'profile'), legacy = path.join(out, 'legacy'), temp = path.join(out, 'temp'), token = randomUUID(), runId = randomUUID();
for (const directory of [profile, legacy, temp]) fs.mkdirSync(directory);
fs.writeFileSync(path.join(profile, 'headless-profile.json'), JSON.stringify({ format: 'craftmine.headless-profile/1', token, legacySource: legacy }));
// The journal is resolved after the run's own output directory exists, because a
// parallel run may only journal inside its own new output range.
const authorization = p8Authorization(process.env, root, { out, argv: driverArgv }), cases = authorization.cases;
const driverHashes = Object.fromEntries(DRIVER_MODULES.map(name => {
  const file = path.join(root, 'tests/player-feedback/P8', name);
  return [name, fs.existsSync(file) ? hash(fs.readFileSync(file)) : null];
}));
const report = { format: 'craftmine.p8-client/1', passed: false, commit, runtimeSourceCommit: resources?.sourceCommit ?? packageInfo?.identity?.runtimeSourceCommit ?? null, out, runId, profile, mode: packaged ? 'packaged' : 'development', mainSha256: hash(main), coreSha256: hash(fs.readFileSync(core)), hostSha256: hash(fs.readFileSync(host)), runtimeFilesDigest: packageInfo?.identity.runtimeFilesDigest ?? resources.filesDigest,
  driverHashes, requestedModel: MODEL, authorization: { phase: authorization.phase, requestLimit: authorization.requestLimit, previousPhaseAdmissions: authorization.previousPhaseAdmissions, phaseOneAdmissions: authorization.phaseOneAdmissions, mode: authorization.mode, ownership: authorization.ownership, caseSelection: authorization.caseSelection }, requestedCases: cases, caseSelection: authorization.caseSelection, requestLimit: authorization.requestLimit, cumulativeTokenLimit: null, cases: [], steps: [], launches: [], faults: [], limitations: ['Reconstructed synthetic requests; no player profile or original prompt was copied.', 'Actual product chat and model responses are not authored fixtures. An unverified behavior remains pending even if its build passes.', 'No real OS input, foreground window, Pointer Lock, desktop capture or credential reporting.', 'This run is not installer/signing/clean-machine or player acceptance.', 'Frames and source support an independent review of claims no product channel reports; they are not a substitute for human visual confirmation.'] };
if (packageInfo) Object.assign(report, packageInfo.identity);
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
report.pluginSha256 = packageInfo?.identity?.pluginSha256 ?? null; report.appVersion = packageInfo?.identity?.appVersion ?? JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version;
const journalPath = authorization.journalPath, journal = openRequestJournal(journalPath, { requestLimit: authorization.requestLimit });
report.requestJournal = journalPath; report.priorAdmissions = journal.entries.length; report.ledger = authorization.ownership;
report.journal = { ...authorization.ownership, priorInJournal: journal.entries.length, phaseOneAdmissions: authorization.phaseOneAdmissions, historical: authorization.historical };
let currentCase = null, relay;
let child, ended = true, ready = false, launch, exit; const pending = new Map(), reopen = {};
const stopControl = createStopControl({ runId, out, abort: caseId => p8('abort', caseId), snapshot: caseId => p8('snapshot', caseId), record: event => {
  report.stopEvents ??= []; report.stopEvents.push(event); if (report.stopEvents.length > 32) report.stopEvents.shift(); save();
} });
report.stopFile = stopControl.file; report.runStopFile = stopControl.runFile;
async function start() {
  if (packageInfo) assert.deepEqual((await inspectParameterPackage({ ...options, asar })).identity, packageInfo.identity);
  ready = false; ended = false; launch = { startedAt: new Date().toISOString() }; report.launches.push(launch);
  const env = { ...isolatedParameterEnvironment(process.env, { out, profile, token, core, host, bases: packageInfo?.bases ?? path.join(runtime, 'desktop/godot') }), TEMP: temp, TMP: temp,
    CRAFTMINE_P8_NATIVE: '1', CRAFTMINE_P8_AUTHORIZATION_PHASE: authorization.phase, CRAFTMINE_P8_PROXY_BASE: relay.baseUrl, CRAFTMINE_P8_PROXY_AUTH: relay.auth, CRAFTMINE_P8_REOPEN: JSON.stringify(reopen) };
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
  return method === 'submit' || method === 'continue' || method === 'abort' ? unwrapP8ProductReply(value) : value;
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
/** Progress is sampled between rounds; a transient runtime transition is kept as
 * an error record rather than silently replacing the comparison. */
async function progressSnapshot(worldId) { try { return await state(worldId); } catch (error) { return { unavailable: String(error) }; } }
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
  for (const caseId of cases) {
    const { baseId, starterId } = CASE_PLAN[caseId];
    currentCase = caseId; const item = { caseId, baseId, outcome: 'running', behavior: 'pending', startedAt: new Date().toISOString(), turns: [], progress: [] }; report.cases.push(item); save();
    try {
      await until(() => nav('world.createOptions'), value => value.bases?.some(base => base.id === baseId), 'base catalog');
      const world = await step('create fresh ' + caseId + ' world', () => nav('world.create', { baseId, starterId, title: 'P8 reconstructed ' + caseId, operationId: randomUUID() })); item.worldId = world.id;
      // The world exists from here on: only the read that follows is retried, and
      // only for the plugin's own 5 s read timeout. A terminal world state, any
      // other error, or the overall deadline still ends the case as before.
      const initialized = await step('actual initialization build/check', () => pollWorldInitialization({
        read: () => nav('world.list'), worldId: world.id, deadline: Date.now() + INITIALIZATION_DEADLINE_MS,
        onRetry: event => { item.initializationRetries = (item.initializationRetries ?? 0) + 1; report.initializationRetries ??= []; report.initializationRetries.push({ caseId, ...event }); save(); },
      }));
      item.initialization = { reads: initialized.reads, retries: initialized.retries, state: initialized.row.state }; await loaded(world.id);
      const initial = await rpc('godotObserve'); item.initialBuildId = initial.buildId;
      // The initial build's own source is the baseline for "the map and the
      // existing characters are preserved"; the candidate's source is compared
      // against it afterwards. A missing baseline is recorded, never ignored.
      await step('retain the initial build source snapshot for content comparison', () => {
        try { item.initialSource = sourceEvidence(world.id, initial.buildId); assert.ok(item.initialSource.length > 0, 'Initial build exposes no source files'); item.contentSnapshot = { initialFiles: item.initialSource.length }; return { files: item.initialSource.length }; }
        catch (error) { item.initialSourceError = String(error); report.contentSnapshotIncomplete ??= []; report.contentSnapshotIncomplete.push({ caseId, stage: 'initial', error: String(error) }); process.exitCode = 1; return { unavailable: String(error) }; }
      });
      await panel(world.id, 'godot.runtimeSave', { freeze: true }); item.before = await state(world.id);
      const beforeCandidates = new Set((await panel(world.id, 'godot.candidateList', { offset: 0, limit: 32 })).items.map(row => row.candidateId));
      const binding = await step('bind real product chat and exact provider', () => p8('initialize', caseId, { worldId: world.id })); item.binding = binding;
      reopen[caseId] = { sessionId: binding.sessionId, worldId: world.id, providerId: binding.providerId };
      // Every round is retained: its request, usage, tool calls, failure, exit and
      // the progress comparison made after it. Only the last round is never enough.
      for (let round = 0; round < MAX_ROUNDS; round++) {
      const admissionStart = relay.snapshot().attempts.length;
      const submitted = await step(round ? 'continue unfinished request in the same world' : 'submit fixed reconstructed request once', () => p8(round ? 'continue' : 'submit', caseId)); item.submission = submitted; assert.equal(submitted.accepted, true); assert.ok(submitted.turnId);
      const stopBinding = { caseId, turnId: submitted.turnId, sessionId: binding.sessionId };
      fs.writeFileSync(path.join(out, 'control.json'), JSON.stringify({ format: 'craftmine.p8-control/1', runId, caseId, stopFile: stopControl.file, runStopFile: stopControl.runFile, turnId: submitted.turnId, sessionId: binding.sessionId, request: { format: 'craftmine.p8-stop/1', action: 'abort', caseId, turnId: submitted.turnId }, runRequest: { format: 'craftmine.p8-run-stop/1', action: 'abort', caseId, runId } }, null, 2));
      const final = await step('real task reaches a durable terminal state', () => until(async () => {
        const stopped = await stopControl.check(stopBinding);
        if (stopped) { item.stop = stopped; report.stopped = true; if (!stopped.cleanAbort) process.exitCode = 1; return stopped.snapshot; }
        const value = await p8('snapshot', caseId); fs.writeFileSync(path.join(out, caseId + '-latest.json'), JSON.stringify(value, null, 2));
        return value;
      }, value => !value.active && value.metrics?.turnId === submitted.turnId && value.metrics.status !== 'running', 'model task', 1500000));
      item.metrics = final.metrics; item.record = final.record; item.dom = final.dom;
      await until(() => relay.snapshot().attempts.slice(admissionStart), attempts => attempts.every(attempt => attempt.endedAtMs), 'relay response evidence', 10000);
      const roundRequests = relay.snapshot().attempts.slice(admissionStart), roundCalls = rawCalls(binding, submitted.turnId);
      await step('P4 durable usage and generation TPS match raw provider facts', () => reconcileMetrics(final.metrics, roundCalls, roundRequests, binding));
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
      const observed = await progressSnapshot(world.id);
      item.turns.push({ round, turnId: submitted.turnId, metrics: item.metrics, requests: roundRequests, calls: roundCalls, dom: item.dom, progress: { round, before: item.before, after: observed } });
      item.progress.push({ round, after: observed });
      item.requestTotals = { rounds: item.turns.length, requests: item.turns.reduce((sum, turn) => sum + turn.requests.length, 0), tokens: item.turns.reduce((sum, turn) => sum + (turn.metrics.usage?.totalTokens ?? 0), 0) };
      save();
      if (item.stop) break;
      // A cancelled, failed or errored turn is never continued.
      assert.equal(final.metrics.status, 'completed', 'Model task did not complete successfully; a cancelled or failed turn is never continued');
      const available = await panel(world.id, 'godot.candidateList', { offset: 0, limit: 32 });
      if (available.items.some(row => !beforeCandidates.has(row.candidateId) && row.status === 'ready')) break;
      if (round + 1 === MAX_ROUNDS) item.continuationExhausted = true;
      }
      if (item.stop) { item.outcome = 'stopped'; item.behavior = 'not accepted; explicit operator stop'; break; }
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
      const play = await p8('exercise', caseId, {}, 300000);
      // Every frame is written to disk with its own hash and its real receipt
      // time; the raw bytes are replaced by the file record so the report stays
      // readable while the frames remain on disk for an independent review.
      let frameIndex = 0;
      item.gameplay = { ...play, actions: play.actions.map((action, index) => {
        if (!action.frame) return { ...action, image: null };
        const bytes = Buffer.from(action.frame.pngBase64, 'base64'), file = path.join(out, `${caseId}-frame-${frameIndex++}-${action.op}.png`);
        fs.writeFileSync(file, bytes);
        const { pngBase64, ...rest } = action.frame;
        return { ...action, frame: { ...rest, file, bytes: bytes.length, sha256: hash(bytes) } };
      }) };
      // The case is not "played" because the commands returned; each required
      // mechanic needs its own direct evidence, and a claim no product channel
      // reports stays review-required rather than being called verified.
      item.gameplay.verdict = evaluateGameplay({ caseId, exercise: item.gameplay, source: item.source });
      item.reviewRequired = item.gameplay.verdict.reviewRequired;
      item.contentSnapshot = { ...(item.contentSnapshot ?? {}), candidateFiles: item.source.length, initialFiles: item.initialSource?.length ?? null };
      item.behavior = item.gameplay.verdict.verified
        ? 'verified: every gameplay criterion has direct evidence'
        : 'not verified: failed=' + JSON.stringify(item.gameplay.verdict.failed) + ' insufficient=' + JSON.stringify(item.gameplay.verdict.insufficient) + ' reviewRequired=' + JSON.stringify(item.gameplay.verdict.reviewRequired);
      if (!item.gameplay.verdict.verified) process.exitCode = 1;
      await panel(world.id, 'godot.runtimeSave', { freeze: true }); item.saved = await state(world.id);
      item.outcome = CASE_PIPELINE_COMPLETE; save();
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
} catch (error) { report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  try { await stop(); if (launch) assertCleanHeadlessShutdown(launch); } catch (error) { report.shutdownError = String(error); report.passed = false; process.exitCode = 1; }
  try { if (relay) { await relay.close(); report.relay = relay.snapshot(); } } catch (error) { report.relayCloseError = String(error); process.exitCode = 1; }
  try { journal.close(); } catch (error) { report.journalCloseError = String(error); process.exitCode = 1; }
  try {
    const thisRun = (report.relay?.attempts.length ?? journal.entries.length) - journal.initialAttempts.length;
    report.admissions = admissionAccounting({ authorization, initialInLedger: journal.initialAttempts.length, thisRun });
    // The historical ledgers are references. If either changed, this run's
    // accounting is not trustworthy and must not be reported as evidence.
    const historicalBefore = authorization.historical ?? [];
    const historicalAfter = historicalBefore.map(item => readLedgerSummary(item.path));
    report.historicalAdmissions = historicalBefore.map((item, index) => ({ path: item.path, existed: item.exists, entries: item.entries, entriesAfter: historicalAfter[index].entries, sha256Before: item.sha256, sha256After: historicalAfter[index].sha256 }));
    if (historicalBefore.some((item, index) => item.sha256 !== historicalAfter[index].sha256)) { report.historicalLedgerMutated = true; process.exitCode = 1; }
  } catch (error) { report.accountingError = String(error); process.exitCode = 1; }
  report.summary = summarizeRun({ requestedCases: cases, executedCases: report.cases.map(item => item.caseId), cases: report.cases, stopped: !!report.stopped, error: report.error ?? report.shutdownError ?? null, requestLimitReached: authorization.requestLimit !== null && (report.relay?.attempts.length ?? 0) >= authorization.requestLimit });
  report.pipelinePassed = report.summary.pipelinePassed; report.behaviorVerified = report.summary.behaviorVerified; report.reviewRequired = true; report.passed = false;
  // R9: a single-case run says so in the field names, so it cannot be read as
  // "both cases passed".
  report.pipelinePassedForSelectedCase = report.summary.pipelinePassed;
  report.behaviorVerifiedForSelectedCase = report.summary.behaviorVerified;
  report.reviewItems = report.cases.flatMap(item => (item.reviewRequired ?? []).map(id => ({ caseId: item.caseId, id, evidence: item.gameplay?.verdict?.criteria?.find(row => row.id === id)?.evidence ?? null })));
  report.reviewMerged = false;
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ out, runId, requestedCases: cases, caseSelection: report.caseSelection, summary: { pipelinePassed: report.summary.pipelinePassed, behaviorVerified: report.summary.behaviorVerified, singleCasePassed: report.summary.singleCasePassed, combinedTwoCasePassed: report.summary.combinedTwoCasePassed, passed: report.summary.passed, reviewRequired: report.reviewItems.map(item => item.caseId + ':' + item.id) }, cases: report.cases.map(({ caseId, outcome, behavior, error }) => ({ caseId, outcome, behavior, error })), admissions: report.admissions, requests: report.relay?.attempts.length, error: report.error, shutdownError: report.shutdownError }));
}
