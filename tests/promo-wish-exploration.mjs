// Inspect an adopted pilot through normal gameplay controls, without a model call.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {creationPackagedRoot, resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {adoptionEnvironment,inspectAdoptionSource} from './helpers/promo-adoption-contract.mjs';
import {assertProofs} from './helpers/promo-checkpoint-contract.mjs';

const adoptionFile = process.argv[2];
assert.ok(adoptionFile && path.isAbsolute(adoptionFile), 'Pass an absolute successful adoption report');
const adoption = JSON.parse(fs.readFileSync(adoptionFile));
assert.equal(adoption.format, 'craftmine.promo-adoption/1');
assert.equal(adoption.ok, true);
const original = JSON.parse(fs.readFileSync(adoption.originalReport));
const sourceProof=inspectAdoptionSource(adoption.originalReport);
const out = path.dirname(adoption.originalReport), profile = path.join(out, 'profile');
const marker = JSON.parse(fs.readFileSync(path.join(profile, 'headless-profile.json')));
const packagedRoot = creationPackagedRoot();
assert.ok(packagedRoot, 'Explicit --packaged-root is required for diagnostic product identity');
const client = resolveCreationNativeLaunch({root: process.cwd(), packagedRoot, requiredGuards: ['godotExplore']});
const budgetFile = path.join(profile, 'creation-evaluation-budget.json');
const budgetBytes = fs.readFileSync(budgetFile, 'utf8');
assertProofs(sourceProof.proofs);
const planFlag = process.argv.indexOf('--plan');
const steps = planFlag < 0
  ? [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(yaw => ({op: 'look', args: {yaw, pitch: -0.35}, capture: true}))
  : JSON.parse(fs.readFileSync(process.argv[planFlag + 1]));
assert.ok(Array.isArray(steps), 'Exploration plan must be a finite step array; the host validates all actions');
const directory = path.join(out, 'exploration-' + randomUUID());
fs.mkdirSync(directory);
const report = {
  format: 'craftmine.promo-exploration/1', originalReport: adoption.originalReport, adoptionReport: adoptionFile,
  packageIdentity: client.identity, originalPackageInventory: original.packageIdentity.inventorySha256,
  changedDiagnosticProduct: client.identity.inventorySha256 !== original.packageIdentity.inventorySha256,
  modelRequestsAdded: 0, sourceEdits: 0, visual: 'UNVERIFIED', checks: [],
};
let ready = false, ended = false, exitReport;
const pending = new Map();
const child = spawn(client.executable, client.args, {
  cwd: client.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: adoptionEnvironment(client,{out,profile,token:marker.token}),
});
for (const stream of ['stdout', 'stderr']) {
  child[stream].on('data', data => fs.appendFileSync(path.join(directory, stream + '.log'), data));
}
const exited = new Promise(resolve => child.on('exit', (code, signal) => {
  ended = true; report.exit = {code, signal}; resolve();
}));
child.on('message', message => {
  if (message.type === 'craftmine-headless-ready') ready = true;
  if (message.type === 'craftmine-headless-exit') exitReport = message;
  const call = pending.get(message.id);
  if (call) {
    clearTimeout(call.timer); pending.delete(message.id);
    message.error ? call.reject(Error(message.error)) : call.resolve(message.result);
  }
});
function rpc(method, fields = {}) {
  return new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => {
      pending.delete(id); reject(Error('TIMEOUT ' + method));
    }, 120000);
    pending.set(id, {resolve, reject, timer});
    child.send({type: 'craftmine-headless', id, method, ...fields});
  });
}
async function until(read, accept, label) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (ended) throw Error('CLIENT_EXITED ' + label);
    try {const value = await read(); if (accept(value)) return value;}
    catch (error) {
      if (!/not ready|UNAVAILABLE|WORLD_BUSY|No world runtime is running/.test(error.message)) throw error;
    }
    await delay(500);
  }
  throw Error('TIMEOUT ' + label);
}
async function stop() {
  if (!ended) {
    try {await rpc('quit');} catch {}
    await Promise.race([exited, delay(15000)]);
    if (!ended) {child.kill(); throw Error('SHUTDOWN_TIMEOUT');}
  }
  report.audit = exitReport;
  assert.deepEqual(exitReport?.violations, []);
  assert.deepEqual(exitReport?.pageErrors, []);
  assert.deepEqual(exitReport?.shutdownFailures, []);
}
try {
  await until(async () => ready, Boolean, 'controller');
  await until(() => rpc('primaryMode'), value => value.entry, 'mode entry');
  await rpc('primaryMode', {payload: {action: 'create'}});
  const before = await until(() => rpc('godotObserve'), value => value.worldId === adoption.worldId && value.instanceId, 'world');
  assert.equal(before.buildId, adoption.after.buildId, 'The original adopted game build must remain selected');
  report.before = before;
  report.resumed = await until(
    () => rpc('worldPanel', {channel: 'godot.runtimeResume', payload: {worldId: before.worldId}}),
    value => value !== undefined, 'startup transaction before resume');
  const identity = {worldId: before.worldId, buildId: before.buildId, instanceId: before.instanceId};
  const exploration = await rpc('godotExplore', {payload: {...identity, steps}});
  for (const [index, capture] of exploration.captures.entries()) {
    const imageFile = 'view-' + (index + 1) + '.png';
    fs.writeFileSync(path.join(directory, imageFile), Buffer.from(capture.image.pngBase64, 'base64'));
    delete capture.image.pngBase64;
    capture.image.file = imageFile;
  }
  report.exploration = exploration;
  await stop();
  assert.equal(fs.readFileSync(budgetFile, 'utf8'), budgetBytes, 'No additional provider reservations');
  client.assertUnchanged();
  report.checks.push('original adopted build inspected', 'bounded real adapter actions and captures', 'no provider reservations', 'no package edits', 'no input/focus/shutdown violations');
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = String(error.stack ?? error); process.exitCode = 1;
  console.error(error.message);
} finally {
  if (!ended) try {await stop();} catch (error) {report.shutdownError = String(error); report.ok = false; process.exitCode = 1;}
  report.budgetUnchanged = fs.readFileSync(budgetFile, 'utf8') === budgetBytes;
  try{assertProofs(sourceProof.proofs);}catch(error){report.integrityError=String(error);report.ok=false;process.exitCode=1;}
  for (const call of pending.values()) clearTimeout(call.timer);
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + directory);
}
