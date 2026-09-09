import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir} from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),{build}=createRequire(new URL('../../vendor/pi-desktop/packages/agent-runtime/package.json',import.meta.url))('esbuild');
async function load(name){const b=await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/'+name+'.ts')],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {createCraftminePanelGateway}=await load('craftmine-panel-gateway'),{createCraftmineOperationJournal}=await load('craftmine-operation-journal');
await mkdir(path.join(root,'test-results'),{recursive:true});
test('actual gateway and filesystem journal bind replay to Main session/world and original args',async()=>{
 const dir=await mkdtemp(path.join(root,'test-results/batch07-gateway-'));let world='world',session='session',begins=0,writes=0;const receipts=new Map();
 const options={viewingSession:()=>session,session:async id=>({id}),activeTurn:()=>undefined,begin:async()=>{begins++;return 'turn-'+begins;},end:async()=>{},stop:async()=>{},resume:async()=>{},interrupt:async()=>{},diagnostics:async()=>({}),backup:async()=>({}),domain:async(method,args)=>{
  if(method==='selection.read')return {worldId:world};if(method==='turn.begin')return {};
  if(method==='workbench.request'){
   if(args.channel==='task.current')return {context:{binding:{taskId:'task',turnId:'turn'},generation:1,status:'finished',draft:{revision:3,hash:'b'.repeat(64)}}};
   if(args.channel==='workbench.prepareAction')return receipts.get(args.payload.payload.operationId)||null;
   if(args.channel==='library.install'){writes++;const result={receipt:{revision:4},applied:false};receipts.set(args.payload.operationId,result);assert.equal(args.host.sessionId,'session');assert.equal(args.payload.revision,3);throw Error('reply lost after real fixture effect');}
  }throw Error('Unsupported fixture request');
 }};
 let panel=createCraftminePanelGateway({...options,operations:createCraftmineOperationJournal(dir)});
 const payload={ref:{id:'tree',version:1,hash:'a'.repeat(64)},revision:3};
 const intent=await panel('workbench.prepare',{worldId:world,channel:'library.install',payload});
 await assert.rejects(panel('workbench.execute',{worldId:world,operationId:intent.operationId}),/reply lost/);
 panel=createCraftminePanelGateway({...options,operations:createCraftmineOperationJournal(dir)});
 assert.equal((await panel('workbench.operations',{worldId:world})).items.length,1);
 session='other';assert.deepEqual((await panel('workbench.operations',{worldId:world})).items,[]);await assert.rejects(panel('workbench.execute',{worldId:world,operationId:intent.operationId}),/OWNER_MISMATCH/);
 session='session';world='other';await assert.rejects(panel('workbench.execute',{worldId:world,operationId:intent.operationId}),/OWNER_MISMATCH/);world='world';
 await assert.rejects(panel('library.install',{worldId:world,operationId:intent.operationId,...payload,position:{x:1,y:6,z:0}}),/REPLAY_MISMATCH/);
 await assert.rejects(panel('workbench.prepare',{worldId:world,channel:'memory.propose',payload:{kind:'project-rule',claim:'rule',sessionId:'injected'}}),/INVALID_OPERATION_PARAMS/);
 await assert.rejects(panel('workbench.execute',{worldId:world,operationId:intent.operationId,host:{sessionId:'injected'}}),/HOST_IDENTITY/);
 assert.equal((await panel('workbench.execute',{worldId:world,operationId:intent.operationId})).receipt.revision,4);assert.equal(writes,1);assert.equal(begins,1);
});
test('backup restart resolves actual receipt before expired grant and stale recheck never creates a turn',async()=>{
 const dir=await mkdtemp(path.join(root,'test-results/batch07-gateway-'));let status='completed',restores=0,begins=0,rechecks=0,budgets=0;
 const task={binding:{taskId:'task',turnId:'turn'},generation:1,status:'finished',draft:{revision:3,hash:'b'.repeat(64)}};
 const panel=createCraftminePanelGateway({operations:createCraftmineOperationJournal(dir),viewingSession:()=> 'session',session:async()=>({id:'session'}),activeTurn:()=>undefined,begin:async()=>{begins++;return 'bad';},end:async()=>{},stop:async()=>{},resume:async()=>{},interrupt:async()=>{},diagnostics:async()=>({}),backup:async(channel)=>{if(channel==='backup.status')return {status,currentHash:'c'.repeat(64)};restores++;throw Error('EXPIRED_GRANT');},domain:async(method,args)=>{
  if(method==='selection.read')return {worldId:'world'};
  if(method==='budget.configure'){budgets++;assert.equal(args.sessionId,'session');return {operationId:args.operationId,budget:{limits:{maxTokens:args.maxTokens}}};}
  if(args.channel==='task.current')return {context:task};if(args.channel==='draft.recheck'){rechecks++;assert.equal(args.host.context.turnId,'turn');return {verificationId:'actual-fixture',status:'queued'};}throw Error('Unsupported fixture request');
 }});
 const p=await panel('workbench.prepare',{worldId:'world',channel:'backup.restore',payload:{grantId:'opaque-grant',expectedCurrentHash:'a'.repeat(64)}});
 assert.equal((await panel('workbench.execute',{worldId:'world',operationId:p.operationId})).status,'completed');assert.equal(restores,0);
 await panel('workbench.acknowledge',{worldId:'world',operationId:p.operationId});status='missing';
 await assert.rejects(panel('backup.restore',{worldId:'world',operationId:'another-restore',grantId:'expired-grant',expectedCurrentHash:'a'.repeat(64)}),/EXPIRED_GRANT/);assert.equal(restores,1);
 await assert.rejects(panel('draft.recheck',{worldId:'world',operationId:'recheck-stale',taskId:'task',generation:1,revision:2,draftHash:'b'.repeat(64)}),/STALE_DRAFT/);
 await panel('draft.recheck',{worldId:'world',operationId:'recheck-current',taskId:'task',generation:1,revision:3,draftHash:'b'.repeat(64)});
 await panel('task.budget',{worldId:'world',operationId:'budget-unlimited',taskId:'task',generation:1,maxTokens:null});
 assert.equal(rechecks,1);assert.equal(budgets,1);assert.equal(begins,0);
});
