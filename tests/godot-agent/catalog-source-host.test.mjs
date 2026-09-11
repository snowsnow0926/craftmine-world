import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {packStaticPackage,readZip,writeZip} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const {build}=createRequire(path.join(process.env.CRAFTMINE_DEPS_ROOT||path.join(root,'vendor/pi-desktop/packages/agent-runtime'),'package.json'))('esbuild');
const compiled=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-host-bundle-'));
test.after(async()=>{assert.equal(path.dirname(path.resolve(compiled)),path.resolve(os.tmpdir()));assert.ok(path.basename(compiled).startsWith('catalog-host-bundle-'));await fs.rm(compiled,{recursive:true,force:true});});
async function load(name){const outfile=path.join(compiled,name+'.mjs');await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/'+name+'.ts')],bundle:true,platform:'node',format:'esm',outfile});return import(pathToFileURL(outfile));}
const {createCraftminePackageService}=await load('craftmine-package-service'),{createCraftminePanelGateway}=await load('craftmine-panel-gateway');
const hash=v=>createHash('sha256').update(v).digest('hex');
const payload={'door.gd':Buffer.from('extends Node2D\n@export var entity_id: String = ""\n'),'door.gd.uid':Buffer.from('uid://btestdoor\n')};
const content={assetId:'door',version:1,kind:'object',files:Object.entries(payload).map(([path,b])=>({path,bytes:b.length,sha256:hash(b)})),dependencies:[],entry:{entities:['door'],sceneInstall:{mode:'script-node',script:'door.gd',nodeType:'Node2D',identityField:'entity_id'}},interfaces:{},compatibility:{},state:{},licenses:{}};
const archive=packStaticPackage({root:{id:'door',version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files:payload}]});
const ref={assetId:'catalog-door',version:1,contentHash:hash('separate immutable catalog identity')};
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-source-host-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('catalog-source-host-'));await fs.rm(dir,{recursive:true,force:true});});
 const download=path.join(dir,'download.zip'),blob=path.join(dir,'catalog-blob');await fs.writeFile(download,archive);await fs.copyFile(download,blob);await fs.unlink(download);
 const record={version_:{...ref,fileCount:1,bytes:archive.length,files:[{path:'source.zip',mediaType:'application/zip',bytes:archive.length,sha256:hash(archive)}]}};
 const state={world:'world',session:null,project:'/project',active:false,now:0,record,body:{assetId:ref.assetId,version:1,path:'source.zip',mediaType:'application/zip',bytes:archive.length,sha256:hash(archive),blobPath:blob},calls:[],on:async()=>{},receipt:value=>value};
 const sources={'project.godot':'[application]\nrun/main_scene="res://world.tscn"\n','world.tscn':'[gd_scene format=3]\n[node name="World" type="Node2D"]\n'};
 const core=async(method,args)=>{
  state.calls.push({method,args});await state.on(method);
  if(method==='godotProject.index')return{worldId:'world',revision:1,manifestHash:'a'.repeat(64),baseId:'top-down',engineVersion:'4.7.2-stable',files:Object.entries(sources).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:hash(text)})),nextOffset:null};
  if(method==='godotProject.read')return{sha256:hash(sources[args.path]),text:sources[args.path],nextOffset:null};
  if(method==='package.planInstall')return{ok:true,applied:false,operationId:args.operationId,worldId:'world',instances:[{instanceId:'ins-door',assetId:'door',version:1,contentHash:contentHash(content),installPath:'addons/door',entityMap:{door:'ins-door-e0'},localOverrides:[]}],lock:{format:'craftmine.assets-lock/1',assets:[{asset:{assetId:'door',version:'1',contentHash:contentHash(content)},installPath:'addons/door',files:content.files.map(f=>({...f,mediaType:'text/plain'})),dependencies:[],overrides:[]}]}};
  if(method==='godotProject.applyFiles')return{revision:2,manifestHash:'b'.repeat(64),commitOid:'c'.repeat(40),assetLockHash:'d'.repeat(64)};
  if(method==='godotBuild.start')return{worldId:'world',jobId:'gjob-'+'e'.repeat(64),status:'queued'};
  throw Error('unexpected:'+method);
 };
 let service,installer;
 const reset=()=>{
  installer=createManagedPackageInstaller({call:core,stagingRoot:path.join(dir,'existing-installer-store'),bind:async(worldId,operationId)=>({context:{projectId:'fixture',sessionId:'fixture',turnId:'fixture'},operation:{worldId,operationId},worldRecord:{id:worldId,world:{snapshot:{baseVersion:'1.0.0',format:'craftmine.godot-progress/1'}}}}),enqueue:async()=>{}});
  service=createCraftminePackageService({selection:()=>state.world,now:()=>state.now,pickFile:async()=>{throw Error('picker forbidden');},domainCall:async(method,args)=>{
   state.calls.push({method,args});await state.on(method);
   if(method==='asset.request'){assert.deepEqual(args,{method:'read',args:{assetId:ref.assetId,version:1}});return structuredClone(state.record);}
   if(method==='asset.bodyPath')return structuredClone(state.body);
   if(method==='package.request'){assert.equal(args.method,'installSource');const result=await installer(args.args);await state.on('after-install');return state.receipt(result);}
   throw Error('unexpected:'+method);
  }});
 };
 reset();
 const gateway=createCraftminePanelGateway({viewingSession:()=>state.session,session:async id=>{await state.on('session');return{id,projectPath:state.project};},activeTurn:()=>state.active?'active':undefined,domain:async(method)=>{assert.equal(method,'selection.read');await state.on('selection');return{worldId:state.world};},packages:(channel,args,owner)=>service.request(channel,args,owner),begin:async()=>{throw Error('no model turn');},end:async()=>{},stop:async()=>{},resume:async()=>{},interrupt:async()=>{},backup:async()=>{},diagnostics:async()=>{}});
 const call=(operationId='catalog-operation',patch={})=>gateway('package.request',{worldId:'world',method:'importCatalogSource',params:{worldId:'world',operationId,ref:{...ref},...patch}});
 const count=method=>state.calls.filter(c=>c.method===method).length;
 return{dir,blob,state,call,count,reset,service:()=>service,installer:()=>installer};
}

