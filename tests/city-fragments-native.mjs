// Real catalog + six managed source transactions + Core restart, no model/UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller} from '../plugins/craftmine-world/reuse-service.mjs';
import {createSourceLibraryService} from '../plugins/craftmine-world/source-library-service.cjs';
import {buildCityFragmentPackages} from '../desktop/build-city-fragment-packages.mjs';
const binary=process.argv[2];assert.ok(binary&&path.isAbsolute(binary));const root=path.resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(path.join(root,'test-results'),{recursive:true});const out=await fs.mkdtemp(path.join(root,'test-results/city-fragments-native-')),staging=path.join(out,'catalog');await fs.mkdir(staging);
const core=new CoreClient(binary,path.join(out,'data')),context={projectId:'city-fragments',sessionId:'city-fragments',turnId:'one'},worldId='city-fragment-reuse';
const report={format:'craftmine.city-fragment-native/1',out,modelCalls:0,uiLaunches:0,engineLaunches:0,installs:[],ok:false};
try{
 await core.start();const call=(method,args)=>core.call(method,args,120000);
 await call('world.create',{id:worldId,title:'Existing world plus city fragments',world:{build:{id:'base-city-fragments',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});await call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'base-city-fragments',baseId:'creation-sandbox',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:'[gd_scene format=3]\n[node name="ExistingWorld" type="Node3D"]\n[node name="ExistingPlayerContent" type="Node3D" parent="."]\nposition = Vector3(0, 0, -70)\n'}]});await call('content.migrate.apply',{worldId});
 const original=await call('world.read',{id:worldId}),bind=async(worldId,operationId)=>{const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),index=await call('godotProject.index',{context,worldId,offset:0,limit:1});return {context,worldRecord,operation:{worldId,operationId,repoId:status.repoId,branchId:index.branchId,expectedHeadOid:status.branches.find(b=>b.name==='refs/heads/'+index.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};};
 const install=createManagedPackageInstaller({call,bind,stagingRoot:path.join(out,'installs'),enqueue:async()=>{throw Error('No executor registered in source transaction preflight');}}),library=createSourceLibraryService({call,installSource:install,directory:path.join(out,'proposals')});
 const packages=buildCityFragmentPackages({repository:root});
 for(const [index,pkg]of packages.entries()){
  const entry=pkg.entry,filename=path.join(staging,pkg.file);await fs.writeFile(filename,pkg.bytes);
  const imported=await call('asset.import',{operationId:'seed-'+index,sourceRoot:staging,sourcePath:filename,assetId:entry.assetId,version:1,kind:entry.kind,mediaKind:'package',path:pkg.file,mediaType:'application/x-godot-package',displayName:entry.label,source:entry.source,tags:entry.tags});
  const ref={assetId:entry.assetId,version:1,contentHash:imported.contentHash};
  const read=await library.tool({mode:'read',ref},context,worldId,'read-'+index);assert.deepEqual(read.resources[0].entry.sourceRequirements,[]);assert.equal(read.source.licenseStatus,'unverified');
  for(const copy of [0,1]){
   const position={x:copy?35:-35,y:0,z:(index-1)*45},proposal=await library.tool({mode:'propose',ref,position},context,worldId,'install-'+index+'-'+copy);
   const result=await library.installProposal({worldId,proposalId:proposal.proposal.proposalId});assert.equal(result.status,'source-saved-check-blocked');report.installs.push({assetId:entry.assetId,position,...result});
  }
 }
 const search=await library.tool({mode:'search',query:'奥格瑞玛建筑'},context,worldId,'search');assert.ok(search.result.items.some(item=>item.assetId==='cw.city.ward-building'));
 const ids=report.installs.flatMap(item=>item.instanceIds);assert.equal(new Set(ids).size,6);
 const before=await call('godotProject.index',{context,worldId,offset:0,limit:32}),readArgs={context,worldId,revision:before.revision,manifestHash:before.manifestHash,path:'world.tscn',offset:0,limit:16000};
 const scene=await call('godotProject.read',readArgs);assert.match(scene.text,/ExistingPlayerContent/);assert.match(scene.text,/position = Vector3\(0, 0, -70\)/);assert.deepEqual(await call('world.read',{id:worldId}),original);
 await core.stop();await core.start();const after=await call('godotProject.index',{context,worldId,offset:0,limit:32});assert.deepEqual(after,before);assert.deepEqual(await call('godotProject.read',readArgs),scene);assert.deepEqual(await call('world.read',{id:worldId}),original);
 Object.assign(report,{ok:true,coreSha256:sha(await fs.readFile(binary)),independentInstances:ids,source:before,sourceSurvivedNativeRestart:true,formalWorldPreserved:true,limit:'Source revisions and catalog are durable. No executor is registered; checks are genuinely blocked. Independent headless engine geometry/traversal evidence is separate; this report does not claim formal adoption or player save/reopen.'});
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,ok:report.ok,error:report.error?.split('\n')[0]}));}
