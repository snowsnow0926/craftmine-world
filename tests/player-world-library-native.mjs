// Native catalog/source boundary test in a private restored domain; no model or UI input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire,register} from 'node:module';
const require=createRequire(import.meta.url),{CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const {createPlayerWorldLibrary,validateArchive}=require('../plugins/craftmine-world/player-world-library.cjs');
const {createSourceLibraryService}=require('../plugins/craftmine-world/source-library-service.cjs');
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldFactory}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts');
const {initializationFileBatches}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts');
const {writeZip,readZip}=await import('../plugins/craftmine-world/package-zip.mjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),root=path.resolve(import.meta.dirname,'..');
const binary=process.env.CRAFTMINE_CORE_BINARY,archivePath=process.env.CRAFTMINE_TEST_WORLD_ARCHIVE;
assert.ok(binary&&path.isAbsolute(binary));assert.ok(archivePath&&path.isAbsolute(archivePath));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/player-world-library-'));
const bootstrap=new CoreClient(binary,path.join(out,'bootstrap'));await bootstrap.start();
try{await bootstrap.call('backup.restorePortable',{operationId:'restore-template-test',archivePath,targetDirectory:path.join(out,'domain')},120000);}finally{await bootstrap.stop();}
const core=new CoreClient(binary,path.join(out,'domain'));await core.start();
const report={format:'craftmine.player-world-library-native-test/1',out,checks:[],modelCalls:0,buildsRun:0};
try{
 const worlds=await core.call('world.list');const original=worlds.find(w=>w.runtimeKind==='godot');assert.ok(original);
 let selected=original.id;const call=(method,args)=>core.call(method,args,120000),directory=path.join(out,'operations');
 const library=createPlayerWorldLibrary({call,directory,selected:async()=>selected});
 const before=await core.call('world.read',{id:original.id}),described=await library.describe({worldId:original.id});
 const args={worldId:original.id,operationId:'save-world-first',assetId:'player.world.native-test',version:1,displayName:'Native world template',description:'A saved progress starting point',tags:['test','world'],initialState:'saved-progress',expectedSource:described.expectedSource};
 const saved=await library.save(args);assert.equal(saved.initialState,'saved-progress');assert.equal(saved.installableComponent,false);assert.equal((await library.status({operationId:args.operationId})).status,'saved');
 assert.deepEqual(await library.save(args),saved);assert.deepEqual(await library.read({ref:saved.ref}),saved);
 assert.ok((await library.list()).items.some(i=>i.assetId===saved.ref.assetId));report.checks.push('native formal source -> immutable catalog -> read -> idempotent save');
 const destination=path.join(out,'exported-world.zip');const exported=await library.exportArchive({ref:saved.ref,destination});assert.equal(exported.sha256,sha(fs.readFileSync(destination)));
 await assert.rejects(library.exportArchive({ref:saved.ref,destination}),/EEXIST/);
 assert.deepEqual(await library.importArchive({operationId:'import-same-world',archivePath:destination,archiveSha256:exported.sha256}),saved);
 const corrupt=Buffer.from(fs.readFileSync(destination));corrupt[55]^=0x01;const corruptPath=path.join(out,'corrupt.zip');fs.writeFileSync(corruptPath,corrupt);
 await assert.rejects(library.importArchive({operationId:'import-corrupt-world',archivePath:corruptPath,archiveSha256:sha(corrupt)}));
 const entries=readZip(fs.readFileSync(destination)).entries;const undeclared=writeZip([...entries,{name:'credentials.json',bytes:Buffer.from('{}')}]);await assert.rejects(validateArchive(undeclared));
 report.checks.push('native archive export/import; corruption and undeclared files refused');
 const tool=createSourceLibraryService({call,directory:path.join(out,'proposals'),installSource:async()=>{throw Error('MUST_NOT_INSTALL_WORLD');}});
 const info=await tool.tool({mode:'read',ref:saved.ref},{},original.id,'read-world');assert.equal(info.action,'create-new-world');assert.equal(info.installableComponent,false);
 await assert.rejects(tool.tool({mode:'propose',ref:saved.ref},{},original.id,'propose-world'),/WORLD_TEMPLATE_REQUIRES_NEW_WORLD/);
 report.checks.push('agent reads template metadata but cannot propose component installation');
 const factory=createGodotWorldFactory({worldsRoot:path.join(out,'worlds'),catalogFile:path.join(root,'desktop/godot/bases/base-catalog.json'),basesRoot:path.join(root,'desktop/godot/bases'),libraryStagingRoot:path.join(directory,'prepared'),domain:(method,args)=>method==='worldTemplate.prepare'?library.prepare(args):call(method,args),materialize:()=>{throw Error('MUST_USE_LIBRARY');}});
 const created=[];
 for(const operationId of ['create-template-one','create-template-two']){
  const request={title:operationId,baseId:'creation-sandbox',starterId:'library',operationId,libraryRef:saved.ref};const world=await factory.create(request);assert.equal(world.state,'initializing');assert.deepEqual(await factory.create(request),world);created.push(world.id);
  const project=path.join(out,'worlds',world.id),manifest=JSON.parse(fs.readFileSync(path.join(project,'managed-base.json'))),context={projectId:'native-template-test',sessionId:world.id,turnId:randomUUID()};
  await call('workspace.open',{context,selectedWorld:world.id});const task=await call('task.context',{context});let index=await call('godotProject.create',{context,worldId:world.id,toolCallId:'create-source',baseBuild:task.binding.baseBuild,baseId:'creation-sandbox',files:[{path:'project.godot',text:fs.readFileSync(path.join(project,'project.godot'),'utf8')}]});
  const files=manifest.files.filter(f=>f.path!=='project.godot').map(f=>({path:f.path,bytesBase64:fs.readFileSync(path.join(project,f.path)).toString('base64'),expectedHash:null}));
  for(const [i,batch]of initializationFileBatches(files).entries())index=await call('godotProject.applyFiles',{context,worldId:world.id,toolCallId:'install-'+i,revision:index.revision,manifestHash:index.manifestHash,files:batch});
  const record=await call('world.read',{id:world.id});assert.deepEqual(record.world.snapshot.body,{...before.world.snapshot.body,worldId:world.id});
  const captured=await validateArchive(fs.readFileSync(destination));for(const f of captured.manifest.files){if(['project.godot','world/creation-operations.json'].includes(f.path))continue;assert.equal(sha(fs.readFileSync(path.join(project,f.path))),f.sha256);}
  assert.match(fs.readFileSync(path.join(project,'project.godot'),'utf8'),new RegExp('runtime/world_id="'+world.id+'"'));
  await call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
 }
 assert.notEqual(created[0],created[1]);assert.deepEqual(await call('world.read',{id:original.id}),before);report.checks.push('two independent native world IDs with exact chosen saved state and unchanged source-local object IDs');
 selected='another-world';await assert.rejects(library.save({...args,operationId:'save-world-changed',assetId:'player.world.changed'}),/GODOT_WORLD_CHANGED/);selected=original.id;
 await assert.rejects(library.save({...args,operationId:'save-source-stale',expectedSource:{...args.expectedSource,buildId:'wrong'}}),/WORLD_TEMPLATE_SOURCE_CHANGED/);
 await library.cancel({operationId:'cancel-before-start'});assert.equal((await library.status({operationId:'cancel-before-start'})).status,'cancelled');assert.equal((await library.status({operationId:'unknown-operation'})).status,'unknown');
 await assert.rejects(library.save({...args,operationId:'save-invalid-start',initialState:'authored-defaults'}),/INITIAL_STATE_CHOICE_REQUIRED/);
 let releaseRead,readReached;const readGate=new Promise(resolve=>{releaseRead=resolve;}),reached=new Promise(resolve=>{readReached=resolve;});
 const cancellable=createPlayerWorldLibrary({directory:path.join(out,'cancel-operations'),selected:async()=>selected,call:async(method,input)=>{if(method==='content.readFile'){readReached();await readGate;}return call(method,input);}});
 const pending=cancellable.save({...args,operationId:'cancel-during-source',assetId:'player.world.cancelled'});const rejected=assert.rejects(pending,/WORLD_TEMPLATE_CANCELLED/);await reached;assert.equal((await cancellable.cancel({operationId:'cancel-during-source'})).cancelled,true);releaseRead();await rejected;
 assert.equal((await cancellable.status({operationId:'cancel-during-source'})).status,'cancelled');await assert.rejects(call('asset.read',{assetId:'player.world.cancelled',version:1}),/ASSET_NOT_FOUND/);
 report.checks.push('changed world, stale formal source, unknown/cancelled status and unlabeled progress refused');
 await core.stop();await core.start();assert.ok((await call('world.list')).some(w=>w.id===created[0]));assert.deepEqual(await library.read({ref:saved.ref}),saved);report.checks.push('native catalog/world state survives Core restart');
 report.worlds=created;report.ref=saved.ref;report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
