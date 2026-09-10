import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const context = {phase:'formal',status:'ready',worldId:'alpha',buildId:'gbd-'+'a'.repeat(64),baseId:'first-person',baseVersion:'1',instanceId:'instance-a',runtimeTarget:'godot-web',artifactManifestHash:'b'.repeat(64)};
const client = {version:'0.14.3',commit:'c'.repeat(40)};
if (process.argv[2] === '--child') {
  const {createCraftmineIssueService} = await import(pathToFileURL(process.argv[3]));
  const service = createCraftmineIssueService({directory:process.argv[4],client,captureContext:async()=>context,
    fault:point=>{if(point===process.argv[5])process.exit(29);}});
  try { process.stdout.write(JSON.stringify(await service.request(process.argv[6],JSON.parse(process.argv[7])))); }
  catch(error) { process.stderr.write(error.code||error.message);process.exitCode=1; }
} else {
  const resultsRoot=path.join(root,'test-results');await fs.mkdir(resultsRoot,{recursive:true});
  const output=await fs.mkdtemp(path.join(resultsRoot,'local-issues-'));
  const modulePath=path.join(output,'service.mjs');
  const deps=process.env.CRAFTMINE_DEPS_ROOT||path.join(root,'vendor/pi-desktop/packages/agent-runtime');
  const {build}=createRequire(path.join(deps,'package.json'))('esbuild');
  await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-service.ts')],outfile:modulePath,bundle:true,platform:'node',format:'esm'});
  const {createCraftmineIssueService,ISSUE_LIMITS}=await import(pathToFileURL(modulePath));
  const report={format:'craftmine.local-issues-service-test/1',sourceHash:createHash('sha256').update(await fs.readFile(path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-service.ts'))).digest('hex'),startedAt:new Date().toISOString(),checks:[],completed:false,modelCalls:0,networkCalls:0,visibleWindows:0};
  const fixture=async(extra={})=>{const directory=await fs.mkdtemp(path.join(output,'profile-'));return{directory,service:createCraftmineIssueService({directory,client,captureContext:async()=>context,...extra})};};
  const create=(service,operationId='create-a',description='The door remains closed.')=>service.request('issue.create',{worldId:'alpha',operationId,description});
  const list=service=>service.request('issue.list',{worldId:'alpha'});
  const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&error.message===code);
  const child=(directory,point,channel='issue.create',input={worldId:'alpha',operationId:'child-create',description:'Child record'})=>spawnSync(process.execPath,[import.meta.filename,'--child',modulePath,directory,point,channel,JSON.stringify(input)],{encoding:'utf8',windowsHide:true,timeout:15000});
  async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS',name);}catch(error){report.checks.push({name,passed:false,error:error.stack});console.error('FAIL',name,error);process.exitCode=1;}}
  await check('verbatim Unicode, projected host identity, clone isolation and a separate process reopen',async()=>{
    const f=await fixture({captureContext:async()=>({...context,root:'C:/private',snapshot:{secret:'never'},url:'token'})});
    const raw='  门没开\r\n\t<script>do not execute()</script> 世界 🌍  ';
    const result=await create(f.service,'unicode',raw);assert.equal(result.issue.description,raw);
    assert.deepEqual(result.issue.context,context);assert.deepEqual(result.issue.client,client);assert.deepEqual(result.issue.attachments,[]);
    result.issue.description='mutated';const read=await f.service.request('issue.read',{worldId:'alpha',issueId:result.issue.id});assert.equal(read.issue.description,raw);
    const reopened=child(f.directory,'none','issue.read',{worldId:'alpha',issueId:result.issue.id});assert.equal(reopened.status,0,reopened.stderr);assert.deepEqual(JSON.parse(reopened.stdout),read);
    const stored=await fs.readFile(path.join(f.directory,'issues.json'),'utf8');for(const secret of ['C:/private','never','token'])assert.equal(stored.includes(secret),false);
    assert.equal((await list(f.service)).backupIncluded,false);
  });
  await check('create replay never resamples or replaces original evidence; operation conflicts reject',async()=>{
    const f=await fixture(),first=await create(f.service);
    const reopened=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>{throw Error('must not sample');}});
    const replay=await create(reopened);assert.equal(replay.replayed,true);assert.deepEqual(replay.issue,first.issue);
    await rejects(create(reopened,'create-a','Changed text'),'ISSUE_OPERATION_CONFLICT');
    await rejects(reopened.request('issue.create',{worldId:'beta',operationId:'create-a',description:'The door remains closed.'}),'ISSUE_OPERATION_CONFLICT');
  });
  await check('phase, runtime readiness, missing identity and each identity transition fail closed',async()=>{
    for(const changed of [{phase:'candidate'},{status:'loading'},{runtimeTarget:'native'},{artifactManifestHash:'invalid'},null]){
      const f=await fixture({captureContext:async()=>changed===null?null:{...context,...changed}});
      await rejects(create(f.service),changed===null?'ISSUE_CONTEXT_UNAVAILABLE':'ISSUE_CONTEXT_NOT_READY');assert.equal((await list(f.service)).total,0);
    }
    for(const field of ['worldId','buildId','baseId','baseVersion','instanceId','artifactManifestHash']){
      let calls=0;const next=field==='artifactManifestHash'?'d'.repeat(64):'changed';
      const f=await fixture({captureContext:async()=>++calls===1?context:{...context,[field]:next}});
      await rejects(create(f.service),'ISSUE_WORLD_CHANGED');assert.equal((await list(f.service)).total,0);
    }
    const f=await fixture({captureContext:async()=>({...context,worldId:'beta'})});await rejects(create(f.service),'ISSUE_WORLD_CHANGED');
    for(const code of ['ISSUE_WORLD_CHANGED','ISSUE_CONTEXT_NOT_READY','PRIVATE_FAILURE']){
      const hostFailure=await fixture({captureContext:async()=>{throw Object.assign(Error('private host path'),{code});}});
      await rejects(create(hostFailure.service),code==='PRIVATE_FAILURE'?'ISSUE_CONTEXT_UNAVAILABLE':code);
    }
  });
  await check('untrusted parameters, invalid encoding, paths and unsupported operations are rejected',async()=>{
    const f=await fixture();
    for(const input of [{worldId:'../alpha',operationId:'a',description:'a'},{worldId:'alpha',operationId:'a',description:'a',context},
      {worldId:'alpha',operationId:'a',description:'\ud800'},{worldId:'alpha',operationId:'a',description:'a\0b'},
      {worldId:'alpha',operationId:'a',description:'x'.repeat(4097)},{worldId:'alpha',operationId:'a',description:'   '}])await rejects(f.service.request('issue.create',input),'ISSUE_INVALID_INPUT');
    await rejects(f.service.request('issue.list',{worldId:'alpha',limit:51}),'ISSUE_INVALID_INPUT');
    await rejects(f.service.request('issue.list',{worldId:'alpha',offset:-1}),'ISSUE_INVALID_INPUT');
    await rejects(f.service.request('issue.read',{worldId:'alpha',issueId:'../../secrets'}),'ISSUE_INVALID_INPUT');
    await rejects(f.service.request('issue.export',{worldId:'alpha'}),'ISSUE_INVALID_INPUT');
  });
  await check('world isolation, pagination, durable deletion and replay cannot resurrect a deleted record',async()=>{
    const f=await fixture(),a=await create(f.service,'a'),b=await create(f.service,'b');
    const other=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>({...context,worldId:'beta'})});
    await other.request('issue.create',{worldId:'beta',operationId:'beta-create',description:'Other world'});
    const first=await f.service.request('issue.list',{worldId:'alpha',limit:1});assert.equal(first.total,2);assert.equal(first.items[0].id,b.issue.id);assert.equal(first.nextOffset,1);assert.equal(Object.hasOwn(first.items[0],'description'),false);
    const second=await f.service.request('issue.list',{worldId:'alpha',offset:1,limit:1});assert.equal(second.items[0].id,a.issue.id);assert.equal(second.nextOffset,null);
    await rejects(other.request('issue.read',{worldId:'beta',issueId:a.issue.id}),'ISSUE_NOT_FOUND');
    await rejects(other.request('issue.delete',{worldId:'beta',issueId:a.issue.id,operationId:'wrong-delete'}),'ISSUE_NOT_FOUND');
    const remove={worldId:'alpha',issueId:a.issue.id,operationId:'delete-a'};await f.service.request('issue.delete',remove);
    const reopened=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>null});
    assert.equal((await reopened.request('issue.delete',remove)).replayed,true);
    assert.deepEqual(await create(reopened,'a'),{status:'completed',replayed:true,issue:null,deleted:true});
    await rejects(reopened.request('issue.read',{worldId:'alpha',issueId:a.issue.id}),'ISSUE_NOT_FOUND');
    assert.equal((await list(reopened)).total,1);
  });
  await check('write, sync and rename failures preserve exact old ledger; errors do not disclose paths',async()=>{
    for(const point of ['beforeWrite','beforeSync','beforeRename']){
      const f=await fixture();await create(f.service);const before=await fs.readFile(path.join(f.directory,'issues.json'));
      const broken=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>context,fault:p=>{if(p===point)throw Object.assign(Error(`ENOSPC ${f.directory}`),{code:'ENOSPC'});}});
      await rejects(create(broken,'failed'),'ISSUE_STORAGE_UNAVAILABLE');assert.deepEqual(await fs.readFile(path.join(f.directory,'issues.json')),before);
      assert.equal((await list(f.service)).total,1);assert.deepEqual(await fs.readdir(f.directory),['issues.json']);
    }
  });
  await check('response loss after atomic commit resolves from the original receipt',async()=>{
    const f=await fixture({fault:p=>{if(p==='afterRename')throw Error('response lost');}});
    await rejects(create(f.service),'ISSUE_STORAGE_UNAVAILABLE');const reopened=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>null});
    assert.equal((await create(reopened)).replayed,true);assert.equal((await list(reopened)).total,1);
  });
  await check('real process interruption before and after rename recovers without partial records',async()=>{
    const f=await fixture();await create(f.service);const before=await fs.readFile(path.join(f.directory,'issues.json'));
    const killed=child(f.directory,'beforeRename');assert.equal(killed.status,29,killed.stderr);
    assert.equal((await fs.readdir(f.directory)).some(name=>name.startsWith('.issue-pending-')),true);
    assert.equal((await list(f.service)).total,1);assert.deepEqual(await fs.readFile(path.join(f.directory,'issues.json')),before);
    assert.deepEqual(await fs.readdir(f.directory),['issues.json']);
    const committed=child(f.directory,'afterRename');assert.equal(committed.status,29,committed.stderr);
    const restarted=child(f.directory,'none');assert.equal(restarted.status,0,restarted.stderr);assert.equal(JSON.parse(restarted.stdout).replayed,true);assert.equal((await list(f.service)).total,2);
  });
  await check('bounded concurrent requests and multiple same-process factories never lose updates',async()=>{
    let release;const wait=new Promise(resolve=>{release=resolve;});let calls=0;
    const f=await fixture({captureContext:async()=>{if(++calls===1)await wait;return context;}});
    const other=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>context});
    const pending=Array.from({length:16},(_,i)=>create(i%2?other:f.service,`parallel-${i}`));
    await rejects(list(other),'ISSUE_BUSY');release();await Promise.all(pending);assert.equal((await list(f.service)).total,16);
  });
  await check('capture timeout is bounded and a late callback cannot create a record',async()=>{
    let release;const wait=new Promise(resolve=>{release=resolve;});const f=await fixture({captureContext:()=>wait});
    await rejects(create(f.service),'ISSUE_CONTEXT_UNAVAILABLE');release(context);assert.equal((await list(f.service)).total,0);
  });
  await check('active-record quota blocks growth and deletion permits a new record',async()=>{
    const f=await fixture();let first;
    for(let i=0;i<ISSUE_LIMITS.maxRecords;i++){const result=await create(f.service,`record-${i}`);first??=result.issue;}
    await rejects(create(f.service,'over-quota'),'ISSUE_CAPACITY_REACHED');
    await f.service.request('issue.delete',{worldId:'alpha',issueId:first.id,operationId:'free-slot'});await create(f.service,'after-delete');assert.equal((await list(f.service)).total,100);
  });
  await check('cumulative receipt capacity preserves deletion and old retries without recycling',async()=>{
    const f=await fixture();let last;
    for(let i=0;i<ISSUE_LIMITS.maxCreatedRecords;i++){
      const result=await create(f.service,`lifetime-${i}`);last=result.issue;
      if(i<ISSUE_LIMITS.maxCreatedRecords-1)await f.service.request('issue.delete',{worldId:'alpha',issueId:last.id,operationId:`delete-${i}`});
    }
    let status=await list(f.service);assert.deepEqual(status.usage,{records:1,createdRecords:512,receipts:1023});
    await rejects(create(f.service,'over-lifetime'),'ISSUE_RECEIPT_CAPACITY_REACHED');
    await f.service.request('issue.delete',{worldId:'alpha',issueId:last.id,operationId:'last-delete'});
    status=await list(f.service);assert.deepEqual(status.usage,{records:0,createdRecords:512,receipts:1024});
    await rejects(create(f.service,'still-over-lifetime'),'ISSUE_RECEIPT_CAPACITY_REACHED');
    assert.equal((await create(f.service,'lifetime-0')).deleted,true);
  });
  await check('serialized-byte quota rejects growth before the active-record limit',async()=>{
    const f=await fixture();let rejected=false;
    for(let i=0;i<ISSUE_LIMITS.maxRecords;i++){
      try { await create(f.service,`bytes-${i}`,'\u0001'.repeat(4096)); }
      catch(error){assert.equal(error.code,'ISSUE_CAPACITY_REACHED');rejected=true;break;}
    }
    assert.equal(rejected,true);const status=await list(f.service);assert.ok(status.total<ISSUE_LIMITS.maxRecords);
    assert.ok((await fs.stat(path.join(f.directory,'issues.json'))).size<=ISSUE_LIMITS.maxLedgerBytes);
  });
  await check('failed delete preserves the record and a lost delete response remains recoverable',async()=>{
    const f=await fixture(),saved=await create(f.service),args={worldId:'alpha',issueId:saved.issue.id,operationId:'delete-fault'};
    const before=await fs.readFile(path.join(f.directory,'issues.json'));
    const broken=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>context,fault:point=>{if(point==='beforeRename')throw Error('cannot rename');}});
    await rejects(broken.request('issue.delete',args),'ISSUE_STORAGE_UNAVAILABLE');assert.deepEqual(await fs.readFile(path.join(f.directory,'issues.json')),before);
    const lost=createCraftmineIssueService({directory:f.directory,client,captureContext:async()=>context,fault:point=>{if(point==='afterRename')throw Error('reply lost');}});
    await rejects(lost.request('issue.delete',args),'ISSUE_STORAGE_UNAVAILABLE');assert.equal((await f.service.request('issue.delete',args)).replayed,true);assert.equal((await list(f.service)).total,0);
  });
  await check('corrupt or oversized ledger is never replaced with an empty success',async()=>{
    for(const content of ['{broken',JSON.stringify({format:'craftmine.local-issues/1',records:[],receipts:[],secret:'invalid'}),'x'.repeat(ISSUE_LIMITS.maxLedgerBytes+1)]){
      const f=await fixture();const file=path.join(f.directory,'issues.json');await fs.writeFile(file,content);
      await rejects(list(f.service),'ISSUE_STORAGE_INVALID');await rejects(create(f.service),'ISSUE_STORAGE_INVALID');assert.equal(await fs.readFile(file,'utf8'),content);
    }
  });
  await check('hardlink and ancestor junction/symlink are refused without modifying the sentinel',async()=>{
    const f=await fixture(),sentinel=path.join(output,'sentinel.json');await fs.writeFile(sentinel,'private-sentinel');
    await fs.link(sentinel,path.join(f.directory,'issues.json'));await rejects(list(f.service),'ISSUE_STORAGE_INVALID');assert.equal(await fs.readFile(sentinel,'utf8'),'private-sentinel');
    const linked=path.join(output,'linked-directory');await fs.symlink(f.directory,linked,process.platform==='win32'?'junction':'dir');
    const service=createCraftmineIssueService({directory:linked,client,captureContext:async()=>context});await rejects(create(service),'ISSUE_STORAGE_INVALID');assert.equal(await fs.readFile(sentinel,'utf8'),'private-sentinel');
  });
  report.completed=true;report.passed=report.checks.every(check=>check.passed);report.finishedAt=new Date().toISOString();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,passed:report.passed,checks:report.checks.length}));
}