test('catalog blob installs after download deletion and exact cold replay never rewrites source or creates another job',async t=>{
 const f=await fixture(t),first=await f.call();assert.equal(first.applied,false);assert.deepEqual(first.catalogRef,ref);assert.notEqual(first.archiveSha256,ref.contentHash);assert.notEqual(first.archiveSha256,contentHash(content));
 assert.equal(f.count('godotProject.applyFiles'),1);assert.equal(f.count('godotBuild.start'),1);
 assert.equal(JSON.stringify(first).includes(f.dir),false);assert.equal(JSON.stringify(first).includes('archiveBase64'),false);assert.equal(JSON.stringify(first).includes('context'),false);
 assert.deepEqual(await f.call(),first);f.service().dispose();f.reset();assert.deepEqual(await f.call(),first);
 assert.equal(f.count('godotProject.applyFiles'),1);assert.equal(f.count('godotBuild.start'),1);
 const files=await fs.readdir(path.join(f.dir,'existing-installer-store'));const intent=JSON.parse(await fs.readFile(path.join(f.dir,'existing-installer-store',files[0],'intent.json'),'utf8'));
 assert.deepEqual(intent.hostProvenance,{format:'craftmine.catalog-source-install/1',ref,archiveSha256:hash(archive),owner:{projectId:'world-world',sessionId:null,worldId:'world'}});
});

test('durable operation rejects changed catalog identity or owner even for the exact same ZIP bytes',async t=>{
 const f=await fixture(t);await f.call();f.reset();f.state.record.version_.contentHash=hash('different catalog identity');
 await assert.rejects(f.call('catalog-operation',{ref:{...ref,contentHash:f.state.record.version_.contentHash}}),/PACKAGE_OPERATION_CONFLICT/);
 f.reset();f.state.record.version_.contentHash=ref.contentHash;f.state.session='another-session';
 await assert.rejects(f.call(),/PACKAGE_OPERATION_CONFLICT/);assert.equal(f.count('godotProject.applyFiles'),1);assert.equal(f.count('godotBuild.start'),1);
 f.state.session=null;f.reset();assert.equal((await f.call()).status,'check-queued');
});

