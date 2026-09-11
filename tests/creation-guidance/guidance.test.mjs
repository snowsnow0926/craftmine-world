// Pure broker integration with a fake host, plus exact shipped source checks.
// No provider, engine, browser, input simulation or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const plugin=path.join(root,'plugins/craftmine-world');
const require=createRequire(import.meta.url);
const corpus=require(path.join(plugin,'guidance/catalog.json'));
const hash=text=>createHash('sha256').update(text).digest('hex');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-guidance-'));
for(const file of ['manifest.json','world-tools.cjs','godot-routing.cjs','godot-docs.cjs','godot-query.cjs',
  'godot-observe.cjs','godot-capability.cjs','godot-history.cjs','godot-jobs.cjs','godot-library.cjs',
  'tool-services.cjs','godot-guidance.cjs','creation-operations.cjs','creation-sequence-rule.cjs','creation-operation-schema.cjs','creation-change-summary.cjs'])fs.copyFileSync(path.join(plugin,file),path.join(temp,file));
fs.cpSync(path.join(plugin,'guidance'),path.join(temp,'guidance'),{recursive:true});
fs.writeFileSync(path.join(temp,'domain.cjs'),`module.exports={
  fields(args,required,optional){for(const k of required)if(!Object.hasOwn(args,k))throw Error('MISSING_FIELD');
    for(const k of Object.keys(args))if(![...required,...optional].includes(k))throw Error('UNKNOWN_FIELD');},
  createLibraryService:()=>({}),createMemoryService:()=>({})};`);
const {createWorldTools}=require(path.join(temp,'world-tools.cjs'));
const manifest=require(path.join(plugin,'manifest.json'));
const {capabilityReport}=require(path.join(plugin,'godot-capability.cjs'));
const {GODOT_METHODS,LOCAL_TOOLS}=require(path.join(plugin,'godot-routing.cjs'));
const invocation={projectId:'project',sessionId:'session',turnId:'turn',toolCallId:'call',executionId:'execution'};
const skill=corpus.skills[0];
function fixture({baseId='first-person',baseBuild='first-person-0.1.0',engineVersion='4.7.2-stable',missing=false,modified=false,ended=false,foreign=false,selectedSkill=skill}={}){
  const calls=[];
  const core={start:async()=>({godotProjects:true}),call:async(method,args)=>{
    calls.push({method,args});
    if(method==='workspace.open')return {worldId:'bound-world'};
    if(method==='godotProject.index')return {worldId:'bound-world',revision:args.revision??7,
      manifestHash:args.manifestHash??'a'.repeat(64),baseId,baseBuild,engineVersion};
    if(method==='godotProject.read'){
      if(missing)throw Error('PROJECT_FILE_NOT_FOUND');
      const ref=selectedSkill.references.find(ref=>ref.projectPath===args.path);
      return {...args,worldId:foreign?'foreign-world':args.worldId,
        sha256:modified?'f'.repeat(64):ref.sha256,text:'x',nextOffset:1};
    }
    throw Error(`Unexpected host method ${method}`);
  }};
  const tools=createWorldTools(core,async()=>({activeWorldId:'selected-other-world',discussionOnly:true}),()=>ended);
  return {calls,run:(args,context=invocation)=>tools.find(tool=>tool.name==='godot_guidance').execute(args,context)};
}
const readArgs=(catalog,extra={})=>({mode:'read',id:skill.id,version:skill.version,sha256:skill.sha256,
  revision:catalog.source.revision,manifestHash:catalog.source.manifestHash,...extra});

test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));

test('shipped guidance and every reference hash match real versioned source',()=>{
  const base=JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/bases/first-person/base_manifest.json')));
  assert.equal(skill.applicability.baseVersion,base.baseVersion);
  assert.equal(skill.applicability.engineVersion,base.engine.version);
  assert.equal(hash(skill.text),skill.sha256);
  assert.equal(skill.text,fs.readFileSync(path.join(plugin,'guidance/equipment-parameters.md'),'utf8').replace(/\r\n/g,'\n'));
  for(const ref of skill.references){
    const actual=fs.readFileSync(path.join(root,ref.sourcePath),'utf8');
    assert.equal(actual.replace(/\r\n/g,'\n'),ref.text);
    assert.equal(hash(ref.text),ref.sha256);
    assert.ok(ref.acceptedSourceHashes.includes(hash(actual)));
  }
});

