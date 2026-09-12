// Continue an already adopted packaged pet world without reinstalling or rebuilding.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveCreationNativeLaunch } from './helpers/creation-native-launch.mjs';
import { adoptionEnvironment } from './helpers/promo-adoption-contract.mjs';
import { completeCreationProgress } from './helpers/creation-model-evaluation.mjs';
import { assertPetProgress, assertPetSaveReceipt, validatePetProductCall } from './helpers/pet-product-contract.mjs';

const sourceFile = process.argv[2];
assert.ok(sourceFile && path.isAbsolute(sourceFile));
const sourceBytes = fs.readFileSync(sourceFile);
const source = JSON.parse(sourceBytes);
assert.equal(source.format, 'craftmine.pet-product-demo/1');
assert.equal(source.applied.status, 'applied');
assert.equal(source.check.status, 'passed');
const sourceRoot = path.dirname(sourceFile), profile = path.join(sourceRoot, 'profile');
const markerFile = path.join(profile, 'headless-profile.json');
const markerBytes = fs.readFileSync(markerFile), marker = JSON.parse(markerBytes);
const client = resolveCreationNativeLaunch({ root: process.cwd(), packagedRoot: process.argv[3], requiredGuards: ['godotCaptureBoundView', 'godotCaptureBoundState', 'godotExplore'] });
assert.equal(client.identity.inventorySha256, source.packageIdentity.inventorySha256);
const out = path.join(sourceRoot, 'continuation-' + randomUUID());
fs.mkdirSync(out);
const binding = { worldId: source.worldId, formalIdentity: null, captureIdentity: null };
const entities = source.source.items.filter(item => item.supported);
assert.equal(entities.length, 1);
const entityId = entities[0].entityId;
const report = { format: 'craftmine.pet-product-continuation/2', sourceReport: sourceFile, worldId: binding.worldId, entityId, packageInventorySha256: client.identity.inventorySha256, modelCalls: 0, launches: [], calls: [], captures: [], ok: false };
const saveReport = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const env = adoptionEnvironment(client, { out: sourceRoot, profile, token: marker.token });
let host;

function start() {
  const child = spawn(client.executable, client.args, { cwd: client.cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const launch = { ready: false, ended: false, audit: null, pending: new Map(), child };
  const evidence = { startedAt: new Date().toISOString(), exit: null, audit: null };
  const index = report.launches.push(evidence);
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => fs.appendFileSync(path.join(out, `launch-${index}-${stream}.log`), bytes));
  child.on('message', message => {
    if (message.type === 'craftmine-headless-ready') launch.ready = true;
    if (message.type === 'craftmine-headless-exit') evidence.audit = launch.audit = message;
    const pending = launch.pending.get(message.id);
    if (pending) {
      clearTimeout(pending.timer); launch.pending.delete(message.id);
      message.error ? pending.reject(Error(message.error)) : pending.resolve(message.result);
    }
  });
  launch.exited = new Promise(resolve => child.once('exit', (code, signal) => {
    launch.ended = true; evidence.exit = { code, signal };
    for (const pending of launch.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('HOST_EXITED')); }
    launch.pending.clear(); resolve(evidence.exit);
  }));
  child.on('error', error => { evidence.error = String(error); });
  return launch;
}

function rpc(method, fields = {}) {
  // Resume can only read, enter play, perform finite gameplay, save and quit.
  assert.ok(['status', 'primaryMode', 'godotObserve', 'godotSnapshot', 'godotCaptureBoundState', 'godotCaptureBoundView', 'godotExplore', 'worldPanel', 'quit'].includes(method));
  if (method === 'worldPanel') assert.ok(['godot.runtimeResume', 'godot.runtimeSave'].includes(fields.channel));
  validatePetProductCall(method, fields, binding);
  assert.ok(host && !host.ended, 'HOST_NOT_RUNNING');
  report.calls.push({ method, fields });
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { host.pending.delete(id); reject(Error('HOST_CALL_TIMEOUT:' + method)); }, 120000);
    host.pending.set(id, { resolve, reject, timer });
    host.child.send({ type: 'craftmine-headless', id, method, ...fields });
  });
}

