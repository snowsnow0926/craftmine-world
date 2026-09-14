// Actual player index and shipped template bytes; host reads remain doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const plugin=process.env.CRAFTMINE_GUIDANCE_PLUGIN_ROOT??path.join(root,'plugins/craftmine-world');
const {queryGuidance}=require(path.join(plugin,'godot-guidance.cjs'));
const corpus=require(path.join(plugin,'guidance/catalog.json')),skill=corpus.skills.find(s=>s.interfaceCohorts);
const actual=require('./fixtures/player-pomeranian-rev5-index.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const monitor=skill.interfaceCohorts.variants.filter(v=>v.profile.includes('engine-monitor'));
function fixture(files=actual.files){
 const identity=Object.fromEntries(['worldId','revision','manifestHash','baseId','baseBuild','engineVersion'].map(k=>[k,actual[k]]));
 const calls=[];let tamper=()=>{};
 const core={call:async(method,args)=>{
  calls.push({method,args});let result;
  if(method==='godotProject.index'){
   const offset=args.offset??0,limit=args.limit??32;
   result={...identity,files:files.slice(offset,offset+limit),totalFiles:files.length,nextOffset:offset+limit<files.length?offset+limit:null};
  }else if(method==='godotProject.read'){
   const file=files.find(f=>f.path===args.path);if(!file)throw Error('PROJECT_FILE_NOT_FOUND');
   result={...identity,...file,text:'',nextOffset:null};
  }else assert.fail('Unexpected write or execution '+method);
  tamper(method,args,result);return result;
 }};
 return {calls,alter:fn=>tamper=fn,run:(args={mode:'catalog'})=>queryGuidance(core,{context:{},worldId:identity.worldId,args})};
}
test('actual 54-file player index catalogs and reads the exact inherited recipe without source changes',async()=>{
 const before=JSON.stringify(actual),f=fixture(),catalog=await f.run();
 assert.equal(actual.files.length,54);assert.equal(new Set(actual.files.map(f=>f.path)).size,54);
 assert.equal(catalog.interfaceMatches[0].profile,'creation-player-collision-engine-monitor-ray-local/1');
 assert(f.calls.some(c=>c.method==='godotProject.index'&&c.args.offset===32));
 const ref=skill.references.find(r=>r.projectPath==='craftmine_shared/base_adapter.gd');
 const result=await f.run({mode:'read',id:skill.id,version:skill.version,sha256:ref.sha256,path:ref.path,revision:actual.revision,manifestHash:actual.manifestHash});
 assert.equal(result.sha256,ref.sha256);assert(f.calls.some(c=>c.method==='godotProject.read'&&c.args.path==='craftmine_shared/base_adapter_legacy.gd'));
 assert.equal(JSON.stringify(actual),before);
 for(const field of ['worldId','manifestHash','sha256']){
  const stale=fixture();stale.alter((method,args,result)=>{if(method==='godotProject.read')result[field]='f'.repeat(64);});
  await assert.rejects(stale.run(),/GUIDANCE_(SOURCE_IDENTITY_INVALID|INTERFACE_UNSUPPORTED)/);
 }
});
test('new exact cohorts derive from shipped mainline bytes and the fixed picker upgrade; all old declarations remain',async()=>{
 const prior=structuredClone(skill.interfaceCohorts);prior.variants=prior.variants.slice(0,7);
 assert.equal(hash(JSON.stringify(prior)),actual.provenance.priorRegistrySha256);
 const directory=path.join(root,'desktop/godot/shared/promo-templates/promo-mainline');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
 const files=manifest.files.map(f=>({...f}));
 for(const variant of monitor){
  for(const entry of variant.files){
   let bytes=fs.readFileSync(path.join(directory,'source',entry.path));
   assert.equal(hash(bytes),manifest.files.find(f=>f.path===entry.path).sha256);
   if(variant.profile.includes('ray-local')&&entry.path==='craftmine_shared/scene_mesh_picker_v2.gd')bytes=fs.readFileSync(path.join(root,'desktop/godot/shared/scene_mesh_picker_v2.gd'));
   const text=bytes.toString('utf8').replace(/\r\n/g,'\n');
   assert.deepEqual(entry.acceptedSourceHashes,[hash(text),hash(text.replace(/\n/g,'\r\n'))],entry.path);
   files.find(f=>f.path===entry.path).sha256=hash(bytes);
  }
  assert.equal((await fixture(files).run()).interfaceMatches[0].profile,variant.profile);
 }
});
test('each retained monitor member remains mandatory and rejects changed, aliased, duplicated and mixed source',async()=>{
 for(const variant of monitor){
  const files=actual.files.map(f=>({...f}));
  for(const entry of variant.files)files.find(f=>f.path===entry.path).sha256=entry.acceptedSourceHashes[0];
  for(const member of variant.files)for(const mode of ['missing','changed','alias']){
   const changed=structuredClone(files),at=changed.findIndex(f=>f.path===member.path);
   if(mode==='missing')changed.splice(at,1);
   if(mode==='changed')changed[at].sha256='f'.repeat(64);
   if(mode==='alias')changed.push({...changed[at],path:member.path+'.remap'});
   await assert.rejects(fixture(changed).run(),/GUIDANCE_INTERFACE_(UNSUPPORTED|MISSING)/,variant.profile+' '+member.path+' '+mode);
  }
  const duplicate=[...files,files[0]];await assert.rejects(fixture(duplicate).run(),/INVALID_PROJECT_PAGE/);
  const mixed=structuredClone(files);mixed.find(f=>f.path==='craftmine_shared/base_adapter.gd').sha256=skill.interfaceCohorts.variants[0].files.find(f=>f.path==='craftmine_shared/base_adapter.gd').acceptedSourceHashes[0];
  await assert.rejects(fixture(mixed).run(),/GUIDANCE_INTERFACE_UNSUPPORTED/);
 }
});
