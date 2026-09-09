import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..'),output=path.join(root,'desktop/build/tests-e');await fs.mkdir(output,{recursive:true});
const {build}=createRequire(path.join(process.env.CRAFTMINE_DEPS_ROOT||path.join(root,'vendor/pi-desktop/packages/agent-runtime'),'package.json'))('esbuild');
for(const name of ['backup','diagnostics'])await build({entryPoints:[path.join(root,`vendor/pi-desktop/apps/desktop/electron/main/craftmine-${name}-service.ts`)],outfile:path.join(output,`${name}.mjs`),bundle:true,platform:'node',format:'esm'});
const {createCraftmineBackupService}=await import(pathToFileURL(path.join(output,'backup.mjs')));
const {createCraftmineDiagnosticsService}=await import(pathToFileURL(path.join(output,'diagnostics.mjs')));
const h='a'.repeat(64),old='b'.repeat(64),archive={format:'craftmine.domain-backup/1',schemaVersion:1,hash:h,tables:{worlds:[{id:'fixture'}]}};
async function fixture(){const dir=await fs.mkdtemp(path.join(output,'fixture-'));return {dir,file:path.join(dir,'backup.json')};}
function domain(calls){return async(method,params)=>{calls.push({method,params});if(method==='backup.exportPortable'){await fs.writeFile(params.archivePath,JSON.stringify(archive));return{id:params.operationId,status:'completed',manifest:{hash:h,bytes:100}};}if(method==='backup.inspectPortable'||method==='backup.verifyPortable'){let body;try{body=JSON.parse(await fs.readFile(params.archivePath,'utf8'));}catch{throw Object.assign(Error('BACKUP_INVALID_ARCHIVE'),{code:'BACKUP_INVALID_ARCHIVE'});}return{headerValid:body.hash===h,valid:body.hash===h,archiveHash:h,entries:1,verifiedFiles:1};}if(method==='backup.status')return{currentHash:old};if(method==='backup.restorePortableActive'){if(params.expectedCurrentHash!==old)throw Object.assign(Error('STALE_WORLD'),{code:'STALE_WORLD'});return{id:params.operationId,status:'completed',activated:true,currentHash:h,modelReplay:false};}throw Error(method);};}