test('lost committed receipt and changed UI owner preserve the original operation for original-owner recovery',async t=>{
 for(const failure of ['lost','owner']){
  const f=await fixture(t);let once=true;f.state.on=async stage=>{if(stage==='after-install'&&once){once=false;if(failure==='lost')throw Error('TRANSPORT_LOST');f.state.session='other';}};
  await assert.rejects(f.call(),failure==='lost'?/TRANSPORT_LOST/:/PACKAGE_OWNER_CHANGED/);
  f.state.session=null;f.state.on=async()=>{};f.reset();const recovered=await f.call();assert.equal(recovered.status,'check-queued');assert.equal(f.count('godotProject.applyFiles'),1);assert.equal(f.count('godotBuild.start'),1);
 }
});

test('catalog metadata, body identity, MIME, size and actual ZIP digest are checked before any installer call',async t=>{
 for(const change of [s=>s.record.version_.contentHash='f'.repeat(64),s=>s.record.version_.assetId='other',s=>s.record.version_.version=2,s=>s.record.version_.files.push(s.record.version_.files[0]),s=>s.record.version_.fileCount=2,s=>s.record.version_.bytes++,s=>s.record.version_.files[0].mediaType='text/plain',s=>s.body.assetId='other',s=>s.body.version=2,s=>s.body.path='other.zip',s=>s.body.mediaType='image/png',s=>s.body.bytes++,s=>s.body.sha256='f'.repeat(64)]){
  const f=await fixture(t);change(f.state);await assert.rejects(f.call(),/PACKAGE_CATALOG_/);assert.equal(f.count('package.request'),0);
 }
 const f=await fixture(t);await fs.writeFile(f.blob,'changed');await assert.rejects(f.call(),/PACKAGE_CATALOG_BLOB_MISMATCH/);assert.equal(f.count('package.request'),0);
});

test('inner resource hash remains the original CP0/CP1 check even with correctly verified outer catalog and ZIP hashes',async t=>{
 const f=await fixture(t),entries=readZip(archive).entries.map(e=>({name:e.name,bytes:e.bytes})),entry=entries.find(e=>e.name==='package.json');const json=JSON.parse(entry.bytes);json.resources[0].contentHash='f'.repeat(64);entry.bytes=Buffer.from(JSON.stringify(json));const bad=writeZip(entries,{compress:false});
 await fs.writeFile(f.blob,bad);f.state.record.version_.bytes=bad.length;Object.assign(f.state.record.version_.files[0],{bytes:bad.length,sha256:hash(bad)});Object.assign(f.state.body,{bytes:bad.length,sha256:hash(bad)});
 await assert.rejects(f.call(),/RESOURCE_CONTENT_HASH_MISMATCH/);assert.equal(f.count('godotProject.applyFiles'),0);
});

test('gateway rechecks owner, selected world, project and active turn across catalog awaits',async t=>{
 for(const [stage,change,expected]of [['asset.request',s=>s.world='other',/PACKAGE_OWNER_CHANGED/],['asset.bodyPath',s=>s.session='other',/PACKAGE_OWNER_CHANGED/],['asset.request',s=>s.active=true,/ACTIVE_TASK_EXISTS/],['asset.bodyPath',s=>s.project='/other',/PACKAGE_OWNER_CHANGED/]]){
  const f=await fixture(t);f.state.session='session';f.state.on=async name=>{if(name===stage)change(f.state);};await assert.rejects(f.call(),expected);assert.equal(f.count('package.request'),0);
 }
 const f=await fixture(t);f.state.session='session';f.state.active=true;await assert.rejects(f.call(),/ACTIVE_TASK_EXISTS/);assert.equal(f.count('asset.request'),0);
});

