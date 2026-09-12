import test from 'node:test';import assert from 'node:assert/strict';
import {createCraftmineWorldRemoval} from '../electron/main/craftmine-world-removal.ts';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {invokeCraftmineNavigation}=await import('../electron/main/craftmine-navigation-host.ts');
function fixture(options={}) {
 const calls=[];let selected=options.current?'failed':'healthy',archived=false,changed=0;
 const record={id:'failed',revision:5,world:{build:{id:'original-build'},snapshot:{valuable:'unchanged'}}};
 const service=createCraftmineWorldRemoval({domain:async(method,args)=>{calls.push([method,args]);
  if(method==='world.archiveStatus')return {worldId:'failed',archived};if(method==='world.read')return structuredClone(record);
  if(method==='world.archivedList')return archived?[{id:'failed',title:'Failed'}]:[];
  if(method==='world.restoreArchived'){archived=false;if(options.lostRestore)throw Error('REPLY_LOST');return {worldId:'failed',archived};}
  if(method==='world.archiveFailed'){assert.equal(selected,'healthy');assert.deepEqual(args,{id:'failed',revision:5,baseBuild:'original-build'});if(options.stale)throw Error('WORLD_REVISION_CONFLICT');archived=true;if(options.lostDelete)throw Error('REPLY_LOST');return {worldId:'failed',archived};}throw Error(method);},
  list:async()=>({activeWorldId:selected,worlds:[{id:'failed',state:options.ready?'ready':'failed'},...(options.last?[]:[{id:'healthy',state:'ready'}])]}),
  selection:async()=>selected,navigate:async id=>{calls.push(['navigate',id]);assert.ok(service.permitsOpen(id));assert.ok(!service.permitsOpen('failed'));if(options.navigateFails)throw Error('SAVE_FAILED');selected=id;},
  createFallback:async()=>{calls.push(['create-fallback']);return {id:'healthy'};},blocked:()=>options.blocked?'WORLD_REMOVAL_BUSY':null,
  settleMaintenance:async()=>calls.push(['settle']),changed:()=>changed++});
 return {service,calls,record,get selected(){return selected;},get archived(){return archived;},get changed(){return changed;}};
}
for(const current of [false,true])test(`failed deletion persists only after safe departure when current=${current}`,async()=>{const f=fixture({current});await f.service.invoke('world.archiveFailed',{worldId:'failed'});assert.equal(f.archived,true);assert.equal(f.selected,'healthy');assert.equal(f.calls.some(([op])=>op==='navigate'),current);assert.equal(f.service.busy,false);assert.equal(f.changed,1);assert.deepEqual(f.record.world.snapshot,{valuable:'unchanged'});});
test('last failed world creates a safe fallback before archiving and restores only the list entry',async()=>{const f=fixture({current:true,last:true});await f.service.invoke('world.archiveFailed',{worldId:'failed'});assert.ok(f.calls.findIndex(([op])=>op==='create-fallback')<f.calls.findIndex(([op])=>op==='navigate'));await f.service.invoke('world.restoreArchived',{worldId:'failed'});assert.equal(f.archived,false);assert.equal(f.selected,'healthy');});
for(const options of [{blocked:true},{ready:true},{current:true,navigateFails:true},{stale:true}])test('blocked or failed transaction keeps the world recoverable: '+JSON.stringify(options),async()=>{const f=fixture(options);await assert.rejects(f.service.invoke('world.archiveFailed',{worldId:'failed'}));assert.equal(f.archived,false);assert.equal(f.service.busy,false);assert.equal(f.service.permitsOpen('healthy'),false);});
test('lost delete and restore replies reconcile only the exact durable desired state',async()=>{const f=fixture({lostDelete:true,lostRestore:true});assert.equal((await f.service.invoke('world.archiveFailed',{worldId:'failed'})).archived,true);assert.equal((await f.service.invoke('world.restoreArchived',{worldId:'failed'})).archived,false);});
test('main router accepts only the explicit bounded lifecycle shape',async()=>{const f=fixture();const invoke=input=>invokeCraftmineNavigation(input,{invoke:(channel,payload)=>f.service.invoke(channel,payload)});await assert.rejects(invoke({pluginId:'other',channel:'world.archiveFailed',payload:{worldId:'failed'}}),/PERMISSION/);for(const payload of [{worldId:'failed',deleteFiles:true},{worldId:'../failed'},{}])await assert.rejects(invoke({pluginId:'craftmine.world',channel:'world.archiveFailed',payload}));await invoke({pluginId:'craftmine.world',channel:'world.archiveFailed',payload:{worldId:'failed'}});assert.equal(f.archived,true);assert.equal((await invoke({pluginId:'craftmine.world',channel:'world.archivedList',payload:{}})).worlds.length,1);});
