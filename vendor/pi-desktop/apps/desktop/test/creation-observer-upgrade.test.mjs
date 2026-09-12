import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {createCreationTargetService} from '../electron/main/creation-target-service.ts';
import {SCENE_OBSERVER_RESOURCES,loadSceneObserverPins,canUpgradeSceneObserver,hasCurrentSceneObserver} from '../electron/main/creation-observer-pins.ts';
import {SCENE_OBSERVER_UPGRADE} from '../electron/main/creation-managed-migrations.ts';
import {parseCreationTarget,creationRequestContext} from '../src/lib/creation-target.ts';
const root=path.resolve(import.meta.dirname,'../../../../..'),resourcesRoot=path.join(root,'desktop/godot');
const sha=x=>createHash('sha256').update(x).digest('hex');
const filesAt=(rev,crlf=false)=>Object.entries(SCENE_OBSERVER_RESOURCES).map(([name,resource])=>{let text=execFileSync('git',['show',`${rev}:desktop/godot/${resource}`],{cwd:root,encoding:'utf8',windowsHide:true}).replace(/\r\n/g,'\n');if(crlf)text=text.replace(/\n/g,'\r\n');return {path:name,sha256:sha(text),bytes:Buffer.byteLength(text)};});
const pins=loadSceneObserverPins(resourcesRoot),session={projectId:'project-a',sessionId:'session-a'},context={...session,turnId:'turn-a'};
function fixture(t,files){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'observer-upgrade-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let worldId='world-a';const identity={worldId,buildId:'build-a',instanceId:'instance-a'},formal={worldId,buildId:'build-a',baseId:'creation-sandbox',sourceRevision:3,manifestHash:'a'.repeat(64)};
 const service=createCreationTargetService({directory,now:()=>1000,selection:async()=>worldId,instance:()=>identity,descriptor:async()=>formal,sceneObjectSourcePins:pins,source:async()=>({...formal,files}),sample:async()=>({...identity,baseId:'creation-sandbox',sampledAt:new Date(1000).toISOString(),payload:{player:{position:[0,1,0]},creation:{target:{entityId:null,position:[0,1,-2],normal:[0,0,1],surface:'prop',revision:1},sceneObjectTarget:{nodePath:'untrusted/old/prop',objectId:'99'},sceneObjectSelection:{status:'hit'}}}})});return {service,changeWorld:()=>worldId='other'};}
test('exact released 32cd/594f LF and CRLF cohorts receive only an uneditable maintenance handle',async t=>{
 for(const rev of ['32cd879d','594f698b5206'])for(const crlf of [false,true]){
  const files=filesAt(rev,crlf);assert.equal(hasCurrentSceneObserver(files,pins),false);assert.equal(canUpgradeSceneObserver(files,pins),true);
  const {service}=fixture(t,files),hint=await service.capture(11,session),display=parseCreationTarget(hint);
  assert.equal(hint.captureId,null);assert.ok(hint.upgradeId);assert.equal(hint.target,null);assert.equal(hint.sceneObjectTarget,undefined);assert.equal(creationRequestContext(display),undefined);
  const ref={creationTarget:{captureId:hint.upgradeId}};await assert.rejects(service.validate(11,ref,session),/UPGRADE_HANDLE_REQUIRED/);await assert.rejects(service.validate(12,ref,session,'observer-upgrade'),/EXPIRED/);await assert.rejects(service.validate(11,ref,{...session,sessionId:'other'},'observer-upgrade'),/SESSION_CHANGED/);
  const capture=await service.validate(11,ref,session,'observer-upgrade');assert.equal(capture.observerUpgradeOnly,true);assert.equal(capture.entities,undefined);assert.equal(capture.sceneObjectTarget,undefined);assert.deepEqual(capture.target,{entityId:null,position:null,normal:null,surface:'none',revision:1});
  await service.policy({worldId:'world-a',autoApply:true});await service.bind(11,capture,context,'world-a','升级世界观察组件，保留作品和进度');assert.equal(service.bound(context,'world-a').autoApply,false);
  await assert.rejects(service.validate(11,ref,session,'observer-upgrade'),/EXPIRED/);
 }
});
test('unknown, missing, alias and changed installed destinations cannot gain the upgrade capability',async t=>{
 const files=filesAt('32cd879d');for(const changed of [files.slice(1),files.map((x,i)=>i===4?{...x,sha256:'f'.repeat(64)}:x),[...files,{...files[0],path:files[0].path+'.remap'}]]){assert.equal(canUpgradeSceneObserver(changed,pins),false);const {service}=fixture(t,changed);await assert.rejects(service.capture(11,session),/UPGRADE_REQUIRED/);}
 const changedPins={...pins,[SCENE_OBSERVER_UPGRADE.files[0].source]:['b'.repeat(64)]};assert.equal(canUpgradeSceneObserver(files,changedPins),false);
});
test('a world switch invalidates an already issued maintenance handle',async t=>{
 const f=fixture(t,filesAt('32cd879d')),hint=await f.service.capture(11,session);f.changeWorld();await assert.rejects(f.service.validate(11,{creationTarget:{captureId:hint.upgradeId}},session,'observer-upgrade'),/STALE/);
});
