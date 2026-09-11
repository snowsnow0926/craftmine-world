import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {compileCreationOperation}=require('../plugins/craftmine-world/creation-operations.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
const file=value=>{const text=JSON.stringify(value);return {text,sha256:hash(text)};};
const entity=(id,kind='door')=>({id,kind,position:[5,0,5],rotationY:0,scale:[1,1,1],color:'#123456',parameters:{}});
function fixture(entities=[entity('gate')],rules){
 const doc={format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities,...(rules?{rules}:{})};
 const source={worldId:'w',buildId:'b',instanceId:'i',revision:7,manifestHash:'a'.repeat(64),files:{'world/creation.json':file(doc)}};
 const targetSnapshot={snapshotId:'snap',worldId:'w',buildId:'b',instanceId:'i',sourceRevision:7,manifestHash:source.manifestHash,playerPosition:[0,0,0],target:{entityId:entities[0]?.id??null,position:[5,0,5],surface:entities.length?'entity':'ground',revision:1}};
 const expected={...Object.fromEntries(['worldId','buildId','instanceId','revision','manifestHash'].map(k=>[k,source[k]])),targetSnapshotId:'snap'};
 return {source,targetSnapshot,request:{operationId:'modify',expected,action:'modify',targetId:'gate',changes:{color:'#112233'}}};
}
test('compiled edit reports exact field changes and known identity without claiming save or runtime verification',()=>{
 const f=fixture(),result=compileCreationOperation(f),s=result.changeSummary;
 assert.equal(s.format,'craftmine.creation-change-summary/1');
 assert.deepEqual(s.entities,[{id:'gate',kind:'door',change:'modified',fields:[{field:'color',before:'#123456',after:'#112233'}]}]);
 assert.equal(s.source.revision,7);assert.equal(s.source.manifestHash,f.source.manifestHash);
 assert.equal(s.progress.written,false);assert.equal(s.progress.adoptionCompatibility,'not-assessed');
 assert.equal(s.checks.canSkipFormalCheck,false);assert.equal(s.dependencies.runtimeBehavior,'unknown');
});
test('declared script dependents are identified but undeclared behavior remains unknown',()=>{
 const rule={id:'react',kind:'entity-behavior',entityIds:['gate'],script:'scripts/creation/rules/react.gd',sha256:'b'.repeat(64)};
 const result=compileCreationOperation(fixture(undefined,[rule]));
 assert.deepEqual(result.changeSummary.dependencies.rules,[{id:'react',kind:'entity-behavior',script:rule.script,entityIds:['gate']}]);
 assert.equal(result.changeSummary.dependencies.coverage,'creation-rule-declarations-only');
});
test('duplicate and delete summaries distinguish new identity from removed declaration, not copying or erasing saved progress',()=>{
 const f=fixture();f.request={operationId:'copy',expected:f.request.expected,action:'duplicate',targetId:'gate',count:2,offset:[3,0,0]};
 const result=compileCreationOperation(f);
 assert.deepEqual(result.changeSummary.entities.map(e=>e.id),result.receipt.createdIds);
 assert.ok(result.changeSummary.entities.every(e=>e.change==='added'));
 assert.equal(result.changeSummary.progress.instanceInitialization,'requires-formal-application');
 f.request={operationId:'remove',expected:f.request.expected,action:'delete',targetId:'gate'};
 assert.equal(compileCreationOperation(f).changeSummary.entities[0].change,'removed');
});
test('exact replay uses journal inverse, never the newer scene as the original before-state',()=>{
 const f=fixture(),first=compileCreationOperation(f);
 for(const op of first.operations)f.source.files[op.path]={text:op.text,sha256:hash(op.text)};
 const changed=JSON.parse(f.source.files['world/creation.json'].text);changed.entities[0].color='#abcdef';
 f.source.files['world/creation.json']=file(changed);f.source.revision=8;f.source.manifestHash='c'.repeat(64);
 const replay=compileCreationOperation(f);
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);
 assert.deepEqual(replay.changeSummary.entities,first.changeSummary.entities);
 assert.equal(replay.changeSummary.provenance,'journal-inverse');
 assert.equal(replay.changeSummary.dependencies.coverage,'not-recorded');
});
test('environment changes expose defaults; legacy non-invertible replay reports missing evidence',()=>{
 const f=fixture();f.request={operationId:'night',expected:f.request.expected,action:'environment',timeOfDay:21};
 const first=compileCreationOperation(f);
 assert.deepEqual(first.changeSummary.defaults,[{field:'timeOfDay',before:12,after:21}]);
 for(const op of first.operations)f.source.files[op.path]={text:op.text,sha256:hash(op.text)};
 const replay=compileCreationOperation(f);assert.equal(replay.changeSummary.status,'unknown');
 assert.equal(replay.changeSummary.reason,'ORIGINAL_CHANGE_DETAILS_NOT_RECORDED');
});
test('same-value edits show no field delta; malformed optional inverse does not invalidate durable replay',()=>{
 const f=fixture();f.request.changes={color:'#123456'};const first=compileCreationOperation(f);
 assert.deepEqual(first.changeSummary.entities,[]);
 for(const op of first.operations)f.source.files[op.path]={text:op.text,sha256:hash(op.text)};
 const journal=JSON.parse(f.source.files['world/creation-operations.json'].text);journal.operations[0].inverse={format:'craftmine.creation-inverse/1',before:[{id:'bad'}],after:[]};
 f.source.files['world/creation-operations.json']=file(journal);
 const replay=compileCreationOperation(f);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.changeSummary.status,'unknown');
});
