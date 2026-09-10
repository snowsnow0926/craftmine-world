import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {compileCreationOperation,MAX_OPERATIONS}=require('../plugins/craftmine-world/creation-operations.cjs');
const {CREATION_OPERATION_SCHEMA}=require('../plugins/craftmine-world/creation-operation-schema.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
const file=value=>{const text=JSON.stringify(value);return {text,sha256:hash(text)};};
const entity=(id,kind='rock',position=[4,0,4])=>({id,kind,position,rotationY:0,scale:[1,1,1],color:'#884422',parameters:{}});
function fixture(entities=[]) {
  const document={format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities};
  const source={worldId:'world-a',buildId:'build-a',instanceId:'instance-a',revision:7,manifestHash:'a'.repeat(64),files:{'world/creation.json':file(document)}};
  const targetSnapshot={snapshotId:'capture-a',worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,sourceRevision:source.revision,manifestHash:source.manifestHash,playerPosition:[0,0,0],target:{entityId:entities[0]?.id??null,position:[5,0,5],normal:[0,1,0],surface:entities.length?'entity':'ground',revision:1}};
  const expected={worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,revision:source.revision,manifestHash:source.manifestHash,targetSnapshotId:targetSnapshot.snapshotId};
  return {source,targetSnapshot,request:{operationId:'operation-a',expected,action:'place',kind:'tree'}};
}
const run=(f,patch)=>compileCreationOperation({...f,request:{...f.request,...patch}});
test('all five creation kinds produce bounded durable source patches without altering input',()=>{
  for(const kind of ['tree','rock','chest','door','marker']){
    const f=fixture(),before=structuredClone(f),result=run(f,{kind});
    assert.deepEqual(f,before);assert.equal(result.document.entities[0].kind,kind);assert.equal(result.operations.length,2);
    assert.equal(result.operations[0].expectedHash,f.source.files['world/creation.json'].sha256);
    assert.equal(result.operations[1].expectedHash,null);assert.equal(result.document.revision,2);assert.equal(result.replayed,false);
  }
});
test('first operation materializes the blank creation scene when a new base has no scene file',()=>{
  const f=fixture();delete f.source.files['world/creation.json'];
  const result=run(f,{kind:'tree',position:[3,0,3]});
  assert.equal(result.document.format,'craftmine.creation-scene/1');
  assert.equal(result.operations[0].path,'world/creation.json');
  assert.equal(result.operations[0].expectedHash,null);
  assert.equal(JSON.parse(result.operations[0].text).entities.length,1);
});
test('modification preserves stable chest identity and immutable one-time reward declaration',()=>{
  const chest=entity('chest-a','chest');chest.parameters={rewardId:'token',rewardCount:2};
  const f=fixture([chest]);const request={operationId:'modify-a',expected:f.request.expected,action:'modify',targetId:'chest-a',changes:{color:'#112233',scale:[1.2,1,1]}};
  const result=compileCreationOperation({...f,request});assert.equal(result.document.entities[0].id,'chest-a');assert.deepEqual(result.document.entities[0].parameters,chest.parameters);
  assert.throws(()=>compileCreationOperation({...f,request:{...request,changes:{parameters:{rewardId:'other'}}}}),/CHEST_REWARD_IMMUTABLE/);
  assert.throws(()=>compileCreationOperation({...f,request:{...request,changes:{id:'fresh-reward'}}}),/INVALID_FIELDS/);
});
test('duplicates mint deterministic separate stable identities and reject count/occupancy limits',()=>{
  const f=fixture([entity('source','rock',[2,0,2])]);const request={operationId:'copy',expected:f.request.expected,action:'duplicate',targetId:'source',count:3,offset:[3,0,0]};
  const result=compileCreationOperation({...f,request});assert.equal(result.document.entities.length,4);assert.equal(new Set(result.document.entities.map(e=>e.id)).size,4);
  assert.deepEqual(compileCreationOperation({...f,request}),result);
  assert.throws(()=>compileCreationOperation({...f,request:{...request,count:9}}),/DUPLICATE_LIMIT/);
  assert.throws(()=>compileCreationOperation({...f,request:{...request,offset:[.5,0,0]}}),/OCCUPIED/);
});
test('explicit positions are bounded; here needs authoritative hit; player and obstacle overlap reject',()=>{
  const f=fixture();for(const position of [[0,0,0],[28,0,0],[4,17,4],[NaN,0,0]])assert.throws(()=>run(f,{position}));
  f.targetSnapshot.target.surface='none';f.targetSnapshot.target.position=null;assert.throws(()=>run(f,{}),/NO_POSITION/);
  assert.equal(run(f,{position:[4,0,4]}).document.entities.length,1);
  f.targetSnapshot.obstacles=[{id:'blocker',position:[4,1,4],halfExtents:[1,1,1]}];assert.throws(()=>run(f,{position:[4,0,4]}),/OCCUPIED/);
});
test('world/build/instance/source/manifest/snapshot mismatches and removed targets fail closed',()=>{
  for(const key of ['worldId','buildId','instanceId','revision','manifestHash','targetSnapshotId']){
    const f=fixture();f.request.expected[key]=key==='revision'?9:'different';assert.throws(()=>run(f,{}));
  }
  const f=fixture();f.targetSnapshot.target.entityId='removed';
  assert.throws(()=>compileCreationOperation({...f,request:{operationId:'modify',expected:f.request.expected,action:'modify',targetId:'removed',changes:{color:'#123456'}}}),/TARGET_REMOVED/);
  f.source.files['world/creation.json'].sha256='0'.repeat(64);assert.throws(()=>run(f,{}),/HASH_MISMATCH/);
});
test('same operation replay returns original receipt after source moves; changed payload conflicts',()=>{
  const f=fixture(),first=run(f,{});
  for(const op of first.operations)f.source.files[op.path]={text:op.text,sha256:hash(op.text)};
  f.source.revision++;f.source.manifestHash='b'.repeat(64);
  const replay=run(f,{});assert.equal(replay.replayed,true);assert.deepEqual(replay.operations,[]);assert.deepEqual(replay.receipt,first.receipt);
  assert.throws(()=>run(f,{kind:'rock'}),/REPLAY_CONFLICT/);
});
test('environment edits only declared defaults and no caller-defined source or parameter escapes',()=>{
  const f=fixture();const request={operationId:'night',expected:f.request.expected,action:'environment',timeOfDay:21};
  const result=compileCreationOperation({...f,request});assert.equal(result.document.defaults.timeOfDay,21);assert.deepEqual(result.document.entities,[]);
  assert.throws(()=>compileCreationOperation({...f,request:{...request,script:'evil'}}),/INVALID_FIELDS/);
  assert.throws(()=>run(f,{parameters:{script:'res://evil.gd'}}),/INVALID_FIELDS/);
});
test('new sequence door emits actual deterministic source and hashed runtime declaration',()=>{
  const f=fixture([entity('door-a','door'),entity('red','marker',[8,0,0]),entity('blue','marker',[10,0,0]),entity('green','marker',[12,0,0])]);
  const request={operationId:'custom-rule',expected:f.request.expected,action:'sequence-door',ruleId:'sequence-one',doorId:'door-a',sequence:['blue','red','green']};
  const result=compileCreationOperation({...f,request}),rule=result.document.rules[0],script=result.operations.find(op=>op.path.endsWith('.gd'));
  assert.equal(hash(script.text),rule.sha256);assert.match(script.text,/const SEQUENCE: Array\[String\] = \["blue","red","green"\]/);assert.match(script.text,/_host\.set_door_open\(DOOR_ID, true\)/);
  assert.throws(()=>compileCreationOperation({...f,request:{...request,sequence:['red','red']}}),/RULE_INVALID/);
  assert.throws(()=>compileCreationOperation({...f,request:{...request,sequence:['red','missing']}}),/RULE_TARGET_INVALID/);
});
test('operation ledger is bounded and schema advertises precisely supported action branches',()=>{
  assert.equal(MAX_OPERATIONS,4096);
  const f=fixture();f.source.files['world/creation-operations.json']=file({format:'craftmine.creation-operations/1',operations:[null]});assert.throws(()=>run(f,{}),/JOURNAL_INVALID/);
  assert.deepEqual(CREATION_OPERATION_SCHEMA.oneOf.map(branch=>branch.properties.action.const),['place','modify','duplicate','environment','sequence-door']);
  for(const branch of CREATION_OPERATION_SCHEMA.oneOf)assert.equal(branch.additionalProperties,false);
});
test('full ledger rejects new operations without pruning replay identity',()=>{
  const f=fixture();const operations=Array.from({length:MAX_OPERATIONS},(_,index)=>({operationId:`old-${index}`,requestHash:'c'.repeat(64),receipt:{operationId:`old-${index}`,requestHash:'c'.repeat(64),worldId:f.source.worldId,createdIds:[]}}));
  f.source.files['world/creation-operations.json']=file({format:'craftmine.creation-operations/1',operations});
  assert.throws(()=>run(f,{}),/JOURNAL_FULL/);assert.equal(JSON.parse(f.source.files['world/creation-operations.json'].text).operations.length,MAX_OPERATIONS);
});
test('reserved historical entity IDs cannot be reused after source removal',()=>{
  const f=fixture(),first=run(f,{id:'one-time-chest',kind:'chest'});
  for(const op of first.operations)f.source.files[op.path]={text:op.text,sha256:hash(op.text)};
  const document=first.document;document.entities=[];f.source.files['world/creation.json']=file(document);
  f.targetSnapshot.target.revision=2;
  assert.throws(()=>run(f,{operationId:'new-op',id:'one-time-chest',kind:'chest'}),/DUPLICATE_ID/);
});

test('players near the walking boundary can create at a valid interior target',()=>{
 const f=fixture();f.targetSnapshot.playerPosition=[30,.9,0];
 const result=run(f,{kind:'rock',position:[26,0,0]});assert.deepEqual(result.document.entities[0].position,[26,0,0]);
 f.targetSnapshot.playerPosition=[32.1,.9,0];assert.throws(()=>run(f,{kind:'rock',position:[26,0,0]}),/TARGET_INVALID/);
});

test('large append-only ledgers pass the former 64-entry and 120k limits and report remaining capacity',()=>{
 const f=fixture();const operations=Array.from({length:MAX_OPERATIONS-1},(_,index)=>({operationId:`old-${index}`,requestHash:'c'.repeat(64),receipt:{operationId:`old-${index}`,requestHash:'c'.repeat(64),worldId:f.source.worldId,createdIds:[]}}));
 f.source.files['world/creation-operations.json']=file({format:'craftmine.creation-operations/1',operations});
 assert.ok(Buffer.byteLength(f.source.files['world/creation-operations.json'].text)>120000);
 const result=run(f,{}),journal=result.operations.find(op=>op.path==='world/creation-operations.json');
 assert.equal(result.receipt.operationCount,4096);assert.equal(result.receipt.operationLimit,4096);assert.equal(result.receipt.operationsRemaining,0);
 assert.deepEqual(JSON.parse(journal.text).operations.slice(0,-1),operations);
 for(const op of result.operations)f.source.files[op.path]={text:op.text,sha256:hash(op.text)};
 assert.equal(run(f,{}).replayed,true);
 f.source.files['world/creation-operations.json']=file({format:'craftmine.creation-operations/1',operations:[],padding:'x'.repeat(4*1024*1024)});
 assert.throws(()=>run(f,{}),/SOURCE_FILE_HASH_MISMATCH/);
});
