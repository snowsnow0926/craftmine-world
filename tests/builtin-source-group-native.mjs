// Real shipped ZIPs and Rust core only: no executor, product UI or model.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {loadBuiltinPackages} from '../plugins/craftmine-world/builtin-source-library.cjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {createManagedPackageInstaller} from '../plugins/craftmine-world/reuse-service.mjs';
import {parseScene} from '../desktop/godot/shared/scene_materializer.mjs';

const [packagedRoot]=process.argv.slice(2);assert.ok(packagedRoot&&path.isAbsolute(packagedRoot),'Pass an absolute immutable win-unpacked directory');
const resources=path.join(packagedRoot,'resources'),binary=path.join(resources,'bin/craftmine-core.exe'),directory=path.join(resources,'plugins/craftmine.world/builtin-source-library'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inventory=loadBuiltinPackages(directory),standard=fs.readFileSync(path.join(resources,'godot/bases/creation-sandbox/scripts/creation_world.gd'));
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/builtin-group-')),core=new CoreClient(binary,path.join(out,'data'));
const report={format:'craftmine.builtin-source-group-preflight/1',packagedRoot,out,coreSha256:sha(fs.readFileSync(binary)),catalogSha256:sha(fs.readFileSync(path.join(directory,'catalog.json'))),standardSourceSha256:sha(standard),modelCalls:0,engineLaunches:0,uiLaunches:0,groups:[],ok:false};
const calls=[],worldId='builtin-group-world',context={projectId:'builtin-group-project',sessionId:'builtin-group-session',turnId:'builtin-group-turn'};
const call=async(method,args)=>{calls.push(method);return core.call(method,args,120000);};
const index=()=>call('godotProject.index',{context,worldId,offset:0,limit:1});
async function read(file,source){const chunks=[];let offset=0;do{const part=await call('godotProject.read',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,path:file,offset,limit:16000});chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text));offset=part.nextOffset;}while(offset!=null);return Buffer.concat(chunks);}
try{
 await core.start();
 await call('world.create',{id:worldId,title:'Frozen builtin grouped source preflight',world:{build:{id:'builtin-group-base',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});
 await call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'builtin-group-base',baseId:'creation-sandbox',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'},{path:'scripts/creation_world.gd',text:standard.toString('utf8')}]});
 await call('content.migrate.apply',{worldId});const originalWorld=await call('world.read',{id:worldId});report.worldBeforeSha256=sha(JSON.stringify(originalWorld));
 const installer=createManagedPackageInstaller({call,stagingRoot:path.join(out,'installs'),enqueue:async()=>{throw Error('No executor allowed in source preflight');},bind:async(worldId,operationId)=>{
  const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),source=await index();return {context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:source.branchId,expectedHeadOid:status.branches.find(b=>b.name==='refs/heads/'+source.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
 }});
 const batches=[[
  ['cw.environment.natural-daylight',null],['cw.scene.forest-gateway',{x:0,y:0,z:-8}],['cw.nature.tree-oak',{x:-6,y:0,z:-5}],['cw.nature.tree-oak',{x:6,y:0,z:-5}],
 ],[['cw.castle.wall',{x:8,y:0,z:-10}],['cw.castle.tower-base',{x:11,y:0,z:-10}]]];
 const expectedFiles=new Map(),expectedInstances=new Map();let previousMap=[];
 for(const [batch,definitions]of batches.entries()){
  const items=definitions.map(([assetId,position])=>{const entry=inventory.entries.find(e=>e.assetId===assetId);assert.ok(entry,'Missing frozen package '+assetId);const bytes=fs.readFileSync(entry.filename),archive=unpackStaticPackage(bytes);assert.equal(sha(bytes),entry.sha256);
   for(const resource of archive.resources)for(const file of resource.manifest.content.files){const filePath='addons/'+resource.manifest.content.assetId+'/'+file.path;if(expectedFiles.has(filePath))assert.equal(expectedFiles.get(filePath).sha256,file.sha256);expectedFiles.set(filePath,file);}
   return {archiveBase64:bytes.toString('base64'),...(position?{position}:{})};
  });
  const before=await index(),counts=calls.length,result=await installer.group({worldId,operationId:'builtin-group-'+batch,expectedSource:{revision:before.revision,manifestHash:before.manifestHash},items});
  assert.equal(result.status,'source-saved-check-blocked');assert.equal(result.job.status,'blocked');assert.equal(result.applied,false);assert.equal(result.source.revision,before.revision+1);
  const groupCalls=calls.slice(counts);assert.equal(groupCalls.filter(m=>m==='godotProject.applyFiles').length,1);assert.equal(groupCalls.filter(m=>m==='godotBuild.start').length,1);assert.deepEqual(result.archives.flatMap(a=>a.instanceIds),result.instanceIds);
  const scene=parseScene((await read('world.tscn',result.source)).toString()),map=JSON.parse((await read('craftmine.instances.json',result.source)).toString());
  for(const old of previousMap)assert.deepEqual(map.instances.find(i=>i.instanceId===old.instanceId),old,'Previous instance changed');
  for(const [i,[assetId,position]]of definitions.entries()){
   assert.equal(result.archives[i].archiveSha256,inventory.entries.find(e=>e.assetId===assetId).sha256);assert.equal(result.archives[i].instanceIds.length,1);const instanceId=result.archives[i].instanceIds[0];assert.ok(!expectedInstances.has(instanceId));expectedInstances.set(instanceId,{assetId,position});
  }
  for(const [instanceId,{assetId,position}]of expectedInstances){const instance=map.instances.find(i=>i.instanceId===instanceId);assert.equal(instance.assetId,assetId);const node=scene.nodes.filter(n=>Object.values(instance.entityMap).some(id=>n.properties.entity_id===JSON.stringify(id)));assert.equal(node.length,1);if(position)assert.equal(node[0].properties.position,`Vector3(${position.x}, ${position.y}, ${position.z})`);}
  assert.equal(map.instances.length,expectedInstances.size);previousMap=map.instances;
  const uidOwners=new Map();for(const [file,meta]of expectedFiles){const bytes=await read(file,result.source);assert.equal(bytes.length,meta.bytes,file);assert.equal(sha(bytes),meta.sha256,file);const uid=file.endsWith('.uid')?bytes.toString().trim():/\.(tscn|tres)$/.test(file)?/^\[(?:gd_scene|gd_resource)\b[^\r\n]*\buid="(uid:\/\/[^"]+)"/m.exec(bytes.toString())?.[1]:null;if(uid){assert.ok(!uidOwners.has(uid)||uidOwners.get(uid)===file,'Duplicate UID '+uid);uidOwners.set(uid,file);}}
  const lock=JSON.parse((await read('craftmine.assets.lock.json',result.source)).toString());assert.equal(lock.assets.length,new Set([...expectedInstances.values()].map(i=>i.assetId)).size);
  assert.equal(sha(await read('scripts/creation_world.gd',result.source)),sha(standard));assert.deepEqual(await call('world.read',{id:worldId}),originalWorld);
  report.groups.push({items:definitions.map(([assetId,position],i)=>({assetId,position,archiveSha256:result.archives[i].archiveSha256,instanceIds:result.archives[i].instanceIds})),source:result.source,job:result.job,applyFilesCalls:1,checkStartCalls:1,filesVerified:expectedFiles.size,uidOwners:uidOwners.size,lockAssets:lock.assets.length,totalInstances:map.instances.length,previousInstancesUnchanged:true,worldProgressUnchanged:true});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({group:batch+1,instances:map.instances.length,status:result.status}));
 }
 report.worldAfterSha256=sha(JSON.stringify(await call('world.read',{id:worldId})));assert.equal(report.worldAfterSha256,report.worldBeforeSha256);report.ok=true;report.limit='Real frozen ZIPs reached Rust planning and atomic source transactions. No executor: checks are blocked, not engine/visual acceptance. Minimal creation-sandbox fixture includes frozen exact base source; no player profile opened.';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,report:path.join(out,'report.json'),error:report.error?.split('\n')[0]}));}
