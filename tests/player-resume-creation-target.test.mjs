import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import {createCreationTargetService} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-target-service.ts';
import {bindResumedCreationTarget} from '../vendor/pi-desktop/apps/desktop/electron/main/resumed-creation-target.ts';

const root=path.resolve(import.meta.dirname,'..');
const index=fs.readFileSync(path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/index.ts'),'utf8');
const start=index.indexOf('  resume: async (session, turnId, result) => {',index.indexOf('const craftminePanelRequest ='));
const end=index.indexOf('\n  backup:',start);
assert(start>0&&end>start,'actual Main player-resume callback must be present');
const callback=stripTypeScriptTypes('({'+index.slice(start,end)+'})',{mode:'transform'});
const original={projectId:'project',sessionId:'session',turnId:'interrupted-turn'},context={...original,turnId:'player-resume'};

async function fixture(){
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'test-results/resumed-creation-target-'));
  const state={fullAuto:true,selected:'world',active:context.turnId,prompts:0,reads:0,readOverride:null,afterSample:null};
  const instance={worldId:'world',buildId:'formal-build',instanceId:'runtime'};
  const deps={directory,selection:async()=>state.selected,instance:()=>instance,
    descriptor:async()=>({...instance,baseId:'creation-sandbox',sourceRevision:3,manifestHash:'a'.repeat(64)}),
    sample:async()=>{await state.afterSample?.();return {...instance,baseId:'creation-sandbox',sampledAt:new Date().toISOString(),payload:{player:{position:[0,1,6]}}};},
    fullAuto:async()=>state.fullAuto};
  const targets=createCreationTargetService(deps),old=await targets.bindWorld(original,'world','Keep the authored dog');
  targets.cancel(original.sessionId,original.turnId);
  const binding={...context,taskId:'new-task',baseBuild:'formal-build'};
  const facts={binding,world:{id:'world',runtimeKind:'godot'},generation:2,status:'running',recovery:'none',lease:{owned:true},budget:{ownerTaskId:'old-task'}};
  const result={workspace:{worldId:'world',resumedFrom:'old-task',task:{binding}},generation:2,budget:{ownerTaskId:'old-task'}};
  const globals={bindResumedCreationTarget,creationTargets:targets,crypto:webcrypto,Date,Error,
    craftmineProjectIdentity:()=>original.projectId,activeTurns:{get:()=>state.active},turnFinalizations:new Map(),godotSelection:async()=>state.selected,
    plugins:{requestCraftmineHost:async(method)=>{assert.equal(method,'task.context');state.reads++;return state.readOverride??facts;}},
    craftmineGateway:{bind(){}},host:{call:async method=>{assert(['session.appendMessage','settings.get'].includes(method));return {}; }},
    resolveAgentRuntimeLaunch:async()=>({projectPath:null,sidecarParams:{}}),sendToRenderer(){},IPC:{event:{agentMessage:'event'}},
    sidecar:{setProjectInstructionRoot(){},call:async method=>{
      assert.equal(method,'agent.prompt');state.prompts++;
      assert(targets.owned(context),'capture must be present before the actual prompt launch');
      assert.equal(targets.owned(context).autoApply,state.fullAuto);
    }},
  };
  const resume=vm.runInNewContext(callback,globals).resume;
  return{state,targets,old,result,facts,globals,resume:()=>resume({id:context.sessionId},context.turnId,result)};
}

test('actual player-resume callback captures new full-auto authority before model launch without resurrecting cancelled repair',async()=>{
  const f=await fixture();await f.resume();
  const bound=f.targets.owned(context);
  assert.equal(f.state.prompts,1);assert.equal(bound.authorization,'full-auto');assert.equal(bound.autoApply,true);
  assert.notEqual(bound.snapshotId,f.old.snapshotId);assert.equal(f.targets.owned(original).autoApply,false);
  assert.deepEqual(bound.target,{entityId:null,position:null,normal:null,surface:'none',revision:0});
  await assert.rejects(f.targets.bindContinuation({...original,turnId:'automatic-late-repair'},original,'world'),/NOT_AUTHORIZED/);
});

test('manual player recovery never inherits the interrupted full-auto capture',async()=>{
  const f=await fixture();f.state.fullAuto=false;await f.resume();
  assert.equal(f.state.prompts,1);assert.equal(f.targets.owned(context).autoApply,false);
  assert.equal(f.targets.owned(context).authorization,'world-policy');assert.equal(f.targets.owned(original).autoApply,false);
});

test('foreign task, world, generation, recovery or lease refuses before model and capture',async()=>{
  for(const mutate of [f=>f.result.workspace.task.binding.sessionId='foreign',f=>f.result.generation=3,
    f=>f.facts.world.id='foreign',f=>f.facts.recovery='interrupted',f=>f.facts.lease.owned=false,
    f=>f.result.workspace.resumedFrom=null,f=>f.result.budget.ownerTaskId='foreign',f=>f.state.selected='other',f=>f.state.active='other']){
    const f=await fixture();mutate(f);await assert.rejects(f.resume(),/CREATION_RECOVERY_/);
    assert.equal(f.state.prompts,0);assert.equal(f.targets.owned(context),null);
  }
});

test('cancellation or generation change during sampling never leaves usable new auto authority',async()=>{
  for(const mode of ['cancel','generation','world']){
    const f=await fixture();f.state.afterSample=async()=>{
      if(mode==='cancel')f.targets.cancel(context.sessionId,context.turnId);
      if(mode==='generation')f.facts.generation=3;
      if(mode==='world')f.state.selected='other';
    };
    await assert.rejects(f.resume());assert.equal(f.state.prompts,0);
    assert.notEqual(f.targets.owned(context)?.autoApply,true);assert.equal(f.targets.owned(original).autoApply,false);
  }
});

test('legacy player resume keeps its existing application path without requiring a Godot capture',async()=>{
  const f=await fixture();f.facts.world.runtimeKind='legacy';
  f.globals.sidecar.call=async()=>{f.state.prompts++;assert.equal(f.targets.owned(context),null);};
  await f.resume();assert.equal(f.state.prompts,1);
});
