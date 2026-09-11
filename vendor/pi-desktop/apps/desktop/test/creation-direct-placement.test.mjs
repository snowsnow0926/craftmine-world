import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../electron/main/creation-edit-guards.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const {directCreationEditIntent}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
import {freezeCreationRequirements,creationEntitiesMatch} from '../electron/main/creation-check-requirements.ts';
const tree={id:'tree-a',kind:'tree',position:[2,0,0],scale:[1,1,1],color:'#123456',visible:true,solid:true};
const capture={source:'ray',target:{surface:'ground',entityId:null,position:[5,0,0]},entities:[tree]};

test('only actual ground can produce a direct placement intent',()=>{
 const input={action:'place',kind:'tree'};
 assert.equal(directCreationEditIntent(capture,input).action,'place');
 for(const changed of [{source:'recent'},{target:{...capture.target,surface:'entity'}},{target:{...capture.target,position:null}}])assert.throws(()=>directCreationEditIntent({...capture,...changed},input),/GROUND_REQUIRED/);
});
test('five default placements freeze actual appearance, position, count and untouched objects',()=>{
 for(const kind of ['tree','rock','chest','door','marker']){
  const intent=directCreationEditIntent(capture,{action:'place',kind}),r=freezeCreationRequirements(capture,intent).requirements;
  const placed={id:'new-a',kind,position:[5,0,0],scale:[1,1,1],color:'#84a866',visible:true,solid:true};
  assert.equal(creationEntitiesMatch(r,[tree,placed]),true);
  for(const patch of [{position:[6,0,0]},{scale:[2,1,1]},{color:'#112233'},{visible:false},{solid:false}])assert.equal(creationEntitiesMatch(r,[tree,{...placed,...patch}]),false);
  assert.equal(creationEntitiesMatch(r,[{...tree,color:'#ffffff'},placed]),false);
 }
});
test('one through eight copies freeze each distinct destination without loosening Rust duplicate contract',()=>{
 const selected={...capture,target:{surface:'entity',entityId:tree.id,position:tree.position}};
 for(const count of [1,2,8]){
  const intent=directCreationEditIntent(selected,{action:'duplicate',count,offset:[2,0,0]}),frozen=freezeCreationRequirements(selected,intent);assert.equal(frozen.status,'verifiable');assert.equal(frozen.requirements.duplicates,undefined);
  const copies=Array.from({length:count},(_,i)=>({...tree,id:'copy-'+i,position:[4+i*2,0,0]}));
  assert.equal(creationEntitiesMatch(frozen.requirements,[tree,...copies]),true);
  assert.equal(creationEntitiesMatch(frozen.requirements,[tree,...copies.slice(1)]),false);
  assert.equal(creationEntitiesMatch(frozen.requirements,[tree,...copies.map((e,i)=>i===0?{...e,color:'#ffffff'}:e)]),false);
  assert.equal(creationEntitiesMatch(frozen.requirements,[tree,...copies.map((e,i)=>i===0?{...e,position:tree.position}:e)]),false);
 }
});