async function until(read, accept) {
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.ok(!host.ended, 'HOST_EXITED_BEFORE_READY');
    const value = await read();
    if (accept(value)) return value;
    await delay(500);
  }
  throw Error('HOST_READY_TIMEOUT');
}
async function enter() {
  host = start();
  await until(() => host.ready, value => value);
  const status = await until(() => rpc('status'), value => value.windows?.length);
  assert.deepEqual(status.violations, []);
  await until(() => rpc('primaryMode'), value => value.entry);
  await rpc('primaryMode', { payload: { action: 'play' } });
  await until(() => rpc('primaryMode'), value => value.play);
  const observed = await until(async () => {
    try { return await rpc('godotObserve'); }
    catch (error) {
      if (String(error).includes('No world runtime is running')) return null;
      throw error;
    }
  }, value => value?.worldId === binding.worldId && value.instanceId);
  binding.formalIdentity = { worldId: observed.worldId, buildId: observed.buildId, instanceId: observed.instanceId };
  return observed;
}
const panel = (channel, payload = {}) => rpc('worldPanel', { channel, payload: { worldId: binding.worldId, ...payload } });
const snapshot = () => rpc('godotSnapshot').then(completeCreationProgress);
const explore = steps => rpc('godotExplore', { payload: { ...binding.formalIdentity, steps: steps.map(step => ({ ...step, capture: false })) } });
async function capture(name) {
  const state = await rpc('godotCaptureBoundState');
  binding.captureIdentity = state.formal;
  const picture = await rpc('godotCaptureBoundView', { payload: binding.captureIdentity });
  const bytes = Buffer.from(picture.pngBase64, 'base64'), file = path.join(out, name + '.png');
  fs.writeFileSync(file, bytes);
  report.captures.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
async function close() {
  if (!host || host.ended) return;
  await rpc('quit');
  const exit = await host.exited;
  assert.equal(exit.code, 0);
  for (const field of ['violations', 'pageErrors', 'shutdownFailures']) assert.deepEqual(host.audit?.[field], []);
}
try {
  report.opened = await enter();
  report.before = await snapshot();
  const originalPet = assertPetProgress(report.before, binding.worldId, entityId);
  await panel('godot.runtimeResume');
  report.walk = await explore([{ op: 'walk', args: { forward: -1, right: 0, frames: 15 } }, { op: 'wait', args: { frames: 120 } }]);
  report.afterWalk = await snapshot();
  const pet = assertPetProgress(report.afterWalk, binding.worldId, entityId), player = report.afterWalk.body.player.position;
  const dx = pet.position[0] - player[0], dz = pet.position[2] - player[2];
  // Frozen creation.tscn CameraRig Y=.65; published dog Cylinder height=.77.
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(pet.position[1] + .385 - player[1] - .65, Math.hypot(dx, dz));
  report.aim = { yaw, pitch, player, pet: pet.position };
  assert.ok(pitch < 0, 'DOG_REQUIRES_DOWNWARD_AIM');
  report.interaction = await explore([{ op: 'look', args: { yaw, pitch } }, { op: 'play-action', args: { action: 'interact', frames: 1 } }]);
  report.afterInteract = await snapshot();
  assert.equal(assertPetProgress(report.afterInteract, binding.worldId, entityId).interactionCount, originalPet.interactionCount + 1);
  await capture('interaction');
  report.saved = await panel('godot.runtimeSave', { freeze: true });
  assertPetSaveReceipt(report.saved, binding.formalIdentity);
  report.savedSnapshot = await snapshot();
  const oldIdentity = binding.formalIdentity;
  await close();
  report.reopened = await enter();
  assert.notEqual(binding.formalIdentity.instanceId, oldIdentity.instanceId);
  assert.equal(binding.formalIdentity.buildId, oldIdentity.buildId);
  report.reopenedSnapshot = await snapshot();
  assert.deepEqual(report.reopenedSnapshot, report.savedSnapshot);
  assertPetProgress(report.reopenedSnapshot, binding.worldId, entityId);
  await capture('reopened');
  await close();
  client.assertUnchanged();
  assert.deepEqual(fs.readFileSync(sourceFile), sourceBytes);
  assert.deepEqual(fs.readFileSync(markerFile), markerBytes);
  report.ok = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  try { await close(); } catch (error) { report.shutdownError = String(error); process.exitCode = 1; }
  report.endedAt = new Date().toISOString(); saveReport();
  console.log(JSON.stringify({ out, ok: report.ok, error: report.error }));
}