test('caller cannot inject path, bytes, owner or provenance; explicit retries renew verified catalog grants only',async t=>{
 const f=await fixture(t);
 for(const patch of [{blobPath:f.blob},{archiveBase64:archive.toString('base64')},{owner:{}},{hostProvenance:{}},{context:{}},{ref:{...ref,version:'latest'}}])await assert.rejects(f.call('invalid-operation',patch),/INVALID_PARAMS|PACKAGE_CATALOG_REF_INVALID/);
 await assert.rejects(f.service().request('package.request',{worldId:'world',method:'importCatalogSource',params:{worldId:'world',operationId:'no-owner-op',ref}}),/PACKAGE_HOST_OWNER_REQUIRED/);
 const first=await f.call();await assert.rejects(f.service().request('package.request',{worldId:'world',method:'repeatImportSource',params:{worldId:'world',operationId:'method-conflict',grantId:first.grantId}}),/PACKAGE_GRANT_METHOD_MISMATCH/);
 const g=await fixture(t);g.state.on=async stage=>{if(stage==='package.request')throw Error('TRANSPORT_LOST');};await assert.rejects(g.call(),/TRANSPORT_LOST/);g.state.now=700000;g.state.on=async()=>{};assert.equal((await g.call()).status,'check-queued');assert.equal(g.count('asset.request'),2);assert.equal(g.count('asset.bodyPath'),2);
});

test('concurrent same operation coalesces, while changed ref is rejected before another import',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([f.call(),f.call()]);assert.deepEqual(a,b);assert.equal(f.count('package.request'),1);
 await assert.rejects(f.call('catalog-operation',{ref:{...ref,contentHash:'f'.repeat(64)}}),/PACKAGE_OPERATION_CONFLICT/);assert.equal(f.count('package.request'),1);
});

test('provenance reservation survives a failure before source planning and cannot be reclaimed by another owner',async t=>{
 const f=await fixture(t);f.state.on=async stage=>{if(stage==='godotProject.index')throw Error('TRANSPORT_LOST');};
 await assert.rejects(f.call(),/TRANSPORT_LOST/);assert.equal(f.count('godotProject.applyFiles'),0);
 f.reset();f.state.on=async()=>{};f.state.session='other';await assert.rejects(f.call(),/PACKAGE_OPERATION_CONFLICT/);
 f.reset();f.state.session=null;assert.equal((await f.call()).status,'check-queued');assert.equal(f.count('godotProject.applyFiles'),1);
});

test('catalog blobs cannot use linked paths or grow beyond the bounded ZIP grant',async t=>{
 const f=await fixture(t),target=path.join(f.dir,'target'),link=path.join(f.dir,'link');await fs.mkdir(target);await fs.writeFile(path.join(target,'blob'),archive);await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');f.state.body.blobPath=path.join(link,'blob');
 await assert.rejects(f.call(),/PACKAGE_LINK_DENIED/);assert.equal(f.count('package.request'),0);
 const g=await fixture(t),file=await fs.open(g.blob,'w');await file.truncate(5*1024*1024+1);await file.close();await assert.rejects(g.call(),/PACKAGE_ARCHIVE_TOO_LARGE/);assert.equal(g.count('package.request'),0);
});

test('installer rejects malformed private provenance before creating a durable intent',async t=>{
 const f=await fixture(t);const good={format:'craftmine.catalog-source-install/1',ref,archiveSha256:hash(archive),owner:{projectId:'world-world',sessionId:null,worldId:'world'}};
 for(const mutate of [p=>p.archiveSha256='f'.repeat(64),p=>p.owner.worldId='other',p=>p.owner.context={},p=>p.ref.version='latest',p=>p.ref.contentHash=hash(archive).toUpperCase(),p=>p.ref.assetId='*',p=>p.grantId='injected']){
  const hostProvenance=structuredClone(good);mutate(hostProvenance);await assert.rejects(f.installer()({worldId:'world',operationId:'invalid-provenance',archiveBase64:archive.toString('base64'),hostProvenance}),/PACKAGE_CATALOG_PROVENANCE_INVALID|UNKNOWN_FIELD/);
 }
 assert.equal(f.count('godotProject.index'),0);
});

