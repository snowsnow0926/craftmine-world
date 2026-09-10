import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOfficialTargetDefault,OFFICIAL_TARGET_DEFAULT,stopDefaultClient,finalizeDefaultClient} from './default-client-audit.mjs';
const target=()=>({targetId:'target_a',defaults:{format:'craftmine.target-feedback-default/1',values:{hitFlashMilliseconds:120},source:{kind:OFFICIAL_TARGET_DEFAULT.kind,path:OFFICIAL_TARGET_DEFAULT.path,sha256:OFFICIAL_TARGET_DEFAULT.sha256}}});
test('official expectation rejects a self-consistent wrong returned default and foreign provenance',()=>{
 assert.equal(assertOfficialTargetDefault(target()),120);
 for(const change of [v=>v.defaults.values.hitFlashMilliseconds=250,v=>v.defaults.source.kind='target-script',v=>v.defaults.source.path='other.tres',v=>v.defaults.source.sha256='a'.repeat(64),v=>v.targetId='target_b']){const value=target();change(value);assert.throws(()=>assertOfficialTargetDefault(value));}
});
const limits={quitMs:5,graceMs:5,killMs:10};
test('owned child that never exits after kill rejects within its bounded deadline',async()=>{
 const launch={};let kills=0;await assert.rejects(stopDefaultClient({ended:()=>false,quit:()=>new Promise(()=>{}),exit:new Promise(()=>{}),kill:()=>kills++,launch},limits),/CLIENT_STOP_TIMEOUT/);assert.equal(kills,1);assert.equal(launch.forcedStop,true);
});
test('natural exit skips kill; killed process exit does not erase forced-stop evidence',async()=>{
 let ended=false,kills=0,resolve;const exit=new Promise(r=>resolve=r),launch={};await stopDefaultClient({ended:()=>ended,quit:async()=>{ended=true;resolve();},exit,kill:()=>kills++,launch},limits);assert.equal(kills,0);assert.equal(launch.forcedStop,undefined);
 const forced={};let done=false,finish;const afterKill=new Promise(r=>finish=r);await stopDefaultClient({ended:()=>done,quit:async()=>{},exit:afterKill,kill:()=>{done=true;finish();},launch:forced},limits);assert.equal(forced.forcedStop,true);
});
test('final shutdown timeout or audit failure still persists finished failed report',async()=>{
 for(const message of ['CLIENT_STOP_TIMEOUT','SHUTDOWN_AUDIT_FAILED']){const report={passed:true,steps:[{passed:true}]};let saved;assert.equal(await finalizeDefaultClient(report,async()=>{throw Error(message);},()=>saved=structuredClone(report)),false);assert.equal(saved.passed,false);assert.match(saved.shutdownError,new RegExp(message));assert.ok(saved.finishedAt);assert.deepEqual(saved.steps,[{passed:true}]);}
});

test('independent expected profile hash identifies the actual checked-in official bytes',()=>{const bytes=fs.readFileSync(new URL('../../desktop/godot/bases/first-person/data/balance/training_range.tres',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),OFFICIAL_TARGET_DEFAULT.sha256);assert.match(bytes.toString(),/^hit_flash_seconds = 0\.12$/m);});
