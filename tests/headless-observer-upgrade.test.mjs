import test from 'node:test';import assert from 'node:assert/strict';
import {createHeadlessObserverUpgrade} from '../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-observer-upgrade.ts';
const identity={sessionId:'session-a',worldId:'world-a'};
function fixture(){const calls=[];let active=false;const run=createHeadlessObserverUpgrade({observe:async()=>({worldId:identity.worldId}),active:()=>active,invoke:async(name,...args)=>{calls.push([name,...args]);return {session:{id:identity.sessionId}};},panel:async(name,args)=>{calls.push([name,args]);if(name==='godot.creationTarget')return {...identity,upgradeId:'upgrade-a',captureId:null,target:null,reason:'SCENE_OBJECT_OBSERVER_UPGRADE_REQUIRED'};return {operationId:args.operationId,sessionId:args.sessionId,worldId:identity.worldId,phase:'applied'};}});return {run,calls,setActive:()=>active=true};}
test('finite observer flow calls the same normal UI APIs without provider setup or model send',async()=>{
 const f=fixture(),hint=await f.run('playerObserverHint',identity);assert.equal(hint.upgradeId,'upgrade-a');
 await f.run('playerObserverUpgrade',{...identity,upgradeId:hint.upgradeId,operationId:'operation-a'});
 assert.equal((await f.run('playerObserverStatus',{...identity,operationId:'operation-a'})).active,false);
 assert.deepEqual(f.calls.map(x=>x[0]),['sessionGet','notificationSetViewingSession','godot.creationTarget','godot.creationEdit','godot.creationEditStatus']);
 assert.equal(f.calls[3][1].action,'upgrade-observer');assert.equal(f.calls[3][1].captureId,'upgrade-a');
 await assert.rejects(f.run('playerObserverUpgrade',{...identity,upgradeId:'upgrade-a',operationId:'operation-a'}),/ALREADY_STARTED/);
});
test('unobserved handles, cross-session identity, arbitrary payloads and busy sessions are refused',async()=>{
 const f=fixture();await assert.rejects(f.run('playerObserverUpgrade',{...identity,upgradeId:'upgrade-a',operationId:'operation-a'}),/HINT_REQUIRED/);await f.run('playerObserverHint',identity);
 for(const [method,input] of [['playerObserverHint',{...identity,sessionId:'other'}],['playerObserverStatus',{...identity,operationId:'unknown'}],['playerObserverUpgrade',{...identity,upgradeId:'wrong',operationId:'a'}],['playerObserverUpgrade',{...identity,upgradeId:'upgrade-a',operationId:'a',script:'x'}],['agentPrompt',identity]])await assert.rejects(f.run(method,input));
 assert.ok(!f.calls.some(x=>x[0]==='godot.creationEdit'));f.setActive();await assert.rejects(f.run('playerObserverHint',identity),/BUSY/);
});
