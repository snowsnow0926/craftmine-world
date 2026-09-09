import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {build}=createRequire(new URL('../../vendor/pi-desktop/packages/agent-runtime/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-operation-journal.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {createCraftmineOperationJournal:create}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const owner={projectId:'project',sessionId:'session',worldId:'world'},ref={id:'oak',version:1,hash:'a'.repeat(64)};
await mkdir(path.join(root,'test-results'),{recursive:true});
const directory=()=>mkdtemp(path.join(root,'test-results/batch07-journal-'));
test('real filesystem journal survives pending/completed restart with exact original install revision',async()=>{
 const dir=await directory();let j=create(dir);const p=await j.prepare(owner,'library.install',{ref,revision:3});
 j=create(dir);assert.equal((await j.list(owner))[0].operationId,p.operationId);
 assert.equal((await j.prepare(owner,'library.install',{ref,revision:4})).payload.revision,3);
 let writes=0;const actual=await j.execute(owner,p.operationId,async record=>{writes++;assert.equal(record.payload.revision,3);return {receipt:{revision:4},applied:false};});
 j=create(dir);assert.deepEqual(await j.execute(owner,p.operationId,async()=>{throw Error('must not repeat');}),actual);assert.equal(writes,1);
 await j.acknowledge(owner,p.operationId);assert.deepEqual(await create(dir).list(owner),[]);
});
test('real persisted owner and params reject session/world/identity injection',async()=>{
 const dir=await directory(),j=create(dir),p=await j.prepare(owner,'memory.propose',{kind:'project-rule',claim:'Keep API keys out of chat; ordinary player rule',tags:[]});
 for(const changed of [{...owner,worldId:'another'},{...owner,sessionId:'another'},{...owner,projectId:'another'}]){
   assert.deepEqual(await j.list(changed),[]);await assert.rejects(j.execute(changed,p.operationId,async()=>({})),/OWNER_MISMATCH/);
 }
 await assert.rejects(j.prepare(owner,'memory.propose',{kind:'project-rule',claim:'Changed'},p.operationId),/REPLAY_MISMATCH/);
 await assert.rejects(j.prepare(owner,'memory.propose',{kind:'project-rule',claim:'Rule',context:owner}),/INVALID_OPERATION_PARAMS/);
 await assert.rejects(j.prepare(owner,'library.install',{ref:{...ref,secretStore:{}}}),/INVALID_OPERATION_PARAMS/);
 await assert.rejects(j.acknowledge(owner,p.operationId),/UNCONFIRMED/);
});
test('concurrent execution is deduplicated and uncertain operation retries original ID',async()=>{
 const dir=await directory(),j=create(dir),p=await j.prepare(owner,'backup.export',{});let writes=0;
 const action=async()=>{writes++;await new Promise(resolve=>setTimeout(resolve,20));return {operationId:p.operationId,status:'completed',scope:'profile',credentialsIncluded:false};};
 await Promise.all([j.execute(owner,p.operationId,action),j.execute(owner,p.operationId,action)]);assert.equal(writes,1);
 await j.acknowledge(owner,p.operationId);
 const m=await j.prepare(owner,'memory.propose',{kind:'workflow',claim:'Keep paths editable'});
 await assert.rejects(j.execute(owner,m.operationId,async()=>{throw Error('private error content');}));
 const raw=await readFile(path.join(dir,'pending-operations.json'),'utf8');assert.ok(!raw.includes('private error content'));
 const restarted=create(dir);assert.equal((await restarted.list(owner))[0].state,'uncertain');
 await restarted.execute(owner,m.operationId,async record=>({id:record.operationId,status:'validated'}));
});
test('interrupted running records load uncertain and corrupt journal fails closed',async()=>{
 const dir=await directory(),j=create(dir),p=await j.prepare(owner,'backup.export',{});
 const file=path.join(dir,'pending-operations.json'),data=JSON.parse(await readFile(file,'utf8'));data.operations[0].state='running';await writeFile(file,JSON.stringify(data));
 assert.equal((await create(dir).list(owner))[0].state,'uncertain');
 data.operations[0].payload={path:'forbidden'};await writeFile(file,JSON.stringify(data));await assert.rejects(create(dir).list(owner),/INVALID_OPERATION_PARAMS/);
 await writeFile(file,'{malformed private content');await assert.rejects(create(dir).list(owner),/INVALID_OPERATION_JOURNAL/);
});

test('activated portable restore receipt survives restart without replaying restoration',async()=>{
 const dir=await directory(),j=create(dir),p=await j.prepare(owner,'backup.restore',{grantId:'file-grant',expectedCurrentHash:'a'.repeat(64)});
 const result={id:p.operationId,operationId:p.operationId,status:'completed',activated:true,currentHash:'b'.repeat(64),rebuildRequired:['gbd-'+'c'.repeat(64)],modelReplay:false,scope:'profile'};
 assert.deepEqual(await j.execute(owner,p.operationId,async()=>result),result);
 assert.deepEqual(await create(dir).execute(owner,p.operationId,async()=>{throw Error('Already activated restore must not execute twice');}),result);
 const next=await j.prepare(owner,'backup.restore',{grantId:'new-grant',expectedCurrentHash:'c'.repeat(64)});
 await assert.rejects(j.execute(owner,next.operationId,async()=>({...result,rebuildRequired:['C:/private/engine.exe']})),/INVALID_OPERATION_RECEIPT/);
});
