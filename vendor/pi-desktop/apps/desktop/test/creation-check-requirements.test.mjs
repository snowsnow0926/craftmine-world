import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeCreationRequirements,creationEntitiesMatch,creationRequirementsHash,assertCreationJobRequirements,freezeUndoRequirements} from '../electron/main/creation-check-requirements.ts';
import {parseGodotCheckRequirements,readGodotCreationObservation,godotCreationMatches} from '../electron/main/godot-check-requirements.ts';
const tree={id:'tree-a',kind:'tree',position:[2,0,0],scale:[1,1,1],color:'#123456'};
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
 const raw={format:'craftmine.godot-observation/1',baseId:'creation-sandbox',...scope,sampledAt:new Date().toISOString(),payload:{creation:{entities}}};
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
