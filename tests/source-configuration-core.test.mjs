// Actual Rust catalog, immutable ZIP, source CAS and job persistence. No model or engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {packStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
import {parseScene} from '../desktop/godot/shared/scene_materializer.mjs';
const pluginDirectory=process.env.CRAFTMINE_CONFIGURATION_PLUGIN_DIR?path.resolve(process.env.CRAFTMINE_CONFIGURATION_PLUGIN_DIR):path.resolve(import.meta.dirname,'../plugins/craftmine-world');
const {createManagedPackageInstaller}=await import(pathToFileURL(path.join(pluginDirectory,'reuse-service.mjs')).href);
const {createAuthorSourceInstaller}=await import(pathToFileURL(path.join(pluginDirectory,'author-source-install.mjs')).href);
const {createSourceLibraryService}=createRequire(import.meta.url)(path.join(pluginDirectory,'source-library-service.cjs'));
const {createPackageInstallBinding,createPackageTurnLifecycle}=createRequire(import.meta.url)('../plugins/craftmine-world/package-turn-lifecycle.cjs');
const root=path.resolve(import.meta.dirname,'..'),binary=process.env.CRAFTMINE_CORE_BIN;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const context={projectId:'configuration-p',sessionId:'configuration-s',turnId:'configuration-t'},worldId='configuration-world';
const declaration={mode:'explicit-receiving-world-bounds',requiresWorldConfiguration:true,sourceProperties:{minimum:'saved_position_min',maximum:'saved_position_max'}};
const bounds=source=>({minimum:[-240,-20,-300],maximum:[240,160,80],expectedSource:{revision:source.revision,manifestHash:source.manifestHash}});
async function fixture(t,{stock=false,legacy=false}={}){
 await fs.mkdir(path.join(root,'test-results'),{recursive:true});
 const directory=await fs.mkdtemp(path.join(root,'test-results/source-configuration-core-')),calls=[];
 let core=new CoreClient(binary,path.join(directory,'data'));
 const call=async(method,args)=>{calls.push({method,args});return core.call(method,args,120000);};
 t.after(async()=>{await core.stop();await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({format:'craftmine.source-configuration-core/1',coreSha256:sha(await fs.readFile(binary)),test:t.name,calls:calls.map(c=>c.method),limits:'Actual Rust source/check persistence; executor unavailable, no runtime/adoption/save claims.'},null,2));console.log('Evidence: '+directory);});
 await core.start();
 const initial=JSON.parse(await fs.readFile(path.join(root,'desktop/godot/shared/initial-states/creation-sandbox-blank.json'),'utf8')).snapshot;
 initial.worldId=worldId;initial.body.worldId=worldId;
 await call('world.create',{id:worldId,title:'Configuration fixture',world:{build:{id:'configuration-base',scene:{format:'craftmine.godot-scene/1',baseId:'creation-sandbox'},godot:{}},snapshot:initial,extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});
 const baseSource=stock==='city'?'desktop/godot/shared/promo-templates/promo-city/source':'desktop/godot/bases/creation-sandbox';
 const files=stock?await Promise.all(['project.godot','scenes/creation.tscn',stock==='city'?'scripts/orgrimmar_world.gd':'scripts/creation_world.gd'].map(async name=>({path:name,text:await fs.readFile(path.join(root,baseSource,name),'utf8')}))):[
  {path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},
  {path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n[node name="ExistingDog" type="Node3D" parent="."]\nmetadata/entity_id = "existing-dog"\n'}];
 await call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'configuration-base',baseId:'creation-sandbox',files});
 await call('content.migrate.apply',{worldId});
 const before=await call('godotProject.index',{context,worldId,limit:1});
 const packageFiles={'pet.gd':Buffer.from('extends Node3D\n@export var entity_id: String = ""\n@export var saved_position_min := Vector3(-80, -80, -80)\n@export var saved_position_max := Vector3(80, 80, 80)\n'),'pet.gd.uid':Buffer.from('uid://bconfigurationpet\n')};
 if(legacy)packageFiles['pet.gd']=Buffer.from('extends Node3D\n@export var entity_id: String = ""\n');
 const content={assetId:legacy?'cw.module.pet-companion':'configurable-pet',version:legacy?2:3,kind:'object',files:Object.entries(packageFiles).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],entry:{entities:['pet'],...(!legacy?{positionValidation:declaration}:{}),sceneInstall:{mode:'script-node',script:'pet.gd',nodeType:'Node3D',identityField:'entity_id'}},interfaces:{},compatibility:{base:before.baseId,baseVersion:'1.0.0',engine:before.engineVersion},state:{},licenses:{}};
 const archive=packStaticPackage({root:{id:content.assetId,version:content.version},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files:packageFiles}]});
 const sourcePath=path.join(directory,'pet.zip');await fs.writeFile(sourcePath,archive);
 await call('asset.import',{operationId:'seed-configuration-pet',sourceRoot:directory,sourcePath,assetId:'fixture.configurable-pet',version:3,kind:'object',mediaKind:'package',path:'pet.zip',mediaType:'application/x-godot-package',displayName:'Configurable pet fixture',source:{origin:'fixture',author:'test',license:'CC0-1.0',licenseStatus:'verified'},tags:['fixture']});
 const asset=await call('asset.read',{assetId:'fixture.configurable-pet',version:3}),ref={assetId:asset.version_.assetId,version:3,contentHash:asset.version_.contentHash};
 const createService=()=>{
  const turns=createPackageTurnLifecycle({call});
  const installer=createManagedPackageInstaller({call,turns,stagingRoot:path.join(directory,'manual'),enqueue:async()=>assert.fail('No executor exists'),
   bind:createPackageInstallBinding({call,selected:async()=>worldId,finish:turns.finish,begin:({context,selectedWorld})=>call('workspace.open',{context,selectedWorld})})});
  const author=createAuthorSourceInstaller({call,authorize:async()=>({worldId,autoApply:true,authorization:'full-auto'}),selected:async()=>worldId,stagingRoot:path.join(directory,'author'),enqueue:async()=>assert.fail('No executor exists')});
  return createSourceLibraryService({call,directory:path.join(directory,'proposals'),installSource:installer,installSourceGroup:args=>installer.group(args),installAuthorSource:author});
 };
 return {call,calls,ref,before,createService,service:createService(),scene:stock?'scenes/creation.tscn':'world.tscn',restart:async()=>{await core.stop();core=new CoreClient(binary,path.join(directory,'data'));await core.start();}};
}
const tool=(f,args,id)=>f.service.tool(args,context,worldId,id);
for(const mode of ['install','install-group','propose','propose-group'])test(`real Core ${mode} freezes per-instance bounds through cold service/Core reopen`,{skip:!binary},async t=>{
 const f=await fixture(t),group=mode.endsWith('-group'),manual=mode.startsWith('propose');
 const first=bounds(f.before),second={...bounds(f.before),minimum:[-90,-2,-200],maximum:[90,50,90]};
 const args=group?{mode,items:[{ref:f.ref,position:{x:3,y:0,z:-4},positionBounds:first},{ref:f.ref,position:{x:-3,y:0,z:-4},positionBounds:second}]}:{mode,ref:f.ref,position:{x:3,y:0,z:-4},positionBounds:first};
 const beforeWorld=await f.call('world.read',{id:worldId});
 const proposed=await tool(f,args,'frozen-bounds');
 let result=proposed;
 if(manual){
  assert.equal(f.calls.some(c=>c.method==='godotProject.applyFiles'),false);
  assert.deepEqual(group?proposed.proposal.items[1].positionBounds:proposed.proposal.positionBounds,group?second:first);
  await f.restart();f.service=f.createService();
  result=await f.service.installProposal({worldId,proposalId:proposed.proposal.proposalId});
 }
 const after=await f.call('godotProject.index',{context,worldId,limit:32});assert.equal(after.revision,f.before.revision+1);
 const scene=await f.call('godotProject.read',{context,worldId,revision:after.revision,manifestHash:after.manifestHash,path:f.scene,offset:0,limit:16000});
 assert.match(scene.text,/existing-dog/);
 const nodes=parseScene(scene.text).nodes.filter(n=>n.properties.saved_position_min);
 assert.equal(nodes.length,group?2:1);assert.equal(new Set(nodes.map(n=>n.properties.entity_id)).size,nodes.length);
 assert.deepEqual(nodes.map(n=>n.properties.saved_position_min),group?['Vector3(-240, -20, -300)','Vector3(-90, -2, -200)']:['Vector3(-240, -20, -300)']);
 assert.deepEqual(nodes.map(n=>n.properties.saved_position_max),group?['Vector3(240, 160, 80)','Vector3(90, 50, 90)']:['Vector3(240, 160, 80)']);
 const receipt=manual?result:result.proposal.installation;
 assert.equal(receipt.sourceConfigurations.length,nodes.length);
 assert(receipt.sourceConfigurations.every(row=>row.origin==='explicit-source-bound'&&row.expectedSource.manifestHash===f.before.manifestHash));
 const job=await f.call('godotBuild.read',{worldId,jobId:manual?result.job.jobId:result.jobId});assert.equal(job.status,'blocked');assert.equal(job.sourceRevision,after.revision);
 await f.restart();f.service=f.createService();
 const replay=manual?await f.service.installProposal({worldId,proposalId:proposed.proposal.proposalId}):await tool(f,args,'frozen-bounds');
 assert.deepEqual(replay,result);assert.equal(f.calls.filter(c=>c.method==='godotProject.applyFiles').length,1);assert.equal(f.calls.filter(c=>c.method==='godotBuild.start').length,1);
 const afterWorld=await f.call('world.read',{id:worldId});assert.deepEqual(afterWorld.world.snapshot,beforeWorld.world.snapshot);
 assert.equal(afterWorld.revision,beforeWorld.revision,'source configuration must not write progress');
 const changed=structuredClone(args);if(group)changed.items[0].positionBounds.minimum[0]--;else changed.positionBounds.minimum[0]--;
 await assert.rejects(tool(f,changed,'frozen-bounds'),/SOURCE_LIBRARY_PROPOSAL_CONFLICT/);
});

