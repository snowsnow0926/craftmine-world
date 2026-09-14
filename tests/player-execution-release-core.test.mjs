import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire,register} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {PluginRuntime}=await import('../vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts');
const {build}=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const {CoreClient}=require('../desktop/build/craftmine.world/core-client.cjs');
const {createHostRequests}=require('../desktop/build/craftmine.world/host-requests.cjs');
const {createWorkbenchService}=require('../desktop/build/craftmine.world/workbench-service.cjs');
const {emptyWorld}=require('../desktop/build/craftmine.world/domain.cjs');
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const bundleDirectory=await fs.mkdtemp(path.join(root,'test-results/player-execution-bundles-'));
async function load(relative){
  const outfile=path.join(bundleDirectory,path.basename(relative,'.ts')+'.mjs');
  await build({entryPoints:[path.join(root,relative)],bundle:true,platform:'node',format:'esm',outfile});
  return import(pathToFileURL(outfile).href);
}
const [{createCraftminePanelGateway},{createCraftmineOperationJournal},{releaseAndContinueTask}]=await Promise.all([
  load('vendor/pi-desktop/apps/desktop/electron/main/craftmine-panel-gateway.ts'),
  load('vendor/pi-desktop/apps/desktop/electron/main/craftmine-operation-journal.ts'),
  load('vendor/pi-desktop/apps/desktop/src/lib/execution-limit-recovery.ts'),
]);
const binary=process.env.CRAFTMINE_CORE_BIN;
if(!binary)throw Error('CRAFTMINE_CORE_BIN must name the freshly built standalone Core');

async function fixture(t){
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  const out=await fs.mkdtemp(path.join(root,'test-results/player-execution-core-'));
  const core=new CoreClient(binary,path.join(out,'profile'));t.after(()=>core.stop());await core.start();
  const sessionId='player-session',worldId='world',projectId='pi-'+createHash('sha256').update(JSON.stringify(['session',sessionId])).digest('hex');
  const context={projectId,sessionId,turnId:'original-player-turn'},owner={projectId,sessionId,worldId};
  await core.call('world.create',{id:worldId,title:'Player recovery',world:emptyWorld('Player recovery')});
  const workspace=await core.call('workspace.open',{context,selectedWorld:worldId}),binding=workspace.task.binding;
  await core.call('task.recordContext',{context,requestId:'original-goal',kind:'request',text:'Keep the original dog and add another friendly dog'});
  await core.call('budget.reserve',{binding,generation:1,requestId:'original-request',purpose:'creation',estimatedInputTokens:100,maxOutputTokens:100,
    limits:{maxRequests:80,maxCompactions:8,maxTokens:777777,deadlineAt:null}});
  await core.call('budget.settle',{binding,generation:1,requestId:'original-request',status:'known',usage:{inputTokens:100,outputTokens:100,totalTokens:200}});
  for(let n=0;n<8;n++)await core.call('budget.boundary',{binding,generation:1,eventId:'compaction-'+n,kind:'compaction'});
  await core.call('task.interrupt',{context,reason:'COMPACTION_BUDGET_EXHAUSTED'});
  const before=await core.call('task.context',{context});
  const getSettings=async()=>({activeWorldId:worldId});
  const domain=createHostRequests(core,{getSettings,workbench:createWorkbenchService(core,{getSettings})});
  const runtime=new PluginRuntime({});
  const loaded={manifest:{id:'craftmine.world'},pending:new Map(),nextCallId:1,child:{postMessage(message){
    assert.equal(message.method,'lifecycle.craftmineRequest');
    Promise.resolve().then(()=>domain(message.payload.method,message.payload.params)).then(
      value=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:true,value}),
      error=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:false,error:{code:error.code??'CORE_ERROR',message:error.message}}));
  }}};
  runtime.loaded.set('craftmine.world',loaded);
  const transport=(method,args)=>runtime.requestCraftmineHost(method,args);
  let active=false,selected=worldId,viewedSession=sessionId,turn=0,resumes=0,releases=0,loseRelease=false,failLaunch=false;
  let journal=createCraftmineOperationJournal(path.join(out,'operations')),panel;
  function buildPanel(){
    panel=createCraftminePanelGateway({viewingSession:()=>viewedSession,session:async id=>({id}),activeTurn:()=>active?'running':undefined,
      operations:journal,
      domain:async(method,args)=>{
        if(method==='selection.read')return{worldId:selected};
        const result=await transport(method,args);
        if(method==='budget.releaseExecutionLimits'){releases++;if(loseRelease){loseRelease=false;throw Error('TEST_LOST_COMMITTED_RELEASE_REPLY');}}
        return result;
      },
      begin:async()=>{active=true;return 'continued-turn-'+(++turn);},
      end:async()=>{active=false;},stop:async()=>{active=false;},
      resume:async()=>{resumes++;if(failLaunch){failLaunch=false;throw Error('TEST_PROVIDER_LAUNCH_FAILED');}},
      interrupt:(ctx,reason)=>transport('task.interrupt',{context:ctx,reason}),
      backup:async()=>{throw Error('unexpected backup');},diagnostics:async()=>{throw Error('unexpected diagnostics');},
    });
  }
  buildPanel();
  const helper={sessionId,assertSession(){assert.equal(viewedSession,sessionId);assert.equal(active,false);},onReleased(){},
    call:(channel,args)=>channel==='world.list'?Promise.resolve({activeWorldId:selected}):panel(channel,args)};
  async function evidence(error=null){
    const current=await core.call('workspace.current',{projectId,sessionId});
    const facts=await core.call('task.context',{context:{projectId,sessionId,turnId:current.task.binding.turnId}});
    const report={error:error?.message??null,before,current:facts,resumes,releases,operations:await journal.list(owner),out};
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    return report;
  }
  return{core,context,binding,owner,helper,before,out,evidence,get panel(){return panel;},
    get resumes(){return resumes;},get releases(){return releases;},set loseRelease(v){loseRelease=v;},set failLaunch(v){failLaunch=v;},
    restartJournal(){journal=createCraftmineOperationJournal(path.join(out,'operations'));buildPanel();},
    set selected(v){selected=v;},set viewedSession(v){viewedSession=v;}};
}

