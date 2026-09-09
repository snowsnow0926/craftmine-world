import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {materializeBase} from '../materialize.mjs';
import {createGodotProbeEnvironment} from '../../toolchain.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../..');
fs.mkdirSync(path.join(repo,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(repo,'test-results/godot-managed-progress-'));
const engine=await createGodotProbeEnvironment(out);
const checks=[];
function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
const clone=x=>structuredClone(x);
// Compare every field: no timestamp/contact normalization is allowed.
const comparable=state=>state;
for(const [baseId,template] of [['first-person','training-range'],['top-down','town'],['side-view','ruins']]){
 const project=path.join(out,baseId),worldId='managed-'+baseId;
 materializeBase({baseId,worldId,template,out:project});
 fs.copyFileSync(path.join(here,'driver.gd'),path.join(project,'driver.gd'));
 await engine.run(baseId+'-import',['--path',project,'--editor','--import','--verbose']);
 const req=(op,args={})=>({worldId,buildId:'build-progress',instanceId:'instance-progress',op,args});
 async function run(label,requests){fs.writeFileSync(path.join(project,'requests.json'),JSON.stringify(requests));const text=await engine.run(baseId+'-'+label,['--path',project,'--script','res://driver.gd']);return JSON.parse(text.split('MANAGED_RESULTS=')[1].split('\n')[0]);}
 let results=await run('fresh',[req('save'),req('resume'),req('load',{snapshot:null}),req('save')]);
 check(baseId+' explicit initial load required',()=>{assert(results[0].error);assert(results[1].error);assert(results[2].result.loaded);});
 const enriched=clone(results[3].result.state),body=enriched.body;
 if(baseId==='first-person'){
  body.savedAt='2001-02-03T04:05:06Z';body.player.position=[1.25,3.25,4.5];body.player.onFloor=false;body.player.yaw=0.5;body.equipment.items[0].magazine=3;body.inventory.slots[0].count=2;
  Object.assign(body.targets[0],{health:25,damageTaken:25,hitCount:1});body.interactables[0].usesLeft=1;body.quests.quests[0].count=1;
 }else if(baseId==='top-down'){
  body.coins=29;body.inventory={apple:2,herb:1};body.shops.general.stock.apple=3;body.quests['herb-delivery']={delivered:3,status:'completed',rewarded:true};body.grantedRewards={'herb-delivery':true};body.flags={'custom_flag':'kept'};
  body.player={sceneId:'shop-interior',position:[136,104],facing:'left'};body.scenePositions['shop-interior']=[136,104];
 }else{
  body.player={room:'ruins',x:143.5,y:440,facing:-1};body.abilities={double_jump:true};body.checkpoints={cp_ruins:true};body.activeCheckpoint='cp_ruins';body.rewards={reward_ruins_cache:true};body.inventory={coin:5};body.counters={coins:5};body.rooms.ruins={visited:true,entries:4};
 }
 const sequence=[req('load',{snapshot:enriched})];if(baseId==='side-view')sequence.push({fixture:'damage'});sequence.push(req('pause'),req('save'));
 results=await run('enriched',sequence);if(results[0].error)throw Error(baseId+' restore: '+results[0].error);
 const saved=results.at(-1).result;
 check(baseId+' full state receipt',()=>{assert.equal(saved.status,'confirmed');assert.deepEqual(JSON.parse(saved.runnerReceipt.snapshotText),saved.state);assert.equal(saved.runnerReceipt.snapshotSha256,createHash('sha256').update(saved.runnerReceipt.snapshotText).digest('hex'));assert.equal(saved.runnerReceipt.bytes,Buffer.byteLength(saved.runnerReceipt.snapshotText));});
 const expected=clone(saved.state);
 if(baseId==='first-person')check('first-person preserves original timestamp across snapshot and save',()=>assert.equal(expected.body.savedAt,'2001-02-03T04:05:06Z'));
 if(baseId==='side-view')check('side-view real node damage captured',()=>{assert.equal(expected.body.vitals.health,2);assert.equal(expected.body.entities.dummy_ruins.health,1);assert.equal(expected.body.rooms.ruins.entries,4);});
 const replay=await run('live-restore',[req('load',{snapshot:expected}),req('restore-state',{state:enriched}),req('restore-state',{state:expected}),req('save')]);
 check(baseId+' paused live restore preserves the complete checkpoint',()=>{assert(!replay[1].error,replay[1].error);assert(!replay[2].error,replay[2].error);assert.deepEqual(comparable(replay[3].result.state),comparable(expected));});
 const acks=await run('acknowledgement',[req('load',{snapshot:expected}),req('save'),{fixture:'ack',override:{instanceId:'foreign'}},{fixture:'ack',override:{snapshotSha256:'0'.repeat(64)}},{fixture:'ack'},req('restore-state',{state:expected}),{fixture:'ack'}]);
 check(baseId+' durable acknowledgement binds latest runner hash and instance',()=>{assert(acks[2].error);assert(acks[3].error);assert(acks[4].result.acknowledged);assert(acks[6].error);});
 const badStates=[];
 for(const change of [s=>s.worldId='foreign',s=>s.body.worldId='foreign',s=>s.baseId='foreign',s=>s.baseVersion='future',s=>s.stateVersion=99,s=>s.body.modelExtension={must:'not disappear'},s=>s.body.player='invalid',s=>s.extra='future',s=>s.body.player.modelField='future',s=>s.body.padding='x'.repeat(1048576)]){const bad=clone(expected);change(bad);badStates.push(bad);}
 if(baseId==='side-view')for(const change of [s=>s.body.vitals.health=99,s=>s.body.entities.dummy_ruins.extra=1,s=>s.body.entities.dummy_ruins.health=0,s=>s.body.player.room='missing']){const bad=clone(expected);change(bad);badStates.push(bad);}
 if(baseId==='top-down'){const bad=clone(expected);bad.body.player.sceneId='missing';badStates.push(bad);}
 const requests=[req('load',{snapshot:expected}),req('save')];for(const bad of badStates)requests.push(req('restore-state',{state:bad}),req('save'));
 requests.push({...req('snapshot'),instanceId:'foreign-instance'});
 results=await run('restart-and-reject',requests);
 check(baseId+' full process restart preserves native body',()=>{assert(!results[0].error,results[0].error);assert.deepEqual(comparable(results[1].result.state),comparable(expected));});
 check(baseId+' invalid and future state rejects atomically',()=>{for(let i=0;i<badStates.length;i++){assert(results[2+i*2].error,'bad state '+i+' accepted');assert.deepEqual(comparable(results[3+i*2].result.state),comparable(expected));}assert(results.at(-1).error);});
 fs.writeFileSync(path.join(out,baseId+'-saved-state.json'),JSON.stringify(expected,null,2));
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({format:'craftmine.managed-progress-tests/1',engine:engine.actualVersion,checks,passed:checks.length,evidence:out,runs:engine.runs},null,2));
console.log(JSON.stringify({passed:checks.length,evidence:out}));