test('unknown source is visible during search/read/direct inspection and cannot install silently', {skip:!binary},async t=>{
 const f=await fixture(t);
 const read=await tool(f,{mode:'read',ref:f.ref},'read'),search=await tool(f,{mode:'search',query:'Configurable'},'search');
 for(const hints of [read.targetCompatibility,search.result.items[0].targetCompatibility]){
  assert.equal(hints.sourcePrerequisitesStatus,'source-prerequisites-matched');assert.equal(hints.status,'configuration-required');assert.equal(hints.runtimeVerified,false);
  assert.match(hints.resources[0].configuration.instruction,/expectedSource/);assert.equal(hints.resources[0].configuration.positionBounds,undefined);
 }
 const inspection=await f.service.directInspect({worldId,ref:f.ref});assert.equal(inspection.eligible,false);assert.equal(inspection.reason,'DIRECT_LIBRARY_WORLD_CONFIGURATION_REQUIRED');
 for(const [mode,configured]of [['install',false],['install-group',false],['install',true],['propose',false],['propose-group',false]]){
  if(mode==='propose')await f.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
  const item={ref:f.ref,...(configured?{positionBounds:{...bounds(f.before),expectedSource:{revision:f.before.revision+1,manifestHash:f.before.manifestHash}}}:{})};
  const args=mode.endsWith('-group')?{mode,items:[item,item]}:{mode,...item},begin=f.calls.length;
  const run=async()=>{const result=await tool(f,args,mode+'-'+configured);return mode.startsWith('propose')?f.service.installProposal({worldId,proposalId:result.proposal.proposalId}):result;};
  await assert.rejects(run,configured?/PACKAGE_CONFIGURATION_SOURCE_CHANGED/:/PACKAGE_POSITION_BOUNDS_REQUIRED/);
  assert.equal(f.calls.slice(begin).some(c=>['package.planInstall','godotProject.applyFiles','godotBuild.start'].includes(c.method)),false);
 }
});

