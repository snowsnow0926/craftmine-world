import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRIVATE_PLAY_OPS,validateHeadlessPlayAction} from '../../vendor/pi-desktop/apps/desktop/electron/main/headless-play-action.ts';
import {createGodotExploration} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-exploration.ts';
const identity={worldId:'world',buildId:'build',instanceId:'instance'},args={action:'interact',frames:1};
test('host rejects missing authority, stale identity and arbitrary payloads',()=>{
 assert.throws(()=>validateHeadlessPlayAction(false,identity,identity,args),/HEADLESS_ONLY/);
 for(const bad of [null,{...identity,instanceId:'old'},{...identity,headless:true}]) assert.throws(()=>validateHeadlessPlayAction(true,identity,bad,args),/IDENTITY/);
 for(const bad of [{...args,headless:true},{action:'attack',frames:1},{action:'interact',frames:2},{action:'interact',frames:true}]) assert.throws(()=>validateHeadlessPlayAction(true,identity,identity,bad),/ARGUMENTS/);
 validateHeadlessPlayAction(true,identity,identity,args);
 assert.deepEqual([...PRIVATE_PLAY_OPS].sort(),['headless-play-authorize','headless-play-cancel','play-action']);
});
test('new action uses dedicated route while interact keeps business semantics',async()=>{
 const calls=[];
 const access={observe:async()=>({format:'craftmine.godot-observation/1',...identity,baseId:'creation-sandbox',payload:{}}),
  action:async(op,input)=>{calls.push(['business',op,input]);return {interacted:false};},
  playAction:async(id,input)=>{calls.push(['private',id,input]);return {dispatched:true};}};
 const evidence=await createGodotExploration(access)({...identity,steps:[{op:'interact',args:{}},{op:'play-action',args}]});
 assert.deepEqual(calls,[['business','interact',{}],['private',identity,args]]);
 assert.equal(evidence.actionPhysicsTicks,3);
 delete access.playAction;
 await assert.rejects(createGodotExploration(access)({...identity,steps:[{op:'play-action',args}]}),/UNAVAILABLE/);
});
test('invalid action plans fail before any callback and never pass a token',async()=>{
 let calls=0;
 const access={observe:async()=>{calls++;throw Error('should not run');}};
 for(const bad of [{...args,token:'secret'},{...args,action:'ui_cancel'},{...args,frames:600},{...args,script:'test'}]){
  await assert.rejects(createGodotExploration(access)({...identity,steps:[{op:'play-action',args:bad}]}));
 }
 assert.equal(calls,0);
});
test('production request gates private ops before forwarding, capability requires protected controller',()=>{
 const host=readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts',import.meta.url),'utf8');
 assert.match(host,/async request\([^]*?PRIVATE_PLAY_OPS\.has\(op\)[^]*?instance\.runtime\.request\(op, args\)/);
 assert.match(host,/if \(hasHeadlessController\(\)\)[^]*?runtime\.request\("headless-play-authorize"/);
 const guard=readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless.ts',import.meta.url),'utf8');
 assert.match(guard,/hasHeadlessController = \(\) => isHeadlessAcceptance\(\) && profile !== null && process.connected === true/);
 const catalog=JSON.parse(readFileSync(new URL('../../plugins/craftmine-world/manifest.json',import.meta.url),'utf8'));
 assert.equal(catalog.contributes.agentTools.some(tool=>/play.action|headless.play/.test(tool.name)),false);
});
