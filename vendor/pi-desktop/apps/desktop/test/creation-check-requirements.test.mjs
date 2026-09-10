import {creationHarvestTraceMatches} from '../electron/main/creation-harvest-verifier.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeCreationRequirements,creationEntitiesMatch,creationRequirementsHash,assertCreationJobRequirements,freezeUndoRequirements} from '../electron/main/creation-check-requirements.ts';
import {parseGodotCheckRequirements,readGodotCreationObservation,godotCreationMatches} from '../electron/main/godot-check-requirements.ts';
const tree={id:'tree-a',kind:'tree',position:[2,0,0],scale:[1,1,1],color:'#123456',visible:true,solid:true};
const capture={target:{entityId:'tree-a',position:[3,0,0]},entities:[tree]};
test('freezes exact placement and validates actual new identity/count/location',()=>{
 const frozen=freezeCreationRequirements(capture,'在这里放一棵树');assert.equal(frozen.status,'verifiable');
 const r=frozen.requirements,added={...tree,id:'tree-b',position:[3,0,0]};
 assert.equal(creationEntitiesMatch(r,[tree,added]),true);
 for(const entities of [[tree],[tree,{...added,position:[4,0,0]}],[tree,{...added,kind:'rock'}],[tree,added,{...added,id:'tree-c'}],[{...added,id:'tree-a'}]])assert.equal(creationEntitiesMatch(r,entities),false);
});
test('exact scale targets original object; compound wishes remain unverified',()=>{
 const r=freezeCreationRequirements(capture,'把这棵树放大到2倍').requirements;
 assert.equal(creationEntitiesMatch(r,[{...tree,scale:[2,2,2]}]),true);
 assert.equal(creationEntitiesMatch(r,[tree,{...tree,id:'other',scale:[2,2,2]}]),false);
 assert.equal(creationEntitiesMatch(r,[{...tree,scale:[1.5,1.5,1.5]}]),false);
 for(const text of ['把这棵树变大','在这里放一棵树然后变成红色','在这里放一棵树，不要石头','做一个砍树重生机关'])assert.equal(freezeCreationRequirements(capture,text).status,'unverified');
});
test('direct changes and delete have frozen values; mutated requirements cannot pass job binding',()=>{
 const creationRequirements=freezeCreationRequirements(capture,{action:'modify',targetId:'tree-a',changes:{color:'#aabbcc',scale:[2,2,2]}});
 const r=creationRequirements.requirements;
 assertCreationJobRequirements({creationRequirements},{checkRequirementsHash:creationRequirementsHash(r),checkRequirements:{creation:r}});
 assert.throws(()=>assertCreationJobRequirements({creationRequirements},{checkRequirementsHash:'0'.repeat(64),checkRequirements:{creation:r}}),/NOT_BOUND/);
 assert.throws(()=>assertCreationJobRequirements({creationRequirements:{status:'unverified',reason:'x'}},{}),/NEED_REVIEW/);
 assert.equal(creationEntitiesMatch(freezeCreationRequirements(capture,{action:'delete',targetId:'tree-a'}).requirements,[]),true);
});
test('creation core descriptor parses only exact canonical hash and scoped engine observation',()=>{
 const r=freezeCreationRequirements(capture,'在这里放一棵树').requirements;
 const outer={format:'craftmine.godot-check-requirements/1',creation:r};
 assert.deepEqual(parseGodotCheckRequirements(outer,creationRequirementsHash(r),'creation-sandbox').checkRequirements,outer);
 assert.throws(()=>parseGodotCheckRequirements(outer,'f'.repeat(64),'creation-sandbox'));
 const scope={worldId:'world',buildId:'build',instanceId:'instance'},entities=[tree,{...tree,id:'new',position:[3,0,0]}];
 const raw={format:'craftmine.godot-observation/1',baseId:'creation-sandbox',baseVersion:'1.0.0',...scope,sampledAt:new Date().toISOString(),payload:{creation:{entities}}};
 assert.equal(godotCreationMatches(readGodotCreationObservation(raw,scope,'loaded'),outer),true);
 assert.throws(()=>readGodotCreationObservation({...raw,instanceId:'foreign'},scope,'loaded'));
});
test('original first-person requirement digest contract remains unchanged',()=>{
 const requirement={format:'craftmine.godot-check-requirements/1',targetFeedback:{targetId:'target_a',hitFlashMilliseconds:500}};
 const {createHash}=process.getBuiltinModule('node:crypto');const digest=createHash('sha256').update('craftmine.godot-check-requirements/1\ntarget_a\n500\n').digest('hex');
 assert.equal(parseGodotCheckRequirements(requirement,digest,'first-person').checkRequirementsHash,digest);
});

test('undo freezes formal inverse and refuses replay or changed actual entities',()=>{
 const inverse={format:'craftmine.creation-inverse/1',before:[{...tree,scale:[1,1,1]}],after:[{...tree,scale:[2,2,2]}]};
 const journal={format:'craftmine.creation-operations/1',operations:[{operationId:'edit-a',receipt:{undoSupported:true},inverse}]};
 const actual={entities:inverse.after};const frozen=freezeUndoRequirements(actual,journal,'edit-a');assert.equal(frozen.status,'verifiable');assert.equal(creationEntitiesMatch(frozen.requirements,inverse.before),true);assert.equal(creationEntitiesMatch(frozen.requirements,inverse.after),false);
 assert.equal(freezeUndoRequirements({entities:[{...tree,scale:[3,3,3]}]},journal,'edit-a').status,'unverified');journal.operations.push({operationId:'undo-a',receipt:{undoOperationId:'edit-a'}});assert.equal(freezeUndoRequirements(actual,journal,'edit-a').status,'unverified');
});
test('canonical requirement digest agrees with Rust numeric encoding',()=>{assert.equal(creationRequirementsHash({format:'craftmine.creation-requirements/1',requestHash:'a'.repeat(64),entities:[{id:'tree-a',position:[0.000001,2.4,0],scale:[1,2,3]}],counts:[]}), 'f85e44d5f4e124c7527d53f15378a5a0dca699e08c1e14edca73a10bef061a2e');});

