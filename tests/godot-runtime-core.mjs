// Real private plugin router + Rust process + isolated SQLite round trip.
// No Godot execution or browser/input acceptance is implied by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {CoreClient}=require('../desktop/build/craftmine.world/core-client.cjs');
const {createHostRequests}=require('../desktop/build/craftmine.world/host-requests.cjs');
const binary=process.env.CRAFTMINE_CORE_BINARY||path.join(root,'vendor/pi-desktop/target/debug/craftmine-core.exe');
const sha=text=>createHash('sha256').update(text).digest('hex');
const progress=()=>({format:'craftmine.godot-progress/1',worldId:'world-a',baseId:'top-down',baseVersion:'0.1.0',stateVersion:1,
  body:{worldId:'world-a',player:{position:[1200,40]},coins:17,inventory:{ore:2},grantedRewards:['quest-a'],
    shops:{grocer:{stock:{seed:7}}},scenePositions:{house:[800,30]},custom:{note:'测试'.repeat(60000)}}});
const saveArgs=snapshot=>{
  const text=JSON.stringify(snapshot).replace('[1200,40]','[1200.0,40.0]');
  return {worldId:'world-a',buildId:'base-a',revision:0,snapshot,runnerReceipt:{format:'craftmine.godot-runner-receipt/1',
    worldId:'world-a',buildId:'base-a',instanceId:'isolated-instance',snapshotText:text,snapshotSha256:sha(text),bytes:Buffer.byteLength(text)}};
};

test('private host round trip preserves complete large Unicode progress across service restart',async()=>{
  const parent=path.join(root,'test-results');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'godot-core-'));
  let core=new CoreClient(binary,directory);await core.start();
  try{
    const state=progress();
    await core.call('world.create',{id:'world-a',title:'Top down',world:{build:{id:'base-a',
      scene:{format:'craftmine.godot-scene/1',baseId:'top-down'},godot:{}},snapshot:state,extensions:[]}});
    const host=createHostRequests(core,{getSettings:async()=>({activeWorldId:'unrelated-world'})});
    const changed=structuredClone(state);changed.body.coins=21;
    const request=saveArgs(changed);
    const saved=await host('godotRuntime.saveProgress',request);
    assert.equal(saved.receipt.revision,1);assert.match(saved.receipt.contentHash,/^[a-f0-9]{64}$/);
    await core.stop();core=new CoreClient(binary,directory);await core.start();
    const reopened=await core.call('world.read',{id:'world-a'});
    assert.deepEqual(reopened.world.snapshot,changed);
    const nextHost=createHostRequests(core,{});
    request.revision=1;
    assert.deepEqual(await nextHost('godotRuntime.saveProgress',request),saved);
    request.runnerReceipt.snapshotText=request.runnerReceipt.snapshotText.replace('"coins":21','"coins":22');
    await assert.rejects(nextHost('godotRuntime.saveProgress',request),/GODOT_SNAPSHOT_HASH_MISMATCH/);
    await assert.rejects(nextHost('godotRuntime.describe',{worldId:'world-a',root:'C:/outside'}),error=>error.code==='INVALID_ARGUMENTS');
    await assert.rejects(nextHost('godotRuntime.describe',{worldId:'world-a'}),/INVALID_GODOT_BUILD/);
    assert.deepEqual((await core.call('world.read',{id:'world-a'})).world.snapshot,changed);
    console.log(JSON.stringify({directory,scope:'real private plugin router and Rust persistence',browser:false,executor:false}));
  }finally{await core.stop();}
});
