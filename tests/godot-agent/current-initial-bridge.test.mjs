import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {initialLoadBridgeRepair,initialLoadBridgeResource} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-initial-load-repair.ts';
const current=fs.readFileSync(new URL('../../desktop/godot/shared/runtime_bridge.gd',import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
const old='318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76';
const currentHash='58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3';
test('current shipped bridge is already repaired and does not rewrite source',()=>{
 assert.equal(digest(current),currentHash);assert.equal(initialLoadBridgeRepair(currentHash,current),null);
 assert.throws(()=>initialLoadBridgeRepair(currentHash,Buffer.concat([current,Buffer.from('\n# changed')])),/PIN_MISMATCH/);
});

test('previous stock bridge remains unchanged while current bundled bytes are verified',()=>{
 const previous='418bbb6f2a87b3092fb542b35a8c2007fef4725f554216f01fa48414c40ef6d3';
 assert.equal(initialLoadBridgeRepair(previous,current),null);
 assert.throws(()=>initialLoadBridgeRepair(previous,Buffer.from('custom bundle')),/PIN_MISMATCH/);
});
test('only pinned original bridge upgrades to its dependency-compatible frame-independent successor',()=>{
 const legacy=fs.readFileSync(new URL('../../desktop/godot/'+initialLoadBridgeResource(old),import.meta.url));
 const patch=initialLoadBridgeRepair(old,legacy);assert.equal(patch.expectedHash,old);assert.equal(patch.path,'craftmine_shared/runtime_bridge.gd');assert.deepEqual(Buffer.from(patch.bytesBase64,'base64'),legacy);
 assert.throws(()=>initialLoadBridgeRepair(old,current),/PIN_MISMATCH/);
 assert.throws(()=>initialLoadBridgeRepair(old,Buffer.from('custom')),/PIN_MISMATCH/);
 assert.throws(()=>initialLoadBridgeRepair(digest('custom'),current),/CUSTOMIZED/);
});
