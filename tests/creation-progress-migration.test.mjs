import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAdditiveProgress} from '../desktop/godot/shared/progress-migration.mjs';
const state=()=>({format:'craftmine.godot-progress/1',worldId:'alpha',baseId:'creation-sandbox',baseVersion:'1.0.0',stateVersion:1,body:{format:'craftmine.creation-progress/1',worldId:'alpha',baseVersion:'1.0.0',player:{position:[2,.9,6],yaw:1,pitch:.1,onFloor:true},timeOfDay:18,sourceTimeOfDay:12,inventory:{token:3},openedChests:{chest:true},doors:{old:true},rules:{old:{cursor:3,completed:true}}}});
test('creation migration preserves latest progress and historical reward ledgers and adds only fresh doors/rules',()=>{
 const previous=state(),defaults=state();defaults.body.player.position=[0,.9,0];defaults.body.inventory={};defaults.body.openedChests={};defaults.body.doors={fresh:false};defaults.body.rules={new:{cursor:0,completed:false,timer:0}};
 const proof=deriveAdditiveProgress(previous,defaults);assert.deepEqual(proof.snapshot.body.player,previous.body.player);assert.deepEqual(proof.snapshot.body.openedChests,{chest:true});assert.deepEqual(proof.snapshot.body.inventory,{token:3});assert.deepEqual(proof.snapshot.body.doors,{old:true,fresh:false});assert.deepEqual(proof.snapshot.body.rules.old,previous.body.rules.old);assert.deepEqual(proof.added,[{path:'/body/doors',id:'fresh'},{path:'/body/rules',id:'new'}]);assert.equal(proof.snapshot.body.timeOfDay,18);
});
test('explicit authored time edit takes effect while an unchanged default preserves play time',()=>{
 const previous=state(),defaults=state();defaults.body.sourceTimeOfDay=21;defaults.body.timeOfDay=21;
 const result=deriveAdditiveProgress(previous,defaults).snapshot;assert.equal(result.body.timeOfDay,21);assert.equal(result.body.sourceTimeOfDay,21);assert.equal(previous.body.timeOfDay,18);
});
test('foreign identity and malformed progress fail before migration',()=>{
 for(const mutate of [s=>s.worldId='foreign',s=>s.body.inventory.token=-1,s=>s.body.openedChests.chest=false,s=>s.body.player.pitch=Math.PI/2,s=>s.body.player.position[1]=-1,s=>s.body.rules.old=null,s=>s.body.extra=1]){const bad=state();mutate(bad);assert.throws(()=>deriveAdditiveProgress(state(),bad));}
});
