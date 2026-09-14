// Read-only broker compatibility. The city fixture is an actual indexed source
// interface subset; all host calls here are doubles, not native/model evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const plugin=process.env.CRAFTMINE_GUIDANCE_PLUGIN_ROOT??path.join(root,'plugins/craftmine-world');
const {queryGuidance}=require(path.join(plugin,'godot-guidance.cjs'));
const corpus=require(path.join(plugin,'guidance/catalog.json')),skill=corpus.skills.find(x=>x.interfaceCohorts);
const registry=require(path.join(root,'plugins/craftmine-world/guidance/interface-cohorts.json'));
const city=require('./fixtures/city-rev9-interface.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(input){
 const files=structuredClone(input),calls=[];let tamper=()=>{};
 const identity={worldId:city.worldId,revision:city.revision,manifestHash:city.manifestHash};
 const core={call:async(method,args)=>{
  calls.push({method,args});let result;
  if(method==='godotProject.index'){
   const offset=args.offset??0,limit=args.limit??32;
   result={...identity,baseId:'creation-sandbox',baseBuild:'gbd-'+'b'.repeat(64),engineVersion:'4.7.2-stable',totalFiles:files.length,files:files.slice(offset,offset+limit),nextOffset:offset+limit<files.length?offset+limit:null};
  }else if(method==='godotProject.read'){
   const file=files.find(f=>f.path===args.path);if(!file)throw Error('PROJECT_FILE_NOT_FOUND');
   result={...identity,...file,text:'',offset:0,nextOffset:null};
  }else throw Error('Unexpected non-read host call '+method);
  tamper(method,args,result);return result;
 }};
 return{files,calls,alter:fn=>tamper=fn,run:(args={mode:'catalog'})=>queryGuidance(core,{context:{},worldId:identity.worldId,args})};
}
function variantFiles(variant,line=0){
 const files=variant.files.map(f=>({path:f.path,sha256:f.acceptedSourceHashes[line]}));
 for(const ref of skill.references.filter(r=>r.requiredInterface)){
  const p=variant.referencePaths[ref.projectPath]??ref.projectPath;
  if(!files.some(f=>f.path===p))files.push({path:p,sha256:ref.acceptedSourceHashes[line]});
 }
 return files;
}
test('released cohorts and archived references stay unchanged while the guidance text has its own version',()=>{
 assert.equal(hash(JSON.stringify(skill.interfaceCohorts.variants.slice(0,2))),'1f2cc391d9f7c16d9f4f818ad5f5cc5df6a7e507cd2f2e19bc8fa3a017b63878');
 assert.equal(hash(JSON.stringify(skill.references)),'0ca22508585c004bba59e2074f8f4fcae9e910f9bfd8ade5c02076f71db767ee');
 assert.equal(skill.version,'1.8.2');
 assert.equal(hash(skill.text),'df5c0dc2fd94a1c2727232c3dff6ff3ac48e505816b94f8e6330e94e715031aa');
 assert.deepEqual(skill.interfaceCohorts,registry);assert.equal(corpus.version,'1.8.4');
});
test('explicitly enumerated full cohorts support LF/CRLF and retained exact reference reads',async()=>{
 for(const variant of registry.variants)for(const line of [0,1]){
  const f=fixture(variantFiles(variant,line)),catalog=await f.run();
  assert.equal(catalog.interfaceMatches[0].profile,variant.profile);
  const ref=skill.references.find(r=>r.projectPath==='craftmine_shared/base_adapter.gd');
  const read=await f.run({mode:'read',id:skill.id,version:skill.version,sha256:ref.sha256,path:ref.path,revision:city.revision,manifestHash:city.manifestHash});
  assert.equal(read.sha256,ref.sha256);
  const inherited=variant.referencePaths['craftmine_shared/base_adapter.gd']??'craftmine_shared/base_adapter.gd';
  assert(f.calls.some(c=>c.method==='godotProject.read'&&c.args.path===inherited));
 }
});
test('actual city rev9 interface now resolves preview cohort while retaining authored-source restrictions',async()=>{
 const f=fixture(city.files);f.files.push({path:'scripts/city_flight_world.gd',sha256:'f'.repeat(64)});
 const result=await f.run();assert.equal(result.available,true);
 assert.equal(result.interfaceMatches[0].profile,'creation-player-collision-engine-preview/1');
 assert.equal(result.interfaceMatches[0].referencePaths['craftmine_shared/runtime_bridge.gd'],'craftmine_shared/runtime_bridge_base.gd');
 for(const p of ['scripts/creation_world.gd','scripts/scene_contract.gd','craftmine_shared/component_state.gd']){
  const changed=fixture(city.files);changed.files.find(file=>file.path===p).sha256='a'.repeat(64);
  await assert.rejects(changed.run(),/GUIDANCE_INTERFACE_UNSUPPORTED/);
 }
});
test('every new controlled member fails when missing or custom; old picker and bridge cannot be mixed into preview',async()=>{
 for(const variant of registry.variants.filter(v=>v.profile.includes('engine-preview'))){
  for(const member of variant.files)for(const mode of ['missing','custom']){
   const f=fixture(variantFiles(variant));const at=f.files.findIndex(x=>x.path===member.path);
   if(mode==='missing')f.files.splice(at,1);else f.files[at].sha256='f'.repeat(64);
   await assert.rejects(f.run(),/GUIDANCE_INTERFACE_(UNSUPPORTED|MISSING)/,variant.profile+' '+member.path+' '+mode);
  }
  for(const p of ['craftmine_shared/runtime_bridge.gd','craftmine_shared/scene_mesh_picker_v2.gd']){
   if(!variant.files.some(f=>f.path===p))continue;
   const f=fixture(variantFiles(variant));f.files.find(x=>x.path===p).sha256=registry.variants[0].files.find(x=>x.path===p).acceptedSourceHashes[0];
   await assert.rejects(f.run(),/GUIDANCE_INTERFACE_UNSUPPORTED/);
  }
  const incomplete=fixture(variantFiles(variant).filter(f=>!['craftmine_shared/runtime_bridge_base.gd','craftmine_shared/engine_performance.gd'].includes(f.path)));
  await assert.rejects(incomplete.run(),/GUIDANCE_INTERFACE_UNSUPPORTED/,'known top-level wrapper alone cannot fall back to legacy');
 }
});
test('reserved aliases, bytecode/remap paths and duplicate members do not inherit source compatibility',async()=>{
 for(const name of ['craftmine_shared/runtime_bridge.gd','craftmine_shared/runtime_bridge_base.gd','craftmine_shared/engine_performance.gd','craftmine_shared/scene_mesh_picker_v2.gd']){
  for(const alias of [name.toUpperCase(),name+'.remap',name.replace(/\.gd$/,'.gdc'),name+'.unknown']){
   const f=fixture(city.files);f.files.push({path:alias,sha256:'f'.repeat(64)});
   await assert.rejects(f.run(),/GUIDANCE_INTERFACE_UNSUPPORTED/);
  }
 }
 const f=fixture(city.files);f.files.push({...f.files[0]});await assert.rejects(f.run(),/INVALID_PROJECT_PAGE/);
});
test('required inherited reference identity and bytes are checked after full cohort matching',async()=>{
 for(const changed of ['sha256','worldId','manifestHash']){
  const f=fixture(city.files);f.alter((method,args,result)=>{if(method==='godotProject.read'&&args.path==='craftmine_shared/base_adapter_legacy.gd')result[changed]=changed==='worldId'?'foreign':'f'.repeat(64);});
  await assert.rejects(f.run(),/GUIDANCE_(INTERFACE_UNSUPPORTED|SOURCE_IDENTITY_INVALID)/);
 }
});
