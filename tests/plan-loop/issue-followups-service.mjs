import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const captured={phase:'formal',status:'ready',worldId:'alpha',buildId:'build-a',baseId:'first-person',baseVersion:'0.1.0',instanceId:'instance-a',runtimeTarget:'godot-web',artifactManifestHash:'b'.repeat(64)};
const client={version:'0.14.3'};
if(process.argv[2]==='--child'){
 const {createCraftmineIssueService}=await import(pathToFileURL(process.argv[3]));
 const service=createCraftmineIssueService({directory:process.argv[4],client,captureContext:async()=>captured,fault:point=>{if(point===process.argv[5])process.exit(29);}});
 try{process.stdout.write(JSON.stringify(await service.request(process.argv[6],JSON.parse(process.argv[7]))));}catch(error){process.stderr.write(error.code||error.message);process.exitCode=1;}
}else{
 const deps=process.env.CRAFTMINE_DEPS_ROOT||path.join(root,'vendor/pi-desktop/packages/agent-runtime');
 const {build}=createRequire(path.join(deps,'package.json'))('esbuild');
 await fs.mkdir(path.join(root,'test-results'),{recursive:true});const out=await fs.mkdtemp(path.join(root,'test-results/issue-followups-')),modulePath=path.join(out,'service.mjs');
 await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-service.ts')],outfile:modulePath,bundle:true,platform:'node',format:'esm'});
 const {createCraftmineIssueService}=await import(pathToFileURL(modulePath));
 const report={format:'craftmine.issue-followups-service-tests/1',checks:[],sourceSha256:createHash('sha256').update(await fs.readFile(path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-service.ts'))).digest('hex')};
 const rejected=(promise,code)=>assert.rejects(promise,error=>error.code===code);
 async function fixture(){const directory=await fs.mkdtemp(path.join(out,'owned-'));let current={...captured};const service=createCraftmineIssueService({directory,client,captureContext:async()=>current});const {issue}=await service.request('issue.create',{worldId:'alpha',operationId:'create',description:'  Original 世界\n<script>inert</script>  '});return{directory,service,issue,setContext:value=>{current=value;}};}
 const read=f=>f.service.request('issue.read',{worldId:'alpha',issueId:f.issue.id});
 async function input(f,kind='note',text='Additional detail',operationId='followup'){const p=await f.service.request('issue.followupPrepare',{worldId:'alpha',issueId:f.issue.id});return{worldId:'alpha',issueId:f.issue.id,operationId,revision:p.revision,contextHash:p.contextHash,kind,text};}
 const child=(f,point,channel,args)=>spawnSync(process.execPath,[import.meta.filename,'--child',modulePath,f.directory,point,channel,JSON.stringify(args)],{windowsHide:true,encoding:'utf8',timeout:15000});
 async function check(name,run){try{await run();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:String(error.stack)});process.exitCode=1;}}
 await check('v1 reads leave original bytes untouched; first append upgrades only ledger schema',async()=>{
  const f=await fixture(),file=path.join(f.directory,'issues.json'),old=JSON.parse(await fs.readFile(file));old.format='craftmine.local-issues/1';delete old.followups;const bytes=Buffer.from(JSON.stringify(old));await fs.writeFile(file,bytes);
  await read(f);await input(f);assert.deepEqual(await fs.readFile(file),bytes);
  await f.service.request('issue.followup',await input(f));const after=JSON.parse(await fs.readFile(file));assert.equal(after.format,'craftmine.local-issues/2');assert.deepEqual(after.records,old.records);
 });
 await check('player state transitions and notes keep original context and record verbatim',async()=>{
  const f=await fixture();f.setContext({...captured,buildId:'build-b',instanceId:'instance-b'});
  for(const [i,kind]of ['note','still-present','player-resolved','note','reopened'].entries())await f.service.request('issue.followup',await input(f,kind,kind==='note'?'  更多说明 🌍\n<script>data</script>  ':'','op-'+i));
  const result=await read(f);assert.deepEqual(result.issue,f.issue);assert.equal(result.playerStatus,'reopened');assert.equal(result.followups.length,5);assert.ok(result.followups.every(x=>x.context.buildId==='build-b'));assert.equal(result.issue.context.buildId,'build-a');
  assert.equal(result.issue.reproduction,'not-attempted');assert.equal(result.issue.status,'recorded');assert.equal(result.followups[0].text,'  更多说明 🌍\n<script>data</script>  ');
  const reopened=child(f,'none','issue.read',{worldId:'alpha',issueId:f.issue.id});assert.equal(reopened.status,0,reopened.stderr);assert.deepEqual(JSON.parse(reopened.stdout),result);
 });
 await check('same operation replay survives changed context and later entries without duplication',async()=>{
  const f=await fixture(),request=await input(f);const first=await f.service.request('issue.followup',request);
  assert.equal((await f.service.request('issue.list',{worldId:'alpha'})).remainingCreateSlots,510);
  await f.service.request('issue.followup',await input(f,'player-resolved','','resolve'));f.setContext(null);
  const replay=await f.service.request('issue.followup',request);assert.equal(replay.replayed,true);assert.equal(replay.followupId,first.followupId);assert.equal(replay.followups.length,2);
  await rejected(f.service.request('issue.followup',{...request,text:'changed'}),'ISSUE_OPERATION_CONFLICT');
  await f.service.request('issue.delete',{worldId:'alpha',issueId:f.issue.id,operationId:'delete'});const gone=await f.service.request('issue.followup',request);assert.equal(gone.deleted,true);assert.equal(gone.issue,null);
 });
 await check('stale issue revision, world/build/instance and unavailable preview are fail closed',async()=>{
  for(const key of ['worldId','buildId','instanceId','artifactManifestHash']){
   const f=await fixture(),request=await input(f),before=await fs.readFile(path.join(f.directory,'issues.json'));f.setContext({...captured,[key]:key==='artifactManifestHash'?'c'.repeat(64):'changed'});
   await rejected(f.service.request('issue.followup',request),'ISSUE_WORLD_CHANGED');assert.deepEqual(await fs.readFile(path.join(f.directory,'issues.json')),before);
  }
  const f=await fixture(),request=await input(f);await f.service.request('issue.followup',request);await rejected(f.service.request('issue.followup',{...request,operationId:'another'}),'ISSUE_REVISION_CHANGED');
  f.setContext({...captured,phase:'candidate'});await rejected(input(f),'ISSUE_CONTEXT_NOT_READY');
 });
 await check('invalid transitions, source/context injection, text bounds and unknown kinds reject',async()=>{
  const f=await fixture(),request=await input(f);await rejected(f.service.request('issue.followup',{...request,kind:'reopened'}),'ISSUE_STATE_CONFLICT');
  for(const extra of [{kind:'auto-fixed'},{kind:['note'],text:''},{kind:42},{kind:{}},{text:'\ud800'},{text:'x'.repeat(2049)},{context:captured},{path:'C:/outside'},{text:'\0'},{revision:1.2},{contextHash:'forged'}])await rejected(f.service.request('issue.followup',{...request,...extra}),'ISSUE_INVALID_INPUT');
  await rejected(f.service.request('issue.followup',{...request,worldId:'beta'}),'ISSUE_NOT_FOUND');
 });
 await check('actual process interruption and lost commit reply preserve one durable followup',async()=>{
  for(const point of ['beforeWrite','beforeSync','beforeRename','afterRename']){
   const f=await fixture(),request=await input(f);const crashed=child(f,point,'issue.followup',request);assert.equal(crashed.status,29,crashed.stderr);
   const reopened=child(f,'none','issue.read',{worldId:'alpha',issueId:f.issue.id});assert.equal(reopened.status,0,reopened.stderr);assert.equal(JSON.parse(reopened.stdout).followups.length,point==='afterRename'?1:0);
   const replay=child(f,'none','issue.followup',request);assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).followups.length,1);assert.equal(JSON.parse(replay.stdout).replayed,point==='afterRename');
  }
 });
 await check('followup corruption and hardlinks fail without replacing original storage',async()=>{
  const f=await fixture();await f.service.request('issue.followup',await input(f));const file=path.join(f.directory,'issues.json'),valid=JSON.parse(await fs.readFile(file));
  for(const mutate of [x=>x.followups[0].text='tampered',x=>x.followups[0].context.buildId='tampered',x=>x.followups[0].revision=7,x=>x.followups[0].kind=['note'],x=>x.format=[x.format],x=>x.receipts[1].method=[x.receipts[1].method]]){
   const bad=structuredClone(valid);mutate(bad);const bytes=Buffer.from(JSON.stringify(bad));await fs.writeFile(file,bytes);await rejected(read(f),'ISSUE_STORAGE_INVALID');assert.deepEqual(await fs.readFile(file),bytes);
  }
  await fs.writeFile(file,JSON.stringify(valid));const sentinel=path.join(f.directory,'sentinel');await fs.link(file,sentinel);await rejected(read(f),'ISSUE_STORAGE_INVALID');assert.deepEqual(await fs.readFile(sentinel),Buffer.from(JSON.stringify(valid)));
 });
 await check('per-issue cap is finite while deletion remains available',async()=>{
  const f=await fixture();for(let i=0;i<32;i++)await f.service.request('issue.followup',await input(f,'note','detail','note-'+i));
  await rejected(f.service.request('issue.followup',await input(f,'note','full','note-full')),'ISSUE_FOLLOWUP_CAPACITY_REACHED');
  await f.service.request('issue.delete',{worldId:'alpha',issueId:f.issue.id,operationId:'delete'});assert.equal((await f.service.request('issue.list',{worldId:'alpha'})).total,0);
 });
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.checks.every(x=>x.passed),checks:report.checks.length}));
}
