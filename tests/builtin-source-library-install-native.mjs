// Exercise every actually built package through the real Rust-backed installer.
// This is source-transaction preflight: no engine executor, model or UI is started.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {loadBuiltinPackages} from '../plugins/craftmine-world/builtin-source-library.cjs';
import {createManagedPackageInstaller} from '../plugins/craftmine-world/reuse-service.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {parseScene} from '../desktop/godot/shared/scene_materializer.mjs';

const [binary,directory]=process.argv.slice(2);assert.ok([binary,directory].every(value=>value&&path.isAbsolute(value)),'Pass absolute core executable and built source library directory');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),inventory=loadBuiltinPackages(directory);assert.ok(inventory.entries.length>=17&&inventory.entries.length<=64,'Expected shipped objects and environment, with optional composed scenes');
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/builtin-install-')),core=new CoreClient(binary,path.join(out,'data'));
const worldId='builtin-install-world',context={projectId:'builtin-project',sessionId:'builtin-session',turnId:'builtin-turn'};
const report={format:'craftmine.builtin-library-install-preflight/1',out,binary,coreSha256:sha(fs.readFileSync(binary)),directory,catalogSha256:sha(fs.readFileSync(path.join(directory,'catalog.json'))),modelCalls:0,engineLaunches:0,uiLaunches:0,installations:[],ok:false};
let current;
try{
 await core.start();const call=async(method,args)=>{try{return await core.call(method,args,120000);}catch(error){error.message=method+': '+error.message;throw error;}};
 await call('world.create',{id:worldId,title:'Built source package installation preflight',world:{build:{id:'base-builtin',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});
 const standard=fs.readFileSync('desktop/godot/bases/creation-sandbox/scripts/creation_world.gd','utf8');
 await call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'base-builtin',baseId:'creation-sandbox',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'},{path:'scripts/creation_world.gd',text:standard}]});
 await call('content.migrate.apply',{worldId});
 const originalWorld=await call('world.read',{id:worldId});
 const installer=createManagedPackageInstaller({call,stagingRoot:path.join(out,'installs'),enqueue:async()=>{throw Error('No engine executor is registered in source preflight');},bind:async(worldId,operationId)=>{
  const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),index=await call('godotProject.index',{context,worldId,offset:0,limit:1});
  return {context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:index.branchId,expectedHeadOid:status.branches.find(branch=>branch.name==='refs/heads/'+index.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
 }});
 async function readFile(file,source=current.source){
  const chunks=[];let offset=0;do{const part=await call('godotProject.read',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,path:file,offset,limit:16000});chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text));offset=part.nextOffset;}while(offset!=null);return Buffer.concat(chunks);
 }
 const expected=new Map(),seenIds=new Set();
 const operations=[...inventory.entries,inventory.entries[0]];
 for(const [index,entry] of operations.entries()){
  const archiveBytes=fs.readFileSync(entry.filename);assert.equal(sha(archiveBytes),entry.sha256);
  const archive=unpackStaticPackage(archiveBytes),resource=archive.resources.find(item=>item.manifest.content.assetId===entry.assetId);assert.ok(resource);
  const spec=resource.manifest.content.entry.sceneInstall;assert.ok(['instance','script-node'].includes(spec.mode));
  for(const item of archive.resources){
   for(const file of item.manifest.content.files){const name='addons/'+item.manifest.content.assetId+'/'+file.path;if(expected.has(name))assert.equal(expected.get(name).sha256,file.sha256);expected.set(name,file);}
   for(const file of item.manifest.content.files.filter(file=>file.path.endsWith('.gd')))assert.ok(item.files.has(file.path+'.uid'),'Missing script UID in actual ZIP: '+entry.assetId);
  }
  const position={x:index*3+0.5,y:0,z:-5};
  current=await installer({worldId,operationId:'install-'+index,archiveBase64:archiveBytes.toString('base64'),position});
  assert.equal(current.status,'source-saved-check-blocked');assert.equal(current.applied,false);assert.equal(current.worldId,worldId);
  assert.equal(current.instanceIds.length,1);const id=current.instanceIds[0];assert.ok(!seenIds.has(id));seenIds.add(id);
  const scene=parseScene((await readFile('world.tscn')).toString()),nodes=scene.nodes.filter(node=>node.properties.entity_id?.includes(id));assert.equal(nodes.length,1);
  assert.equal(nodes[0].properties.position,`Vector3(${position.x}, ${position.y}, ${position.z})`,'Explicit placement lost for '+entry.assetId);
  const map=JSON.parse((await readFile('craftmine.instances.json')).toString());assert.equal(map.instances.length,index+1);
  report.installations.push({assetId:entry.assetId,version:entry.version,archiveSha256:entry.sha256,mode:spec.mode,position,instanceId:id,source:current.source,checkStatus:current.job.status});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({installed:index+1,assetId:entry.assetId,status:current.status}));
 }
 const uids=new Map();
 for(const [name,file] of expected){const bytes=await readFile(name);assert.equal(bytes.length,file.bytes,name);assert.equal(sha(bytes),file.sha256,name);if(name.endsWith('.gd.uid')){const uid=bytes.toString().trim();assert.ok(!uids.has(uid),'Cross-package duplicate script UID: '+name+' / '+uids.get(uid));uids.set(uid,name);}}
 assert.equal(sha(await readFile('scripts/creation_world.gd')),sha(Buffer.from(standard)),'Standard environment source requirement changed');
 const lock=JSON.parse((await readFile('craftmine.assets.lock.json')).toString());assert.equal(lock.assets.length,inventory.entries.length);
 assert.deepEqual(await call('world.read',{id:worldId}),originalWorld,'Source installation must not silently adopt or change player progress');
 report.filesVerified=expected.size;report.distinctScriptUids=uids.size;report.lockAssets=lock.assets.length;report.repeatedPackageNewIdentity=true;report.finalSource=current.source;report.ok=true;
 report.limit='All built ZIPs reached real package plan + source transaction. Check is blocked because no executor is registered; this is not engine, runtime or visual acceptance.';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,installed:report.installations.length,report:path.join(out,'report.json'),error:report.error?.split('\n')[0]}));}