test('real Core receipt crosses Main journal and UI helper before same-owner continuation',async t=>{
  const f=await fixture(t);
  try{
    const result=await releaseAndContinueTask(f.helper);
    assert.equal(result.continuation,'running');assert.equal(f.releases,1);assert.equal(f.resumes,1);
    const report=await f.evidence();
    assert.equal(report.operations[0].state,'completed');assert(Number.isSafeInteger(report.operations[0].result.createdAt));
    assert.equal(report.current.budget.ownerTaskId,f.before.budget.ownerTaskId);
    assert.equal(report.current.budget.compactionCount,8);assert.equal(report.current.budget.actualTokens,200);
    assert.equal(report.current.budget.limits.maxTokens,777777);assert.equal(report.current.budget.limits.maxCompactions,null);
    assert.equal(report.current.generation,2);
  }catch(error){await f.evidence(error);throw error;}
});

test('lost real release reply survives Main journal restart and exact historical lookup',async t=>{
  const f=await fixture(t);f.loseRelease=true;
  await assert.rejects(releaseAndContinueTask(f.helper),/TEST_LOST_COMMITTED_RELEASE_REPLY/);
  assert.equal(f.releases,1);assert.equal(f.resumes,0);f.restartJournal();
  try{
    assert.equal((await releaseAndContinueTask(f.helper)).continuation,'running');
    assert.equal(f.releases,1);assert.equal(f.resumes,1);
    const report=await f.evidence(),operation=report.operations[0];
    assert.equal(operation.state,'completed');
    assert.deepEqual(await f.core.call('budget.findExecutionReleaseReceipt',{...f.owner,...operation.payload,operationId:operation.operationId}),operation.result);
  }catch(error){await f.evidence(error);throw error;}
});

test('failed continuation launch can retry the recovered uncapped task without a second release',async t=>{
  const f=await fixture(t);f.failLaunch=true;
  try{
    await assert.rejects(releaseAndContinueTask(f.helper),/TEST_PROVIDER_LAUNCH_FAILED/);
    const failed=await f.evidence();
    assert.equal(failed.current.recovery,'interrupted');assert.equal(failed.current.generation,2);
    assert.equal((await releaseAndContinueTask(f.helper)).continuation,'running');
    assert.equal(f.releases,1);assert.equal(f.resumes,2);
    const report=await f.evidence();assert.equal(report.current.generation,3);
    assert.equal(report.current.budget.ownerTaskId,f.before.budget.ownerTaskId);
  }catch(error){await f.evidence(error);throw error;}
});
