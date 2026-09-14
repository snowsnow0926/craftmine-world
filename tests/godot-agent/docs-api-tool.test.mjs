import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {validateToolArguments}=await import(pathToFileURL(path.resolve('vendor/pi-desktop/packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/validation.js')));
const directory=path.resolve(process.env.CRAFTMINE_DOCS_API_PLUGIN??'test-results/docs-api-plugin');
const manifest=require(path.join(directory,'manifest.json')),definition=manifest.contributes.agentTools.find(t=>t.name==='godot_docs');
const {createWorldTools}=require(path.join(directory,'world-tools.cjs'));
const invocation={projectId:'p',sessionId:'s',turnId:'t',executionId:'e',toolCallId:'read-docs'};
const calls=[];const tool=createWorldTools({start:async()=>{calls.push('start');throw Error('DOCS_MUST_NOT_OPEN_CORE');},call:async()=>{calls.push('call');throw Error('DOCS_MUST_NOT_CALL_CORE');}},async()=>{throw Error('DOCS_MUST_NOT_READ_WORLD_SETTINGS');}).find(t=>t.name==='godot_docs');
const validate=(args,schema=definition.schema)=>validateToolArguments({name:'plugin_craftmine_world_godot_docs',parameters:schema},{name:'plugin_craftmine_world_godot_docs',arguments:args});
const invoke=args=>tool.execute(validate(args),invocation);
const lock=require('../../desktop/godot/toolchain.lock.json');

test('actual prior published schema rejected class queries; current schema reaches existing pinned metadata',async()=>{
  const old=JSON.parse(fs.readFileSync(new URL('../fixtures/godot-docs/preview25-digest-only-schema.json',import.meta.url),'utf8'));
  const args={mode:'api-class',className:'NavigationServer3D',memberName:'map_force_update'};
  assert.throws(()=>validate(args,old.tool.schema),/Validation failed/);const value=await invoke(args);assert.equal(value.status,'known');assert.equal(value.items[0].name,'map_force_update');assert.deepEqual(calls,[]);
});
test('NavigationMesh, NavigationServer3D and NavigationAgent3D expose actual names and argument/return types',async()=>{
  const cases=[['NavigationMesh','set_vertices',['PackedVector3Array'],'Nil'],['NavigationServer3D','bake_from_source_geometry_data',['Object','Object','Callable'],'Nil'],['NavigationServer3D','region_set_map',['RID','RID'],'Nil'],['NavigationAgent3D','get_navigation_map',[],'RID'],['NavigationAgent3D','get_next_path_position',[],'Vector3']];
  for(const [className,memberName,types,resultType]of cases){const value=await invoke({mode:'api-class',className,memberName,kind:'method'}),member=value.items[0].metadata;assert.equal(value.status,'known');assert.equal(member.name,memberName);assert.deepEqual(member.args.map(arg=>arg.typeName),types);assert.equal(member.return.typeName,resultType);assert.equal(value.pin.engineVersion,lock.version);assert.equal(value.engineSha256,lock.editor.executableSha256);assert(value.limitations.some(line=>line.includes('not full API documentation')));}
});
test('real public API pages require exact continuation pins and unknown metadata is not invented support',async()=>{
  const request={mode:'api-class',className:'NavigationAgent3D',kind:'method',limit:2};const first=await invoke(request);assert(first.nextOffset>0);
  await assert.rejects(()=>invoke({...request,offset:first.nextOffset}),/CONTINUATION_PIN_REQUIRED/);
  const second=await invoke({...request,...first.pin,offset:first.nextOffset});assert.equal(second.pin.corpusHash,first.pin.corpusHash);assert(!first.items.some(a=>second.items.some(b=>a.name===b.name)));
  const search=await invoke({mode:'api-search',query:'NavigationAgent3D',kind:'class'});assert(search.items.some(item=>item.name==='NavigationAgent3D'));
  assert.equal((await invoke({mode:'api-class',className:'NavigationAgentImaginary'})).reason,'CLASS_NOT_IN_RUNTIME_METADATA');
  assert.equal((await invoke({mode:'api-class',className:'NavigationMesh',memberName:'imaginary'})).reason,'MEMBER_NOT_IN_RUNTIME_METADATA');
  assert.equal((await invoke({mode:'api-info',engineVersion:'wrong-engine'})).reason,'ENGINE_API_VERSION_NOT_INSTALLED');
  assert.equal((await invoke({mode:'api-info',corpusHash:'f'.repeat(64)})).reason,'ENGINE_API_METADATA_PIN_MISMATCH');
  await assert.rejects(()=>invoke({mode:'api-class',className:'NavigationMesh',limit:101}),/ENGINE_API_QUERY_INVALID/);
  assert.throws(()=>validate({mode:'api-info',executable:'anything'}),/Validation failed/);
});
test('digest coverage gaps now direct to API metadata while original manual bodies and pins remain intact',async()=>{
  const info=await invoke({mode:'info'});assert.equal(info.entries,16);assert.deepEqual(info.apiReference.infoRequest,{mode:'api-info'});assert.equal(info.corpusDigest,'7557b8bdaa6d3221d3757d53814189f179917159a3bee77a82ed4cc8a02f7d4c');
  const missing=await invoke({mode:'search',query:'NavigationAgent3D'});assert.equal(missing.matchCount,0);assert.equal(missing.coverageGap.status,'no-curated-match');assert.match(missing.guidance,/api-class/);
  const generic=await invoke({mode:'search',query:'map_force_update region map sync'});assert.match(generic.guidance,/generic word matches/i);
  const read=await invoke({mode:'read',id:'gdscript-basics',limit:100});assert(read.text.length>0);assert.equal(read.corpusDigest,info.corpusDigest);assert(read.nextOffset>0);
  const api=await invoke({mode:'api-info'});assert.equal(api.coverage.classes,1054);assert.equal(api.coverage.methods,17008);assert.deepEqual(api.modes,['api-info','api-class','api-search']);assert.deepEqual(calls,[]);
});
