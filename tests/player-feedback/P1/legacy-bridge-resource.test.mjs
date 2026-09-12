import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {register} from 'node:module';
register(new URL('../../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {initialLoadBridgeRepair:repair,initialLoadBridgeResource:resource}=await import('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-initial-load-repair.ts');
import {loadRuntimeDistribution,stageRuntimeSourceSnapshot} from '../../../desktop/delivery/lib/runtime-distribution.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const old='318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76',fixed='faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2',current='418bbb6f2a87b3092fb542b35a8c2007fef4725f554216f01fa48414c40ef6d3';
const bytes=hash=>fs.readFileSync(path.join(root,'desktop/godot',resource(hash)));
test('old source selects the exact historical dependency-compatible resource; current source is a checked no-op',()=>{
 assert.equal(sha(bytes(old)),fixed);assert.deepEqual(bytes(old),execFileSync('git',['show','487dc779:desktop/godot/shared/runtime_bridge.gd'],{cwd:root,windowsHide:true}));
 assert.equal(sha(bytes(current)),current);assert.equal(repair(current,bytes(current)),null);assert.equal(repair(fixed,bytes(fixed)),null);
 const patch=repair(old,bytes(old));assert.equal(patch.expectedHash,old);assert.equal(patch.path,'craftmine_shared/runtime_bridge.gd');assert.equal(sha(Buffer.from(patch.bytesBase64,'base64')),fixed);
 assert.throws(()=>repair(old,bytes(current)),/PIN_MISMATCH/);assert.throws(()=>repair(current,bytes(old)),/PIN_MISMATCH/);
 assert.throws(()=>repair(sha(Buffer.from('customized')),bytes(current)),/CUSTOMIZED/);
});
test('historical repair adds no preload dependency and retains frame-independent serial drain',()=>{
 const prior=execFileSync('git',['show','eae279915094f09d987ef0eb747eba20ef92cd0e:desktop/godot/shared/runtime_bridge.gd'],{cwd:root,windowsHide:true}).toString();
 const literals=text=>[...text.matchAll(/preload\("([^"]+)"\)/g)].map(m=>m[1]);
 assert.deepEqual(literals(bytes(old).toString()),literals(prior));assert.ok(!bytes(old).includes(Buffer.from('headless_play_action')));
 assert.match(bytes(old).toString(),/queue.append\(request\)[\s\S]*?_drain_queue\(\)/);
 assert.match(bytes(old).toString(),/if busy or queue.is_empty\(\) or browser == null:/);
});
test('fixed resource ships through the actual delivery filter with exact hash; remains outside materializer copies',()=>{
 const relative='desktop/godot/'+resource(old),index=loadRuntimeDistribution(root),pin=index.get(relative);
 assert.equal(pin.length,1);assert.deepEqual(pin[0].distribution,['app-bundle']);assert.equal(pin[0].sha256,fixed);
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/legacy-bridge-delivery-'));
 const result=stageRuntimeSourceSnapshot(new Map([[relative,{bytes:bytes(old)}]]),path.join(out,'runtime'),index);
 assert.equal(result.included.length,1);assert.deepEqual(fs.readFileSync(path.join(out,'runtime',resource(old))),bytes(old));
 assert.ok(!fs.readFileSync(path.join(root,'desktop/godot/shared/materialize.mjs'),'utf8').includes('repairs/'));
});
