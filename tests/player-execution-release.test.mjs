import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const {build}=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
async function load(name){const result=await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/'+name+'.ts')],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const [{createCraftminePanelGateway},{createCraftmineOperationJournal}]=await Promise.all([load('craftmine-panel-gateway'),load('craftmine-operation-journal')]);
const previousLimits={maxRequests:80,maxCompactions:8,maxTokens:777777,deadlineAt:1};
const limits={...previousLimits,maxRequests:null,maxCompactions:null,deadlineAt:null};
const receipt=operationId=>({kind:'player-execution-limit-release',operationId,binding:{projectId:'p',sessionId:'s',taskId:'old-task',turnId:'t'},taskId:'old-task',generation:1,worldId:'world',previousLimits,limits,budget:{limits,compactionCount:8,actualTokens:5000},exhausted:['COMPACTION_BUDGET_EXHAUSTED'],modelReplay:false,resumed:false});
async function fixture(){
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});const dir=await fs.mkdtemp(path.join(root,'test-results/player-release-'));
  let active=false,selected='world',head='old-task',generation=1,writes=0,saved=null,lose=false;
  const journal=createCraftmineOperationJournal(dir),calls=[];
  const panel=createCraftminePanelGateway({viewingSession:()=> 's',session:async()=>({id:'s'}),activeTurn:()=>active?'running':undefined,
    begin:async()=>{throw Error('Release must not start a model');},end:async()=>{},stop:async()=>{},resume:async()=>{},interrupt:async()=>{},backup:async()=>{},diagnostics:async()=>{},operations:journal,
    domain:async(method,args)=>{calls.push({method,args});
      if(method==='selection.read')return{worldId:selected};
      if(method==='workbench.request')return{context:{binding:{taskId:head},generation}};
      if(method==='budget.findExecutionReleaseReceipt')return saved;
      if(method==='budget.releaseExecutionLimits'){writes++;saved=receipt(args.operationId);if(lose)throw Error('response lost');return saved;}
      throw Error('Unexpected domain request '+method);
    }});
  return{panel,journal,dir,calls,get writes(){return writes;},get saved(){return saved;},set active(x){active=x;},set selected(x){selected=x;},set head(x){head=x;generation++;},set lose(x){lose=x;}};
}
test('release operation is player scoped, audited and never starts a model',async()=>{
  const f=await fixture(),r=await f.panel('task.releaseExecutionLimits',{worldId:'world',taskId:'old-task',generation:1,operationId:'release-operation-1'});
  assert.equal(r.limits.maxTokens,777777);assert.equal(r.budget.compactionCount,8);assert.equal(f.writes,1);
  const args=f.calls.find(x=>x.method==='budget.releaseExecutionLimits').args;
  assert.equal(args.sessionId,'s');assert.equal(args.worldId,'world');assert(!('maxTokens' in args));
  assert.equal((await f.journal.list({projectId:args.projectId,sessionId:'s',worldId:'world'}))[0].state,'completed');
});
test('foreign world, active turn, stale task and caller-supplied policy are denied',async()=>{
  for(const variant of ['world','active','stale','policy','identity']){
    const f=await fixture();if(variant==='active')f.active=true;
    const input={worldId:variant==='world'?'other':'world',taskId:variant==='stale'?'other':'old-task',generation:1,
      ...(variant==='policy'?{maxCompactions:null}:{}),...(variant==='identity'?{sessionId:'forged'}:{})};
    await assert.rejects(f.panel('task.releaseExecutionLimits',input));assert.equal(f.writes,0);
  }
});
test('lost release response can be retrieved after the task resumes without changing its new policy',async()=>{
  const f=await fixture(),input={worldId:'world',taskId:'old-task',generation:1,operationId:'release-operation-2'};f.lose=true;
  await assert.rejects(f.panel('task.releaseExecutionLimits',input),/response lost/);assert.equal(f.writes,1);
  f.head='resumed-task';f.active=true;
  const result=await f.panel('workbench.execute',{worldId:'world',operationId:input.operationId});
  assert.deepEqual(result,f.saved);assert.equal(f.writes,1);
});
test('journal refuses a receipt that changes token budget or pretends to have resumed',async()=>{
  for(const bad of ['token','resumed']){
    const f=await fixture(),owner={projectId:'p',sessionId:'s',worldId:'world'},p=await f.journal.prepare(owner,'task.releaseExecutionLimits',{taskId:'old-task',generation:1});
    const result=receipt(p.operationId);if(bad==='token')result.limits={...limits,maxTokens:null};else result.resumed=true;
    await assert.rejects(f.journal.execute(owner,p.operationId,async()=>result),/INVALID_OPERATION_RECEIPT/);
  }
});