for(const stock of [true,'city'])test(`exact ${stock==='city'?'city':'sandbox'} source materializes bounds; later source edits invalidate the advisory plan`, {skip:!binary},async t=>{
 const f=await fixture(t,{stock});
 const read=await tool(f,{mode:'read',ref:f.ref},'read');assert.equal(read.targetCompatibility.resources[0].configuration.status,'configuration-planned');
 const inspection=await f.service.directInspect({worldId,ref:f.ref});assert.equal(inspection.eligible,true);
 const result=await tool(f,{mode:'install',ref:f.ref},'known-stock');
 assert.equal(result.proposal.installation.sourceConfigurations[0].origin,'exact-stock-source');
 const after=await f.call('godotProject.index',{context,worldId,limit:1});
 const scene=await f.call('godotProject.read',{context,worldId,revision:after.revision,manifestHash:after.manifestHash,path:f.scene,offset:0,limit:16000});
 if(stock==='city'){
  assert.match(scene.text,/saved_position_min = Vector3\(-240, -20, -300\)/);assert.match(scene.text,/saved_position_max = Vector3\(240, 160, 80\)/);
 }else{
  assert.match(scene.text,/saved_position_min = Vector3\(-32, 0, -32\)/);assert.match(scene.text,/saved_position_max = Vector3\(32, 32, 32\)/);
 }
 // The actual installation changes the main scene pin. It is no longer an exact stock source.
 const reread=await tool(f,{mode:'read',ref:f.ref},'reread');assert.equal(reread.targetCompatibility.resources[0].configuration.status,'configuration-required');
 const begin=f.calls.length;
 await assert.rejects(tool(f,{mode:'install',ref:f.ref,positionBounds:read.targetCompatibility.resources[0].configuration.positionBounds},'stale-pin'),/PACKAGE_CONFIGURATION_SOURCE_CHANGED/);
 assert.equal(f.calls.slice(begin).some(c=>['package.planInstall','godotProject.applyFiles','godotBuild.start'].includes(c.method)),false);
});

test('legacy contract keeps limited-area installation available with an advisory warning and no rewritten exports', {skip:!binary},async t=>{
 const f=await fixture(t,{legacy:true}),read=await tool(f,{mode:'read',ref:f.ref},'legacy-read');
 assert.equal(read.targetCompatibility.status,'source-prerequisites-matched','legacy warning is not a new mandatory configuration contract');
 assert.equal(read.targetCompatibility.resources[0].configuration.status,'legacy-range-unverified');
 const inspection=await f.service.directInspect({worldId,ref:f.ref});assert.equal(inspection.eligible,true);assert.equal(inspection.warning,'LEGACY_COMPANION_SAVE_BOUNDS');
 const result=await tool(f,{mode:'install',ref:f.ref},'legacy-install');
 assert.equal(result.proposal.installation.sourceConfigurations[0].warning.status,'legacy-range-unverified');
 const after=await f.call('godotProject.index',{context,worldId,limit:1});
 const scene=await f.call('godotProject.read',{context,worldId,revision:after.revision,manifestHash:after.manifestHash,path:f.scene,offset:0,limit:16000});
 assert.doesNotMatch(scene.text,/saved_position_(?:min|max)/);assert.match(scene.text,/existing-dog/);
 assert.equal(result.applied,false);
});
