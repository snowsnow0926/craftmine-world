import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{deriveAdditiveProgress}from'../../desktop/godot/shared/progress-migration.mjs';
const previous=JSON.parse(fs.readFileSync(new URL('../../docs/dispatch-reports/godot-final/install-assets/windows-service/native-final.json',import.meta.url))).worlds[0].formal.snapshot;
test('new equipment takes verified defaults while active selection and every old item remain unchanged',()=>{
 const old=structuredClone(previous),defaults=structuredClone(previous);
 old.body.equipment.items[0].magazine=2;old.body.equipment.items[0].reserve=19;
 defaults.body.equipment.items.push({id:'thunder_hammer',magazine:0,reserve:0});defaults.body.equipment.active='thunder_hammer';
 const proof=deriveAdditiveProgress(old,defaults);
 assert.equal(proof.snapshot.body.equipment.active,old.body.equipment.active);
 assert.deepEqual(proof.snapshot.body.equipment.items.slice(0,-1),old.body.equipment.items);
 assert.deepEqual(proof.snapshot.body.equipment.items.at(-1),{id:'thunder_hammer',magazine:0,reserve:0});
 assert.deepEqual(proof.added,[{path:'/body/equipment/items',id:'thunder_hammer'}]);
 const unchanged=structuredClone(proof.snapshot);unchanged.body.equipment=old.body.equipment;assert.deepEqual(unchanged,old);
});
test('a new equipment keeps its captured scene ammunition and no old entry is rewritten',()=>{
 const old=structuredClone(previous),defaults=structuredClone(previous);
 old.body.equipment.active='practice_sword';old.body.equipment.items[0].magazine=1;old.body.equipment.items[0].reserve=4;
 defaults.body.equipment.items.push({id:'thunder_hammer',magazine:2,reserve:7});defaults.body.equipment.items[0].magazine=9;defaults.body.equipment.items[0].reserve=9;
 const frozenOld=structuredClone(old),frozenDefaults=structuredClone(defaults);
 const proof=deriveAdditiveProgress(old,defaults);
 assert.equal(proof.snapshot.body.equipment.active,'practice_sword');
 assert.deepEqual(proof.snapshot.body.equipment.items.slice(0,-1),old.body.equipment.items);
 assert.deepEqual(proof.snapshot.body.equipment.items.at(-1),{id:'thunder_hammer',magazine:2,reserve:7});
 assert.deepEqual(proof.added,[{path:'/body/equipment/items',id:'thunder_hammer'}]);
 const remainder=structuredClone(proof.snapshot);remainder.body.equipment.items=old.body.equipment.items;assert.deepEqual(remainder,old);
 assert.deepEqual(old,frozenOld);assert.deepEqual(defaults,frozenDefaults);
});
test('an identical candidate snapshot is a no-op proof and never rewrites saved progress',()=>{
 const proof=deriveAdditiveProgress(previous,structuredClone(previous));
 assert.deepEqual(proof.snapshot,previous);assert.deepEqual(proof.added,[]);
});
test('equipment removal, duplicate identity and malformed default ammunition are rejected',()=>{
 for(const change of [d=>d.body.equipment.items.pop(),d=>d.body.equipment.items.push(d.body.equipment.items[0]),d=>d.body.equipment.items.push({id:'hammer',magazine:-1,reserve:0}),d=>d.body.equipment.items.push({id:'hammer',magazine:0,reserve:0,extra:true})]){
  const defaults=structuredClone(previous);change(defaults);assert.throws(()=>deriveAdditiveProgress(previous,defaults),/MIGRATION_/);
 }
});
test('equipment shape, ammunition range, selection and unknown fields are rejected on both sides',()=>{
 const malformed=[d=>{d.body.equipment.items.push(structuredClone(d.body.equipment.items[0]));},d=>{d.body.equipment.items[0].extra=1;},d=>{d.body.equipment.items[0].magazine=-1;},d=>{d.body.equipment.items[0].reserve=100000;},d=>{d.body.equipment.items[0].magazine=1.5;},d=>{d.body.equipment.items[0].reserve='4';},d=>{d.body.equipment.active='missing_item';},d=>{d.body.equipment.extra={};},d=>{d.body.equipment=[];}];
 for(const change of malformed){const defaults=structuredClone(previous);change(defaults);assert.throws(()=>deriveAdditiveProgress(previous,defaults),/MIGRATION_/);}
 for(const change of malformed){const old=structuredClone(previous);change(old);assert.throws(()=>deriveAdditiveProgress(old,structuredClone(previous)),/MIGRATION_/);}
 const removed=structuredClone(previous);removed.body.equipment.items.pop();
 assert.throws(()=>deriveAdditiveProgress(previous,removed),/MIGRATION_ENTITY_REMOVED/);
 const forgedOld=structuredClone(previous);forgedOld.body.equipment.items.push({id:'thunder_hammer',magazine:9,reserve:9});
 assert.throws(()=>deriveAdditiveProgress(forgedOld,structuredClone(previous)),/MIGRATION_ENTITY_REMOVED/);
});
test('a save that predates several catalog items gains every one of them from the candidate scene',()=>{
 const old=structuredClone(previous),defaults=structuredClone(previous);
 old.body.equipment.items=old.body.equipment.items.slice(0,1);
 const proof=deriveAdditiveProgress(old,defaults);
 assert.equal(proof.snapshot.body.equipment.active,'pistol');
 assert.deepEqual(proof.snapshot.body.equipment.items,defaults.body.equipment.items);
 assert.deepEqual(proof.added,[{path:'/body/equipment/items',id:'practice_sword'},{path:'/body/equipment/items',id:'inspection_tool'}]);
});
test('additive source defaults preserve old damage, equipment, inventory and all fields',()=>{const old=structuredClone(previous);old.body.targets[0].health=17;old.body.targets[0].damageTaken=33;old.body.targets[0].hitCount=2;old.body.equipment.active='practice_sword';const defaults=structuredClone(previous),extra={...defaults.body.targets[0],id:'new-target',health:75};defaults.body.targets.unshift(extra);const result=deriveAdditiveProgress(old,defaults);assert.deepEqual(result.added,[{path:'/body/targets',id:'new-target'}]);assert.deepEqual(result.snapshot.body.targets[0],extra);assert.deepEqual(result.snapshot.body.targets.slice(1),old.body.targets);const remainder=structuredClone(result.snapshot);remainder.body.targets=old.body.targets;assert.deepEqual(remainder,old);assert.equal(old.body.targets.length,3);assert.equal(defaults.body.targets.length,4);});
test('old identity deletion, duplication and incompatible native shapes are rejected',()=>{for(const mutate of [x=>x.body.targets.pop(),x=>x.body.targets.push(x.body.targets[0]),x=>x.body.targets[0].unexpected=true,x=>x.body.targets[0].health='50',x=>x.body.unrecognized={},x=>x.worldId='other',x=>x.baseVersion='2.0.0']){const defaults=structuredClone(previous);mutate(defaults);assert.throws(()=>deriveAdditiveProgress(previous,defaults),/MIGRATION_/);}});
test('a new equipment and a new target are installed together in scene order',()=>{
 const old=structuredClone(previous),defaults=structuredClone(previous),extra={...defaults.body.targets[0],id:'new-target',health:75};
 old.body.targets[0].health=21;old.body.equipment.items[0].reserve=3;
 defaults.body.targets.unshift(extra);defaults.body.equipment.items.push({id:'thunder_hammer',magazine:2,reserve:7});
 const proof=deriveAdditiveProgress(old,defaults);
 assert.deepEqual(proof.added,[{path:'/body/targets',id:'new-target'},{path:'/body/equipment/items',id:'thunder_hammer'}]);
 assert.deepEqual(proof.snapshot.body.targets[0],extra);assert.deepEqual(proof.snapshot.body.targets.slice(1),old.body.targets);
 assert.deepEqual(proof.snapshot.body.equipment.items.slice(0,-1),old.body.equipment.items);
 assert.deepEqual(proof.snapshot.body.equipment.items.at(-1),{id:'thunder_hammer',magazine:2,reserve:7});
 assert.equal(proof.snapshot.body.targets.find(x=>x.id==='target_a').health,21);
 assert.deepEqual(proof.snapshot.body.equipment.items.find(x=>x.id==='pistol'),{id:'pistol',magazine:6,reserve:3});
});
test('full previous entry and unknown non-entity changes cannot be smuggled through defaults',()=>{const defaults=structuredClone(previous);defaults.body.inventory.slots=[];defaults.body.player.position=[99,99,99];defaults.body.savedAt='different';defaults.body.targets.reverse();const result=deriveAdditiveProgress(previous,defaults);assert.deepEqual(result.snapshot.body.inventory,previous.body.inventory);assert.deepEqual(result.snapshot.body.player,previous.body.player);assert.equal(result.snapshot.body.savedAt,previous.body.savedAt);assert.deepEqual(result.snapshot.body.targets,previous.body.targets.toReversed());assert.deepEqual(result.added,[]);});
