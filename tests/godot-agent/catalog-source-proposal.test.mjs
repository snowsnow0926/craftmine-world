import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compileScene,INITIAL_SNAPSHOT} from '../../app/scene.mjs';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../../',import.meta.url));
const {createLibraryBinding}=require('../../plugins/craftmine-world/godot-library.cjs');
const {buildInventory}=require('../../plugins/craftmine-world/godot-capability.cjs');
const {GODOT_METHODS,LOCAL_TOOLS}=require('../../plugins/craftmine-world/godot-routing.cjs');
const manifest=require('../../plugins/craftmine-world/manifest.json');
const ref={assetId:'source-kit',version:2,contentHash:'a'.repeat(64)};
const record=()=>({version_:{...ref,fileCount:1,bytes:42,files:[{path:'kit.zip',bytes:42,sha256:'b'.repeat(64),mediaType:'application/zip'}]}});
function fixture(value=record()){
  const calls=[];const core={call:async(method,params)=>{calls.push({method,params});assert.equal(method,'asset.read');return value;}};
  return {calls,library:createLibraryBinding({core,worldId:'bound-world',context:{sessionId:'private-session'},methods:{asset:{read:'custom.not-used'}}})};
}
test('proposal reads exact catalog metadata once and returns no write authority or blob',async()=>{
  const metadata={...record(),blobPath:'private',context:{secret:'private'}};
  const {library,calls}=fixture(metadata);const result=await library.proposeSourceInstall({ref,worldId:'forged',operationId:'forged'});
  assert.deepEqual(calls,[{method:'asset.read',params:{assetId:ref.assetId,version:ref.version}}]);
  assert.deepEqual(result.ref,ref);assert.equal(result.worldId,'bound-world');
  assert.equal(result.method,'importCatalogSource');assert.equal(result.applies,false);assert.equal(result.requiresPlayerAction,true);
  for(const key of ['context','operationId','blobPath','archiveBase64','hostProvenance','params'])assert.equal(result[key],undefined);
  assert.match(result.note,/no authorization/);
  assert.equal(library.proposeInstall({ref}).method,'package.install');assert.equal(calls.length,1);
});
test('latest, wildcard, invalid exact versions and oversized IDs fail before reads',async()=>{
  for(const invalid of [{...ref,assetId:'latest'},{...ref,assetId:'*'},{...ref,assetId:'source-*'},{...ref,version:'latest'},{...ref,version:0},{...ref,version:1000001},{...ref,assetId:'中'.repeat(41)},{...ref,assetId:'x\u0000'},{...ref,assetId:'x\u0085'},{...ref,contentHash:'B'.repeat(64)},{...ref,extra:true}]){
    const {calls,library}=fixture();await assert.rejects(library.proposeSourceInstall({ref:invalid}));assert.equal(calls.length,0);
  }
});
test('catalog hash cannot be replaced by ZIP hash; mismatched identity or metadata is refused',async()=>{
  const cases=[null,{version_:{...record().version_,assetId:'foreign'}},{version_:{...record().version_,version:3}},
    {version_:{...record().version_,contentHash:'b'.repeat(64)}},{version_:{...record().version_,fileCount:2}},
    {version_:{...record().version_,files:[]}},{version_:{...record().version_,files:[...record().version_.files,...record().version_.files]}},
    {version_:{...record().version_,files:[{...record().version_.files[0],mediaType:'text/plain'}]}},
    {version_:{...record().version_,bytes:43}},{version_:{...record().version_,files:[{...record().version_.files[0],bytes:6*1024*1024}]}},
    {version_:{...record().version_,files:[{...record().version_.files[0],sha256:'bad'}]}}];
  for(const value of cases){const {calls,library}=fixture(value);await assert.rejects(library.proposeSourceInstall({ref}));assert.equal(calls.length,1);}
});
test('missing canonical asset.read reports dependency unknown without fabricating a proposal',async()=>{
  const core={call:async()=>{throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});}};
  const result=await createLibraryBinding({core,worldId:'w'}).proposeSourceInstall({ref});
  assert.equal(result.available,false);assert.equal(result.requiredHostMethod,'asset.read');assert.equal(result.proposal,undefined);assert.equal(result.applies,false);
});
test('capability registers metadata read plus proposal without claiming installation authority',()=>{
  const get=(assetCatalog,worldId='w')=>buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:{sessionDrafts:true,assetCatalog,creationPackages:false},executionContext:{worldId}}).tools.find(t=>t.name==='package_library');
  const tool=get(true),mode=tool.modes.find(m=>m.mode==='propose-source-install');
  assert.equal(tool.reachable,true);assert.equal(mode.reachable,true);assert.equal(mode.hostMethod,'asset.read');assert.equal(mode.proposedHostMethod,'importCatalogSource');assert.equal(mode.kind,'proposal');assert.equal(mode.applies,false);
  assert.equal(get(false).modes.find(m=>m.mode===mode.mode).reachable,false);
  assert.equal(get(undefined).modes.find(m=>m.mode===mode.mode).reachable,null);
  assert.equal(get(true,null).modes.find(m=>m.mode===mode.mode).reachable,null);
});
const built=path.join(root,'desktop/build/craftmine.world');
const builtTools=fs.existsSync(path.join(built,'world-tools.cjs'))?require(path.join(built,'world-tools.cjs')).createWorldTools:null;
const invocation={projectId:'proposal-project',sessionId:'proposal-session',turnId:'proposal-turn',toolCallId:'proposal-call',executionId:'proposal-execution'};
function tool(core,isEnded=()=>false){return builtTools(core,async()=>{throw Error('SETTINGS_MUST_NOT_SELECT_WORLD');},isEnded).find(t=>t.name==='package_library');}
test('actual packaged broker uses task.context and one asset.read, no workspace lease or settings',{skip:builtTools?false:'Build plugin first'},async()=>{
  for(const name of ['godot-library.cjs','world-tools.cjs','manifest.json','godot-routing.cjs','godot-capability.cjs'])assert.deepEqual(fs.readFileSync(path.join(built,name)),fs.readFileSync(path.join(root,'plugins/craftmine-world',name)),name);
  const calls=[];let ended=false;
  const core={start:async()=>({}),call:async(method,params)=>{calls.push({method,params});if(method==='task.context')return {world:{id:'bound-world'}};if(method==='asset.read')return record();throw Error('UNEXPECTED_CALL '+method);}};
  const result=await tool(core).execute({mode:'propose-source-install',ref},invocation);
  assert.equal(result.worldId,'bound-world');assert.deepEqual(calls.map(c=>c.method),['task.context','asset.read']);
  calls.length=0;await assert.rejects(tool(core).execute({mode:'propose-source-install',ref,worldId:'forged'},invocation));assert.equal(calls.length,0);
  const unbound={...core,call:async method=>{assert.equal(method,'task.context');return {world:null};}};
  await assert.rejects(tool(unbound).execute({mode:'propose-source-install',ref},invocation),/WORLD_BINDING_UNRESOLVED/);
  const late={...core,call:async(method,params)=>{const value=await core.call(method,params);if(method==='asset.read')ended=true;return value;}};
  await assert.rejects(tool(late,()=>ended).execute({mode:'propose-source-install',ref},invocation),/TURN_ENDED/);
});
const binary=process.env.CRAFTMINE_CORE_BIN;
test('real catalog exact source ZIP suggestion is read-only in the packaged model route',{skip:binary&&builtTools?false:'CRAFTMINE_CORE_BIN and built plugin required'},async t=>{
  const {CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const dir=fs.mkdtempSync(path.join(root,'test-results/catalog-source-proposal-'));
  const core=new CoreClient(binary,path.join(dir,'data'));t.after(()=>core.stop());await core.start();
  await assert.rejects(tool(core).execute({mode:'propose-source-install',ref},invocation));
  const scene=compileScene({format:'craftmine.scene/3',title:'Proposal diagnostic',night:false,objects:[],systems:[],behaviors:[]});
  await core.call('world.create',{id:'proposal-world',title:'Proposal diagnostic',world:{build:{...scene,id:'v-'+scene.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]}});
  await core.call('workspace.open',{context:{projectId:invocation.projectId,sessionId:invocation.sessionId,turnId:invocation.turnId},selectedWorld:'proposal-world'});
  const source=path.join(root,'docs/evidence/gu6-kenney-modules-20260912/building.zip');
  const imported=await core.call('asset.import',{operationId:'seed-catalog',sourceRoot:path.dirname(source),sourcePath:source,assetId:'kenney-building-proposal',version:1,kind:'object',mediaKind:'package',path:'building.zip',mediaType:'application/zip',displayName:'Proposal diagnostic',source:{origin:'https://github.com/KenneyNL/Starter-Kit-City-Builder',author:'Kenney; trial adapter',license:'Retained inside ZIP',licenseStatus:'unverified'}});
  const exact={assetId:imported.assetId,version:imported.version,contentHash:imported.contentHash};
  const calls=[];const readCore={start:()=>core.start(),call:(method,params)=>{assert.ok(['task.context','asset.read'].includes(method),'model route must be read-only');calls.push({method,params});return core.call(method,params);}};
  const result=await tool(readCore).execute({mode:'propose-source-install',ref:exact},invocation);
  assert.equal(result.worldId,'proposal-world');assert.deepEqual(result.ref,exact);assert.deepEqual(calls.map(c=>c.method),['task.context','asset.read']);
  const successCalls=calls.splice(0);
  const zipHash=createHash('sha256').update(fs.readFileSync(source)).digest('hex');assert.notEqual(exact.contentHash,zipHash);
  await assert.rejects(tool(readCore).execute({mode:'propose-source-install',ref:{...exact,contentHash:zipHash}},invocation),/SOURCE_CATALOG_REF_MISMATCH/);
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({format:'craftmine.catalog-source-proposal-trial/1',binary,coreSha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),result,attempts:[{case:'exact-catalog-ref',calls:successCalls},{case:'zip-hash-instead-of-catalog-hash',rejected:true,calls}],zipSha256:zipHash,modelCalls:0,modelRouteWrites:0,scope:'Explicit diagnostic world/catalog setup; each actual packaged proposal invocation only reads task.context and asset.read; no install or Godot execution'},null,2));
  console.log('catalog_source_proposal_evidence='+path.join(dir,'report.json'));
});