test('harvest accepts only the complete exact wish and preserves explicit expectations',()=>{
 const text='让这棵树可以按E砍伐，砍掉时给背包增加一块木头，5秒后重新长出来。保存重开后保留木头和树的生长状态。';
 const frozen=freezeCreationRequirements(capture,text);assert.equal(frozen.status,'verifiable');assert.deepEqual(frozen.requirements.harvest,{entityId:'tree-a',inventoryId:'wood',reward:1,regrowFrames:300});
 for(const changed of [text+'同时变红',text.replace('5秒','6秒'),text.replace('一块木头','两块木头')])assert.equal(freezeCreationRequirements(capture,changed).status,'unverified');
 const steps=['initial','harvested','repeat','midway','restored','before-regrowth','regrown','second-harvest'];const trace=steps.map((step,i)=>({step,inventory:i?{stone:3,wood:i===7?2:1}:{stone:3},visible:i===0||i===6,solid:i===0||i===6,progressRestored:i===4,elapsedTicks:i===5?280:i===6?330:i*10}));
 assert.equal(creationHarvestTraceMatches(frozen.requirements,trace),true);
 for(const bad of [trace.slice(0,-1),trace.map((e,i)=>i===2?{...e,inventory:{wood:2,stone:3}}:e),trace.map((e,i)=>i===4?{...e,progressRestored:false}:e),trace.map((e,i)=>i===1?{...e,solid:true}:e),trace.map((e,i)=>i===5?{...e,visible:true}:e)])assert.equal(creationHarvestTraceMatches(frozen.requirements,bad),false);
});

test('frozen evaluation variants are exact bounded phrases, not keyword matching',()=>{
 for(const text of ['把这棵树变大一倍','在这里再放一块石头，保留已有物体和游玩进度','在这个副本的这里放一棵树，保留之前的内容','这棵树的颜色改成#88bb44，其他东西保持原样','把时间设为18点','复制这棵树两个，排开一点']){
  assert.equal(freezeCreationRequirements(capture,text).status,'verifiable',text);
  assert.equal(freezeCreationRequirements(capture,text+'然后删光其他东西').status,'unverified');
 }
 const required=freezeCreationRequirements(capture,'复制这棵树两个，排开一点').requirements;
 const entity=(id,x)=>({...tree,id,position:[x,0,0],visible:true,solid:true,bounds:{min:[x-0.6,0,-0.6],max:[x+0.6,4,0.6]}});
 assert.equal(creationEntitiesMatch(required,[entity('tree-a',2),entity('copy-a',4),entity('copy-b',6)]),true);
 assert.equal(creationEntitiesMatch(required,[entity('tree-a',2),entity('copy-a',4),entity('copy-b',4)]),false);
 const time=freezeCreationRequirements(capture,'把时间设为18点').requirements;
 assert.equal(godotCreationMatches({phase:'loaded',entities:[tree],timeOfDay:18},{format:'craftmine.godot-check-requirements/1',creation:time}),true);
 assert.equal(godotCreationMatches({phase:'loaded',entities:[tree],timeOfDay:12},{format:'craftmine.godot-check-requirements/1',creation:time}),false);
});

test('placement and direct modification cannot pass with hidden or nonblocking objects',()=>{
 const placed=freezeCreationRequirements(capture,'在这里放一棵树').requirements;
 const added={...tree,id:'new-tree',position:[3,0,0]};
 for(const change of [{visible:false},{solid:false}])assert.equal(creationEntitiesMatch(placed,[tree,{...added,...change}]),false);
 const modified=freezeCreationRequirements(capture,{action:'modify',targetId:'tree-a',changes:{color:'#abcdef'}}).requirements;
 assert.equal(creationEntitiesMatch(modified,[{...tree,color:'#abcdef'}]),true);
 assert.equal(creationEntitiesMatch(modified,[{...tree,color:'#abcdef',visible:false}]),false);
});
test('undo also freezes untouched objects instead of checking only their count',()=>{
 const old={...tree,scale:[1,1,1]},changed={...tree,scale:[2,2,2]},other={...tree,id:'other-tree',position:[8,0,0],visible:false,solid:false};
 const journal={format:'craftmine.creation-operations/1',operations:[{operationId:'edit-a',receipt:{undoSupported:true},inverse:{format:'craftmine.creation-inverse/1',before:[old],after:[changed]}}]};
 const frozen=freezeUndoRequirements({entities:[changed,other]},journal,'edit-a');assert.equal(frozen.status,'verifiable');assert.equal(creationEntitiesMatch(frozen.requirements,[old,other]),true);
 for(const change of [{position:[9,0,0]},{scale:[2,2,2]},{color:'#ff0000'},{visible:true},{solid:true}])assert.equal(creationEntitiesMatch(frozen.requirements,[old,{...other,...change}]),false);
});
