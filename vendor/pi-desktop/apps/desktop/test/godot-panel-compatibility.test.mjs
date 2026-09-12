import test from 'node:test';
import assert from 'node:assert/strict';
import {createGodotPanelCoordinator} from '../electron/main/godot-panel-coordinator.ts';

function fixture(settings={}) {
 const events=[],records={healthy:{build:'healthy-build',snapshot:{position:[2,1,8],door:true}},legacy:{build:'legacy-build',snapshot:{position:[0,.898971319198608,-.68],door:false}}};
 const original=structuredClone(records);let selected='healthy',held=0;
 const host={instance:{worldId:'healthy',buildId:'healthy-build'},state:{worldId:'healthy',state:'ready'},
  async holdSelectionSync(){held++;return()=>held--;},
  async switchWorld(next){
   events.push(['switch',next?.worldId??null]);
   if(!next&&this.instance){assert.equal(selected,this.instance.worldId);if(settings.saveFails)throw Error('CURRENT_SAVE_FAILED');if(this.instance.worldId==='healthy')records.healthy.snapshot.position[0]=3;events.push(['checkpoint',structuredClone(records[this.instance.worldId].snapshot)]);}
   if(settings.selectionAfterDetach&&!next)selected='third-world';
   this.instance=next;this.state=next?{worldId:next.worldId,buildId:next.buildId,state:'ready'}:{state:'closed'};
  },
  async resume(){events.push(['resume',this.instance?.worldId]);},async pause(){events.push(['pause']);},setSurfaceVisible(value){events.push(['surface',value]);}};
 const panel=createGodotPanelCoordinator({host,selection:async()=>selected,
  adapter:{describe:async id=>{events.push(['describe',id]);return {worldId:id,buildId:records[id]?.build};}},
  invoke:async(channel,payload)=>{assert.equal(channel,'world.open');assert.equal(held,1);events.push(['select',payload.id]);selected=payload.id;if(settings.lostTargetAck&&selected==='legacy')throw Error('TARGET_SELECTION_REPLY_LOST');return {id:selected};},
  compatibility:{required:async id=>{events.push(['required',id]);return id==='legacy'&&settings.required!==false;},
   apply:async id=>{events.push(['apply',id]);assert.equal(host.instance,null);assert.equal(selected,id);assert.deepEqual(records.legacy.snapshot,original.legacy.snapshot);
    if(settings.foreignSelection){selected='third-world';throw Error('SELECTION_CHANGED');}
    if(settings.applyFails)throw Error(settings.applyFails);
    records.legacy.build='repaired-build';host.instance={worldId:id,buildId:'repaired-build'};return {status:settings.unconfirmed?'pending':'applied'};
   }}});
 return {panel,host,events,records,original,setSelection:id=>selected=id,get selected(){return selected;},get held(){return held;}};
}
test('cross-world legacy compatibility checkpoints healthy progress before selecting and checking unchanged saved target',async()=>{
 const f=fixture();assert.deepEqual(await f.panel.invoke('world.open',{id:'legacy'}),{id:'legacy'});
 assert.equal(f.selected,'legacy');assert.equal(f.host.instance.buildId,'repaired-build');assert.equal(f.records.healthy.snapshot.position[0],3);assert.deepEqual(f.records.legacy.snapshot,f.original.legacy.snapshot);assert.equal(f.held,0);
 assert.ok(f.events.findIndex(([op])=>op==='checkpoint')<f.events.findIndex(([op])=>op==='select'));
 assert.ok(f.events.findIndex(([op])=>op==='apply')<f.events.findLastIndex(([op])=>op==='describe'));
});
for(const error of ['CHECK_FAILED','CANCELLED','SAVED_PROGRESS_CHANGED'])test(`failed compatibility ${error} restores the healthy selection with its fresh checkpoint`,async()=>{
 const f=fixture({applyFails:error});await assert.rejects(f.panel.invoke('world.open',{id:'legacy'}),new RegExp(error));
 assert.equal(f.selected,'healthy');assert.equal(f.host.instance.worldId,'healthy');assert.equal(f.records.healthy.snapshot.position[0],3);assert.deepEqual(f.records.legacy,f.original.legacy);assert.equal(f.held,0);
});
test('current save failure never selects or changes the legacy target',async()=>{
 const f=fixture({saveFails:true});await assert.rejects(f.panel.invoke('world.open',{id:'legacy'}),/CURRENT_SAVE_FAILED/);assert.equal(f.selected,'healthy');assert.deepEqual(f.records,f.original);assert.ok(!f.events.some(([op])=>op==='select'||op==='apply'));
});
test('lost target selection ACK recovers only the selection this transaction selected',async()=>{
 const f=fixture({lostTargetAck:true});await assert.rejects(f.panel.invoke('world.open',{id:'legacy'}),/TARGET_SELECTION_REPLY_LOST/);assert.equal(f.selected,'healthy');assert.equal(f.host.instance.worldId,'healthy');assert.deepEqual(f.records.legacy,f.original.legacy);assert.ok(!f.events.some(([op])=>op==='apply'));
});
for(const mode of ['foreignSelection','selectionAfterDetach'])test(`a competing selection (${mode}) is never overwritten during compatibility rollback`,async()=>{
 const f=fixture({[mode]:true});await assert.rejects(f.panel.invoke('world.open',{id:'legacy'}),/SELECTION_CHANGED/);assert.equal(f.selected,'third-world');assert.ok(!f.events.some(([op,id])=>op==='select'&&id==='healthy'));assert.deepEqual(f.records.legacy,f.original.legacy);assert.equal(f.held,0);
});
test('unrecognized current sources retain the existing normal open path without migration',async()=>{
 const f=fixture({required:false});await f.panel.invoke('world.open',{id:'legacy'});assert.ok(!f.events.some(([op])=>op==='apply'));assert.ok(!f.events.some(([op,id])=>op==='switch'&&id===null));
});
test('an unconfirmed response after a promoted runtime closes it under its own selection before returning to the saved original world',async()=>{
 const f=fixture({unconfirmed:true});await assert.rejects(f.panel.invoke('world.open',{id:'legacy'}),/APPLY_UNCONFIRMED/);assert.equal(f.selected,'healthy');assert.equal(f.host.instance.worldId,'healthy');assert.deepEqual(f.records.legacy.snapshot,f.original.legacy.snapshot);assert.equal(f.held,0);
});
test('failed runtime status is readable only for the exact selected world without a live instance',async()=>{
 const f=fixture();f.host.instance=null;f.host.state={worldId:'healthy',buildId:'healthy-build',state:'failed',error:'OLD_LOAD_FAILED'};
 assert.deepEqual(await f.panel.invoke('godot.runtimeState',{worldId:'healthy'}),f.host.state);
 await assert.rejects(f.panel.invoke('godot.runtimeState',{worldId:'legacy'}),/WORLD_CHANGED/);
 await assert.rejects(f.panel.invoke('godot.runtimeState',{worldId:'healthy',snapshot:{}}),/INVALID/);
});