test('export uses a native choice and restores only a content-bound opaque grant',async()=>{
  const f=await fixture(),calls=[],service=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},domainCall:domain(calls),pickFile:async()=>f.file});
  const exported=await service.request('backup.export',{operationId:'export-fixture'});assert.equal(exported.status,'completed');assert.equal(JSON.stringify(exported).includes(f.dir),false);
  const inspected=await service.request('backup.inspect',{});assert.equal(inspected.scope,'profile');assert.equal(inspected.expectedCurrentHash,old);assert.ok(inspected.grantId);assert.equal('archive' in inspected,false);
  const restored=await service.request('backup.restore',{operationId:'restore-fixture',grantId:inspected.grantId,expectedCurrentHash:old});assert.equal(restored.currentHash,h);
  assert.deepEqual(await service.request('backup.restore',{operationId:'restore-fixture',grantId:inspected.grantId,expectedCurrentHash:old}),restored);
  assert.equal(calls.filter(c=>c.method==='backup.restorePortableActive').length,1);
});
test('renderer paths and raw archives cannot become filesystem authority',async()=>{
  const service=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},domainCall:async()=>{throw Error('must not call');},pickFile:async()=>{throw Error('must not choose');}});
  for(const args of [{path:'C:/private'}, {archive}, {grantId:'anything'}])await assert.rejects(service.request('backup.inspect',args),/INVALID_PARAMS/);
});
test('file replacement after preview and stale world hash prevent restore',async()=>{
  const f=await fixture(),calls=[];await fs.writeFile(f.file,JSON.stringify(archive));
  const service=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},domainCall:domain(calls),pickFile:async()=>f.file}),inspected=await service.request('backup.inspect');
  await fs.writeFile(f.file,JSON.stringify({...archive,extra:true}));await assert.rejects(service.request('backup.restore',{operationId:'changed-fixture',grantId:inspected.grantId,expectedCurrentHash:old}),/BACKUP_FILE_CHANGED/);
  assert.equal(calls.filter(c=>c.method==='backup.restorePortableActive').length,0);
  await fs.writeFile(f.file,JSON.stringify(archive));const next=await service.request('backup.inspect');
  await assert.rejects(service.request('backup.restore',{operationId:'stale-fixture',grantId:next.grantId,expectedCurrentHash:h}),/STALE_WORLD/);
});
test('lost restore receipt can be explicitly retried using the same operation id',async()=>{
  const f=await fixture(),calls=[];await fs.writeFile(f.file,JSON.stringify(archive));let first=true;
  const call=domain(calls),service=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},pickFile:async()=>f.file,domainCall:async(method,params)=>{const result=await call(method,params);if(method==='backup.restorePortableActive'&&first){first=false;throw Object.assign(Error('lost'),{code:'TRANSPORT_LOST'});}return result;}});
  const grant=await service.request('backup.inspect'),params={operationId:'lost-fixture',grantId:grant.grantId,expectedCurrentHash:old};
  await assert.rejects(service.request('backup.restore',params),/TRANSPORT_LOST/);assert.equal((await service.request('backup.restore',params)).status,'completed');
  assert.equal(calls.filter(c=>c.method==='backup.restorePortableActive').every(c=>c.params.operationId==='lost-fixture'),true);
});
test('cancelled picker cannot start export and expired grants cannot restore',async()=>{
  const f=await fixture(),calls=[];let choose;const picked=new Promise(resolve=>{choose=resolve;});
  const service=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},domainCall:domain(calls),pickFile:()=>picked});const pending=service.request('backup.export',{operationId:'cancel-fixture'});await service.request('backup.cancel',{operationId:'cancel-fixture'});choose(f.file);assert.equal((await pending).status,'cancelled');assert.equal(calls.some(c=>c.method==='backup.exportPortable'),false);
  await fs.writeFile(f.file,JSON.stringify(archive));let now=0;const expiring=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},domainCall:domain(calls),pickFile:async()=>f.file,now:()=>now});const grant=await expiring.request('backup.inspect');now=700000;
  await assert.rejects(expiring.request('backup.restore',{operationId:'expired-fixture',grantId:grant.grantId,expectedCurrentHash:old}),/GRANT_EXPIRED/);
});
test('corrupt and missing selected files fail without leaking their paths',async()=>{
  const f=await fixture(),calls=[],service=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},domainCall:domain(calls),pickFile:async()=>f.file});await fs.writeFile(f.file,'broken JSON');await assert.rejects(service.request('backup.inspect'),/BACKUP_INVALID_ARCHIVE/);
  await fs.unlink(f.file);try{await service.request('backup.inspect');assert.fail('expected missing file');}catch(error){assert.equal(error.message.includes(f.dir),false);}
});
test('diagnostics is an allowlist with measured counters and no secrets/source/private paths',async()=>{
  const f=await fixture(),service=createCraftmineDiagnosticsService({pickFile:async()=>f.file,snapshot:async()=>({build:{version:'0.14.3',commit:'c'.repeat(40),privatePath:'C:/private'},credentials:{status:'protected',apiKey:'secret-value'},task:{status:'running',requestCount:3,errorCode:'C:/private-error',text:'private chat'},world:{source:'private-source'}})});
  service.observe('startup',200);service.observe('frame',16);service.observe('modelJob',800);
  const status=await service.request('diagnostics.status'),text=JSON.stringify(status);assert.equal(status.metrics.startup.p50Ms,200);assert.equal(status.credentials.status,'protected');for(const secret of ['secret-value','C:/private','private chat','private-source'])assert.equal(text.includes(secret),false);
  const receipt=await service.request('diagnostics.export',{operationId:'diagnostic-fixture'});assert.equal(receipt.status,'completed');assert.equal((await fs.readFile(f.file,'utf8')).includes('secret-value'),false);
});
test('failed export file write is not confused with a completed domain snapshot',async()=>{
  const f=await fixture(),calls=[],call=domain(calls);const service=createCraftmineBackupService({beforeRestore:async()=>{},afterRestore:async()=>{},pickFile:async()=>f.dir,domainCall:async(method,params)=>method==='backup.status'?{status:'completed',currentHash:old}:call(method,params)});
  await assert.rejects(service.request('backup.export',{operationId:'failed-write'}),/NONFILE_DENIED/);
  assert.equal((await service.request('backup.status',{operationId:'failed-write'})).status,'failed');
});
test('diagnostic export errors omit selected private paths',async()=>{
  const f=await fixture(),service=createCraftmineDiagnosticsService({pickFile:async()=>path.join(f.dir,'missing','report.json'),snapshot:async()=>({})});
  await assert.rejects(service.request('diagnostics.export',{operationId:'failed-diagnostic'}),error=>!error.message.includes(f.dir)&&error.message==='ENOENT');
});
function guard(args){return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',path.join(root,'desktop/windows-upgrade-guard.ps1'),...args],{windowsHide:true,encoding:'utf8'});}
test('offline upgrade guard copies synthetic data and verifies corruption without touching originals',async()=>{
  const f=await fixture(),profile=path.join(f.dir,'profile');await fs.mkdir(path.join(profile,'plugins/data/craftmine.world'),{recursive:true});await fs.writeFile(path.join(profile,'pi.sqlite'),'synthetic-db');await fs.writeFile(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),'synthetic-world');
  const made=guard(['-ProfileDir',profile,'-BuildId','fixture']);assert.equal(made.status,0,made.stderr);
  const backups=await fs.readdir(path.join(profile,'upgrade-backups')),backup=path.join(profile,'upgrade-backups',backups[0]);assert.equal(guard(['-Mode','Verify','-BackupDir',backup]).status,0);
  await fs.writeFile(path.join(backup,'pi.sqlite'),'corrupted');assert.notEqual(guard(['-Mode','Verify','-BackupDir',backup]).status,0);assert.equal(await fs.readFile(path.join(profile,'pi.sqlite'),'utf8'),'synthetic-db');
});
test('offline upgrade guard refuses a profile with an open database file',async()=>{
  const f=await fixture(),profile=path.join(f.dir,'profile');await fs.mkdir(profile);const file=path.join(profile,'pi.sqlite');await fs.writeFile(file,'synthetic');const handle=await fs.open(file,'r+');
  try{assert.notEqual(guard(['-ProfileDir',profile,'-BuildId','locked-fixture']).status,0);}finally{await handle.close();}
  assert.equal(await fs.readFile(file,'utf8'),'synthetic');
});
