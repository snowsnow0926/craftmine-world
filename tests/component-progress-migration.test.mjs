import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAdditiveProgress} from '../desktop/godot/shared/progress-migration.mjs';
const state=()=>({format:'craftmine.godot-progress/1',worldId:'alpha',baseId:'creation-sandbox',baseVersion:'1.0.0',stateVersion:1,body:{format:'craftmine.creation-progress/1',worldId:'alpha',baseVersion:'1.0.0',player:{position:[2,.9,6],yaw:1,pitch:.1,onFloor:true},timeOfDay:18,sourceTimeOfDay:12,inventory:{token:3},openedChests:{chest:true},doors:{},rules:{}}});
const pet=(id='dog-1')=>({format:'craftmine.pet-companion-state/1',entityId:id,settings:{name:'小白',appearanceKey:'dog',following:true},sourceSettings:{name:'小白',appearanceKey:'dog',following:true},position:[2,0,1],yaw:1,interactionCount:7});
test('component text limits count Unicode characters consistently with Godot and Rust',()=>{
 const fresh=state();fresh.body.components={'dog-1':{...pet(),format:'fixture/1',notes:'🐶'.repeat(3000)}};
 assert.equal(deriveAdditiveProgress(state(),fresh).snapshot.body.components['dog-1'].notes,fresh.body.components['dog-1'].notes);
 fresh.body.components['dog-1'].notes='🐶'.repeat(4097);assert.throws(()=>deriveAdditiveProgress(state(),fresh));
});
test('old worlds remain byte-shape compatible; new component gets candidate defaults once',()=>{
 const old=state(),fresh=state();assert.deepEqual(deriveAdditiveProgress(old,fresh).snapshot,old);
 fresh.body.components={'dog-1':pet()};const p=deriveAdditiveProgress(old,fresh);
 assert.deepEqual(p.snapshot.body.components,fresh.body.components);assert.deepEqual(p.snapshot.body.player,old.body.player);assert.deepEqual(p.added,[{path:'/body/components',id:'dog-1'}]);assert.equal(Object.hasOwn(old.body,'components'),false);
});
test('appearance/source edits preserve same identity, latest motion and independent second pet',()=>{
 const old=state(),fresh=state();old.body.components={'dog-1':pet(),'dog-2':pet('dog-2')};fresh.body.components=structuredClone(old.body.components);
 old.body.components['dog-1'].settings.following=false;fresh.body.components['dog-1'].sourceSettings.appearanceKey='pomeranian-white';fresh.body.components['dog-1'].settings.appearanceKey='pomeranian-white';fresh.body.components['dog-1'].position=[9,0,9];fresh.body.components['dog-1'].interactionCount=0;
 const actual=deriveAdditiveProgress(old,fresh).snapshot.body.components;
 assert.deepEqual(actual['dog-1'],{...old.body.components['dog-1'],settings:{...old.body.components['dog-1'].settings,appearanceKey:'pomeranian-white'},sourceSettings:fresh.body.components['dog-1'].sourceSettings});assert.deepEqual(actual['dog-2'],old.body.components['dog-2']);
});
test('removal retains historical state; same identity reinstall cannot reset counters',()=>{
 const old=state(),fresh=state();old.body.components={'dog-1':pet()};const removed=deriveAdditiveProgress(old,fresh).snapshot;assert.deepEqual(removed.body.components,old.body.components);
 fresh.body.components={'dog-1':pet()};fresh.body.components['dog-1'].interactionCount=0;assert.equal(deriveAdditiveProgress(removed,fresh).snapshot.body.components['dog-1'].interactionCount,7);
 fresh.body.components={constructor:pet('constructor')};assert.equal(deriveAdditiveProgress(state(),fresh).snapshot.body.components.constructor.entityId,'constructor');
});
test('malformed ledgers and incompatible formats or setting schemas reject without mutating input',()=>{
 const old=state();old.body.components={'dog-1':pet()};const proof=structuredClone(old);
 for(const mutate of [s=>s.body.components=null,s=>s.body.components=[],s=>s.body.components['dog-1'].entityId='foreign',s=>s.body.components['dog-1'].position[0]=Infinity,s=>s.body.components['dog-1'].sourceSettings.extra=true,s=>s.body.components['dog-1'].settings.following='yes',s=>s.body.components['dog-1'].settings.name={},s=>s.body.components['dog-1'].format='other/2']){
  const fresh=structuredClone(old);mutate(fresh);assert.throws(()=>deriveAdditiveProgress(old,fresh));assert.deepEqual(old,proof);
 }
 const many=state();many.body.components=Object.fromEntries(Array.from({length:65},(_,i)=>['dog-'+i,pet('dog-'+i)]));assert.throws(()=>deriveAdditiveProgress(old,many));
});