test('actual broker catalog then paged skill/reference read uses bound source and loads text',async()=>{
  const f=fixture(),catalog=await f.run({mode:'catalog'});
  assert.equal(catalog.available,true);
  assert.equal(catalog.skills.length,1);
  assert.equal(catalog.skills[0].text,undefined);
  assert.equal(catalog.skills[0].references[0].text,undefined);
  assert.equal(catalog.source.worldId,'bound-world');
  assert.ok(f.calls.filter(call=>call.method==='godotProject.read').every(call=>call.args.worldId==='bound-world'));
  let offset=0,text='';
  do {const page=await f.run(readArgs(catalog,{offset,limit:511}));text+=page.text;offset=page.nextOffset;
    assert.equal(page.loadRecord.sha256,skill.sha256);
    assert.equal(page.loadRecord.manifestHash,catalog.source.manifestHash);
  }while(offset!==null);
  assert.equal(text,skill.text);
  const ref=skill.references[0];
  const page=await f.run(readArgs(catalog,{path:ref.path,sha256:ref.sha256,limit:8000}));
  assert.equal(page.text,ref.text);
  assert.equal(page.nextOffset,null);
  assert.equal(page.authority,'bundled-craftmine-guidance');
});

test('unknown IDs, traversal, version, hash, forged identity and page errors fail before host reads',async()=>{
  const f=fixture(),catalog=await f.run({mode:'catalog'});
  for(const [args,error] of [
    [readArgs(catalog,{id:'../equipment-parameters'}),'GUIDANCE_SKILL_NOT_FOUND'],
    [readArgs(catalog,{path:'../../../../secret'}),'GUIDANCE_REFERENCE_NOT_FOUND'],
    [readArgs(catalog,{path:'C:\\secret'}),'GUIDANCE_REFERENCE_NOT_FOUND'],
    [readArgs(catalog,{path:'scripts/core/../core/equipment_definition.gd'}),'GUIDANCE_REFERENCE_NOT_FOUND'],
    [readArgs(catalog,{version:'latest'}),'GUIDANCE_VERSION_UNSUPPORTED'],
    [readArgs(catalog,{sha256:'b'.repeat(64)}),'GUIDANCE_HASH_MISMATCH'],
    [readArgs(catalog,{revision:undefined,manifestHash:undefined}),'GUIDANCE_SOURCE_PIN_REQUIRED'],
    [readArgs(catalog,{limit:8001}),'INVALID_GUIDANCE_PAGE'],
    [readArgs(catalog,{offset:-1}),'INVALID_GUIDANCE_PAGE'],
    [readArgs(catalog,{worldId:'foreign'}),'UNKNOWN_FIELD'],
  ]){const before=f.calls.length;await assert.rejects(f.run(args),new RegExp(error));assert.equal(f.calls.length,before);}
  await assert.rejects(f.run({mode:'catalog'},{...invocation,toolCallId:'@host:spoof'}),/RESERVED_HOST_RECEIPT/);
  await assert.rejects(fixture({ended:true}).run({mode:'catalog'}),/TURN_ENDED/);
});

test('unsupported base/engine/build gives an empty catalog and rejects pinned skill reads',async()=>{
  for(const options of [{baseId:'top-down'},{baseBuild:'first-person-0.2.0'},{baseBuild:'custom'},{engineVersion:'4.8-stable'}]){
    const f=fixture(options),catalog=await f.run({mode:'catalog'});
    assert.equal(catalog.available,false);assert.deepEqual(catalog.skills,[]);
    assert.equal(catalog.reason,'GUIDANCE_BASE_UNSUPPORTED');
    await assert.rejects(f.run(readArgs(catalog)),/GUIDANCE_BASE_UNSUPPORTED/);
  }
});

test('missing, customized and foreign interface source is rejected',async()=>{
  for(const [options,error] of [[{missing:true},'GUIDANCE_INTERFACE_MISSING'],[{modified:true},'GUIDANCE_INTERFACE_UNSUPPORTED'],[{foreign:true},'GUIDANCE_SOURCE_IDENTITY_INVALID']]){
    await assert.rejects(fixture(options).run({mode:'catalog'}),new RegExp(error));
  }
});