test('private malformed or path-bearing receipts cannot be projected as catalog success',async t=>{
 for(const mutate of [r=>r.archiveSha256='f'.repeat(64),r=>r.source.commitOid='/private/path',r=>r.source.assetLockHash={path:'/private'},r=>r.job.status={private:'source'},r=>r.job.error={code:'/private/path'},r=>r.instanceIds=['/private/path'],r=>r.worldId='other',r=>r.applied=true]){
  const f=await fixture(t);f.state.receipt=value=>{const result=structuredClone(value);mutate(result);return result;};await assert.rejects(f.call(),/PACKAGE_INSTALL_RECEIPT_INVALID/);
  f.state.receipt=value=>value;f.reset();assert.equal((await f.call()).status,'check-queued');assert.equal(f.count('godotProject.applyFiles'),1);
 }
 const f=await fixture(t);await assert.rejects(f.service().request('package.request',{worldId:'world',method:'installSource',params:{worldId:'world',operationId:'raw-private-call',archiveBase64:archive.toString('base64'),hostProvenance:{}}}),/UNKNOWN_PACKAGE_METHOD/);assert.equal(f.count('package.request'),0);
});

test('lost committed response followed by grant expiry recovers the durable receipt without duplicate source or job',async t=>{
 const f=await fixture(t);let once=true;f.state.on=async stage=>{if(stage==='after-install'&&once){once=false;throw Error('TRANSPORT_LOST');}};
 await assert.rejects(f.call(),/TRANSPORT_LOST/);assert.equal(f.count('godotProject.applyFiles'),1);f.state.now=700000;
 const recovered=await f.call();assert.equal(recovered.status,'check-queued');assert.equal(f.count('asset.request'),2);assert.equal(f.count('asset.bodyPath'),2);assert.equal(f.count('godotProject.applyFiles'),1);assert.equal(f.count('godotBuild.start'),1);
 f.reset();assert.deepEqual(await f.call(),recovered);assert.equal(f.count('godotProject.applyFiles'),1);
});

test('expired uncertain operations revalidate changed catalog or blob and never infer that earlier source was unwritten',async t=>{
 for(const kind of ['catalog','blob','replaced-zip']){
  const f=await fixture(t);f.state.on=async stage=>{if(stage==='after-install')throw Error('TRANSPORT_LOST');};await assert.rejects(f.call(),/TRANSPORT_LOST/);f.state.on=async()=>{};f.state.now=700000;
  if(kind==='catalog')f.state.record.version_.contentHash='f'.repeat(64);
  else if(kind==='blob')await fs.writeFile(f.blob,'corrupt');
  else {const changed=Buffer.concat([archive,Buffer.from('changed')]);await fs.writeFile(f.blob,changed);f.state.record.version_.bytes=changed.length;Object.assign(f.state.record.version_.files[0],{bytes:changed.length,sha256:hash(changed)});Object.assign(f.state.body,{bytes:changed.length,sha256:hash(changed)});}
  await assert.rejects(f.call(),kind==='catalog'?/PACKAGE_CATALOG_IDENTITY_MISMATCH/:kind==='blob'?/PACKAGE_CATALOG_BLOB_MISMATCH/:/PACKAGE_OPERATION_CONFLICT/);
  assert.equal(f.count('godotProject.applyFiles'),1);assert.equal(f.count('godotBuild.start'),1);assert.equal(f.count('package.request'),1);
 }
});

test('grant that expires during final owner recheck cannot be dispatched and needs a fresh explicit retry',async t=>{
 const f=await fixture(t);let checks=0;
 const owner={projectId:'world-world',sessionId:null,worldId:'world',assertCurrent:async()=>{if(++checks===5)f.state.now=700000;}};
 const request=()=>f.service().request('package.request',{worldId:'world',method:'importCatalogSource',params:{worldId:'world',operationId:'cross-await-expiry',ref}},owner);
 await assert.rejects(request(),/PACKAGE_GRANT_EXPIRED/);assert.equal(f.count('package.request'),0);
 assert.equal((await request()).status,'check-queued');assert.equal(f.count('asset.request'),2);assert.equal(f.count('godotProject.applyFiles'),1);
});
