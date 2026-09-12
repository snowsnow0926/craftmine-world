import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateBeehaveTrace} from '../../scripts/lib/beehave-trial-evidence.mjs';
import {validateExternalReceipt} from '../../scripts/lib/godot-external-receipt.mjs';
const directory=new URL('../../docs/evidence/gu6-beehave-20260912/',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,directory)));
const trace=read('beehave-trace.json');
test('actual LPAC/Web trace proves displacement, two stops and collision counterexample',()=>{
  assert.equal(validateBeehaveTrace(trace).valid,true);
  const report=read('report.json');
  assert.equal(report.passed,true);
  assert.equal(report.kits[0].browser.browserClosed,true);
  assert.equal(report.kits[0].browser.httpServerClosed,true);
  assert.deepEqual(report.kits[0].browser.input,{pointerLock:0,focus:0,pointerLocked:false});
  for(const operation of ['import','exportWeb'])assert.equal(validateExternalReceipt(read(operation+'-request.json'),read(operation+'-receipt.json'),{brokerSha256:report.broker.sha256,transportExitCode:0,expectedSourceFiles:read('beehave-source-files.json').modified}).valid,true);
});
test('archive hashes and upstream subset attribution are exact',()=>{
  for(const entry of read('manifest.json').files){const raw=fs.readFileSync(new URL(entry.file,directory));assert.equal(raw.length,entry.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256);}
  const {upstream,modified}=read('beehave-source-files.json');
  for(const entry of modified.filter(f=>f.path.startsWith('addons/')))assert.deepEqual(entry,upstream.find(f=>f.path===entry.path));
  assert.ok(!modified.some(f=>/plugin\.(cfg|gd)|addons\/gut/.test(f.path)));
});
test('static status cannot substitute for actual follow movement',()=>{
  const copy=structuredClone(trace);for(const s of copy.samples)s.actors[0].position[0]=0;
  assert.ok(validateBeehaveTrace(copy).errors.includes('ACTUAL_FOLLOW_DISPLACEMENT'));
});
test('setup teleport is rejected even if endpoint is near target',()=>{
  const copy=structuredClone(trace);copy.samples[80].actors[0].position[0]=3.5;
  assert.ok(validateBeehaveTrace(copy).errors.includes('NO_ACTOR_SETUP_TELEPORT_USED_AS_MOVEMENT'));
});
test('drift after target revoked and still velocity when disabled both fail',()=>{
  const copy=structuredClone(trace);copy.samples[225].actors[0].position[0]+=0.01;copy.samples[265].actors[0].velocity[0]=1;
  const errors=validateBeehaveTrace(copy).errors;
  assert.ok(errors.includes('REVOKED_TARGET_INTERRUPTS_AND_STOPS'));
  assert.ok(errors.includes('DISABLED_TREE_INTERRUPTS_AND_STOPS'));
});
test('disabled actor must have been moving, missing target and obstruction stay negative',()=>{
  const copy=structuredClone(trace);copy.samples[240].actors[0].velocity[0]=0;copy.samples[390].actors[1].collisions=0;copy.samples[100].actors[2].moves=1;
  const errors=validateBeehaveTrace(copy).errors;
  for(const error of ['ACTIVE_MOVEMENT_BEFORE_DISABLE','WALL_COUNTEREXAMPLE_REMAINS_BLOCKED','MISSING_TARGET_NEVER_MOVES'])assert.ok(errors.includes(error));
});
test('missing, malformed and incomplete evidence fail closed',()=>{
  for(const value of [null,{}, {...trace,samples:[null]}, {...trace,samples:trace.samples.slice(0,100)}, {...trace,events:[]}])assert.equal(validateBeehaveTrace(value).valid,false);
});