test('manifest, capabilities, initial prompt and product discovery expose the new route',()=>{
  const definition=manifest.contributes.agentTools.find(tool=>tool.name==='godot_guidance');
  assert.equal(definition.risk,'low');assert.equal(definition.schema.additionalProperties,false);
  const report=capabilityReport({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:{godotProjects:true}});
  assert.match(JSON.stringify(report),/godot_guidance/);
  assert.equal(LOCAL_TOOLS.godot_guidance.hostMethod,'godotProject.index+godotProject.read');
  const prompt=fs.readFileSync(path.join(root,'vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts'),'utf8');
  assert.match(prompt,/call godot_guidance mode=catalog when advertised/);
  assert.match(prompt,/ToolSearch only for additional tools absent from the current tool list/);
  assert.match(prompt,/Continue using godot_docs/);
  const runtime=fs.readFileSync(path.join(root,'vendor/pi-desktop/packages/agent-runtime/src/runtime.ts'),'utf8');
  assert.match(runtime,/tool\.name\.startsWith\("plugin_craftmine_world_"\)/);
  const main=fs.readFileSync(path.join(plugin,'main.cjs'),'utf8');
  assert.match(main,/for\(const tool of createWorldTools[\s\S]*?pi\.agent\.registerTool\(tool\)/);
});

test('catalog and paged guidance separate applicability from actual write authority',async()=>{
  for(const selectedSkill of corpus.skills){
    const f=fixture({baseId:selectedSkill.applicability.baseId,baseBuild:selectedSkill.applicability.baseBuild,selectedSkill});
    const catalog=await f.run({mode:'catalog'});
    const page=await f.run({mode:'read',id:selectedSkill.id,version:selectedSkill.version,sha256:selectedSkill.sha256,
      revision:catalog.source.revision,manifestHash:catalog.source.manifestHash,limit:8000});
    assert.deepEqual(catalog.requiredInterfacePolicy,corpus.requiredInterfacePolicy);
    assert.deepEqual(page.requiredInterfacePolicy,catalog.requiredInterfacePolicy);
    assert.match(catalog.requiredInterfacePolicy.meaning,/not a read-only marker/);
    assert.match(catalog.requiredInterfacePolicy.writeAuthority,/godot_project_patch/);
    assert.ok(page.text.includes('requiredInterface: true'));
    assert.ok(page.text.includes('`'+selectedSkill.version+'`'),'template version must match the catalog');
    assert.ok(f.calls.every(call=>['workspace.open','godotProject.index','godotProject.read'].includes(call.method)));
  }
});

test('changed applicability still rejects the same hash but explains it is not source protection',async()=>{
  const creation=corpus.skills.find(entry=>entry.id==='creation-sandbox.authoring');
  const f=fixture({baseId:creation.applicability.baseId,baseBuild:creation.applicability.baseBuild,selectedSkill:creation,modified:true});
  await assert.rejects(f.run({mode:'catalog'}),error=>{
    assert.equal(error.errorCode,'GUIDANCE_INTERFACE_UNSUPPORTED');
    assert.match(error.message,/scripts\/creation_world.gd/);
    assert.match(error.message,/not a write-permission denial/);
    assert.match(error.message,/Reinspect current source/);
    return true;
  });
  assert.ok(creation.references.filter(ref=>ref.requiredInterface).length===3);
});

test('造物指导按真实底座和三个接口哈希匹配，普通脚本示例可以分页读取',async()=>{
 const creationSkill=corpus.skills.find(entry=>entry.id==='creation-sandbox.authoring');
 assert.ok(creationSkill);
 const base=JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/bases/creation-sandbox/manifest.json')));
 assert.equal(creationSkill.applicability.baseVersion,base.baseVersion);
 assert.equal(hash(creationSkill.text),creationSkill.sha256);
 assert.equal(creationSkill.text,fs.readFileSync(path.join(plugin,'guidance',creationSkill.path),'utf8').replace(/\r\n/g,'\n'));
 for(const ref of creationSkill.references){
  const text=fs.readFileSync(path.join(root,ref.sourcePath),'utf8');
  assert.equal(text.replace(/\r\n/g,'\n'),ref.text,ref.sourcePath);
  assert.ok(ref.acceptedSourceHashes.includes(hash(text)));
 }
 const opts={baseId:'creation-sandbox',baseBuild:'creation-sandbox-1.0.0',selectedSkill:creationSkill};
 const f=fixture(opts),catalog=await f.run({mode:'catalog'});
 assert.deepEqual(catalog.skills.map(entry=>entry.id),[creationSkill.id]);
 assert.equal(f.calls.filter(call=>call.method==='godotProject.read').length,3);
 const adopted=await fixture({...opts,baseBuild:'gbd-'+ 'd'.repeat(64)}).run({mode:'catalog'});
 assert.equal(adopted.available,true);
 await assert.rejects(fixture({...opts,baseBuild:'gbd-'+ 'd'.repeat(64),modified:true}).run({mode:'catalog'}),/GUIDANCE_INTERFACE_UNSUPPORTED/);
 for(const entry of [creationSkill,creationSkill.references.find(ref=>ref.path==='examples/double-press-rule.gd')]){
  let offset=0,text='';
  do{const result=await f.run({mode:'read',id:creationSkill.id,version:creationSkill.version,sha256:entry.sha256,
   ...(entry===creationSkill?{}:{path:entry.path}),revision:catalog.source.revision,manifestHash:catalog.source.manifestHash,offset,limit:377});
   text+=result.text;offset=result.nextOffset;
  }while(offset!==null);
  assert.equal(text,entry.text);
 }
 await assert.rejects(fixture({...opts,modified:true}).run({mode:'catalog'}),/GUIDANCE_INTERFACE_UNSUPPORTED/);
 assert.match(creationSkill.text,/sourceRevision[\s\S]*expected.revision/);
 assert.match(creationSkill.text,/不能.*snapshot ID/);
 assert.match(creationSkill.text,/sequence-door[\s\S]*entity-behavior/);
 assert.match(creationSkill.text,/project_entities/);
 assert.match(creationSkill.text,/godot_build_start[\s\S]*mode=check[\s\S]*godot_build_read/);
 assert.match(creationSkill.text,/sourceTimeOfDay/);
});
