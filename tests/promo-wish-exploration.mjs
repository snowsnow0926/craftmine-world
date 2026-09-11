// Inspect an adopted pilot through normal gameplay controls, without a model call.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {creationPackagedRoot, resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {adoptionEnvironment,inspectAdoptionSource,validateExplorationSource,validateExplorationCall,modelFreeExecutionEvidence} from './helpers/promo-adoption-contract.mjs';
import {assertProofs,fileProof,readCheckpointJson} from './helpers/promo-checkpoint-contract.mjs';

const adoptionFile = process.argv[2];
assert.ok(adoptionFile && path.isAbsolute(adoptionFile), 'Pass an absolute successful adoption report');
const adoptionProof=fileProof(adoptionFile);
const adoption = readCheckpointJson(adoptionFile);
assert.equal(adoption.format, 'craftmine.promo-adoption/1');
assert.equal(adoption.ok, true);
const sourceProof=inspectAdoptionSource(adoption.originalReport);
sourceProof.proofs.push(adoptionProof);
const {original,out,profile,marker}=sourceProof;
const packagedRoot = creationPackagedRoot();
assert.ok(packagedRoot, 'Explicit --packaged-root is required for diagnostic product identity');
const client = resolveCreationNativeLaunch({root: process.cwd(), packagedRoot, requiredGuards: ['godotExplore']});
validateExplorationSource(adoption,sourceProof,client.identity);
const budgetFile = sourceProof.budgetFile;
const budgetBytes = budgetFile?fs.readFileSync(budgetFile, 'utf8'):null;
assertProofs(sourceProof.proofs);
const planFlag = process.argv.indexOf('--plan');
const aimFlag=process.argv.indexOf('--aim-creation-entity');
const aimEntity=aimFlag<0?null:process.argv[aimFlag+1];
if(aimFlag>=0)assert.ok(typeof aimEntity==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(aimEntity),'Exact creation entity ID required');
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
  sourceFormat:original.format,modelCallsAdded:null,modelRequestsAdded: null, sourceEdits: 0, visual: 'UNVERIFIED', checks: [],
};
const controllerCalls=[];
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
    validateExplorationCall(method,fields,sourceProof.selection);controllerCalls.push(method==='worldPanel'?method+':'+fields.channel:method);
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
  if(aimEntity){
    // Test-only aiming from fresh observed geometry. Wait for deceleration;
    // never infer the final position from a previous walk's frame count.
    assert.equal(before.baseId,'creation-sandbox');
    const settled=await rpc('godotExplore',{payload:{...identity,steps:[{op:'wait',args:{frames:30}}]}});
    const current=settled.after,body=current.payload,entity=body.creation.entities.find(e=>e.id===aimEntity);
    assert.ok(entity,'Observed target entity required');
    const position=body.player.position;
    // The stock door's aim area rotates with its visible hinge. An open door
    // has no blocking collider, so propose its observed mesh center instead.
    // The real ray identity below still has to confirm this aiming hypothesis.
    const bounds=entity.collisionBounds??entity.meshBounds;
    assert.ok(bounds,'Observed collision or mesh bounds required');
    assert.ok([position,bounds.min,bounds.max].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)));
    // Eye offset from the stock creation.tscn; this is only a proposed look.
    // The actual runtime ray must independently confirm the same entity.
    const center=bounds.min.map((v,i)=>(v+bounds.max[i])/2),delta=center.map((v,i)=>v-position[i]-(i===1?.65:0));
    const yaw=Math.atan2(-delta[0],-delta[2]),pitch=Math.atan2(delta[1],Math.hypot(delta[0],delta[2]));
    const aimed=await rpc('godotExplore',{payload:{...identity,steps:[{op:'look',args:{yaw,pitch}},{op:'wait',args:{frames:4}}]}});
    report.aim={entityId:aimEntity,eyeOffsetAssumption:.65,settled,aimed};
    assert.equal(aimed.after.payload.creation.target.entityId,aimEntity,'Actual ray must hit intended entity before interaction');
  }
  const exploration = await rpc('godotExplore', {payload: {...identity, steps}});
  for (const [index, capture] of exploration.captures.entries()) {
    const imageFile = 'view-' + (index + 1) + '.png';
    fs.writeFileSync(path.join(directory, imageFile), Buffer.from(capture.image.pngBase64, 'base64'));
    delete capture.image.pngBase64;
    capture.image.file = imageFile;
  }
  report.exploration = exploration;
  await stop();
  if(budgetFile)assert.equal(fs.readFileSync(budgetFile, 'utf8'), budgetBytes, 'No additional provider reservations');
  assertProofs(sourceProof.proofs);
  client.assertUnchanged();
  report.noModelExecution=modelFreeExecutionEvidence(exitReport,controllerCalls);report.modelCallsAdded=0;report.modelRequestsAdded=0;
  report.checks.push('original adopted build inspected', 'bounded real adapter actions and captures', 'only non-model controller calls', 'no package edits', 'no input/focus/shutdown violations');
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = String(error.stack ?? error); process.exitCode = 1;
  console.error(error.message);
} finally {
  if (!ended) try {await stop();} catch (error) {report.shutdownError = String(error); report.ok = false; process.exitCode = 1;}
  if(budgetFile)report.budgetUnchanged = fs.readFileSync(budgetFile, 'utf8') === budgetBytes;
  try{assertProofs(sourceProof.proofs);client.assertUnchanged();report.stateIntegrityVerified=true;}catch(error){report.ok=false;report.stateIntegrityVerified=false;report.integrityError=String(error.message);process.exitCode=1;}
  try{assertProofs(sourceProof.proofs);}catch(error){report.integrityError=String(error);report.ok=false;process.exitCode=1;}
  for (const call of pending.values()) clearTimeout(call.timer);
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + directory);
}
