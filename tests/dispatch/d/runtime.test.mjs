import test from 'node:test';
import assert from 'node:assert/strict';
import {GameplaySession,validateGameplayState} from '../../../app/gameplay.mjs';
import {BehaviorSession} from '../../../app/behavior-session.mjs';
import {BehaviorState,validateBehaviorState} from '../../../app/behavior-state.mjs';
import {compileScene} from '../../../app/scene.mjs';
import {materializeCreation} from '../../../app/creation.mjs';
import {createExtensionTable,disposeExtensionTable} from '../../../app/extension-runtime.mjs';
import {validateExtensionResult} from '../../../app/harness/extension-effects.mjs';
import {stageExtension} from '../../../app/harness/extension-loader.mjs';
import {validateRequestStep} from '../../../app/request-plan.mjs';
import {packages} from '../../../examples/dispatch-d/build-packages.mjs';
import {trainingScene,drainExtension} from '../../../examples/dispatch-d/content.mjs';
const loaded=new Set(['ext:training-drain@1']);
// Contract tests execute authored fixture source in-process. The separate
// headless suite verifies the same code in actual restricted browser Workers.
const runner=definition=>{
  const implementation=import('data:text/javascript,'+encodeURIComponent(definition.code));
  return {ready:implementation,closed:false,async step(frame,state){return (await implementation).step({frame,state,params:definition.params});},dispose(){this.closed=true;}};
};
const extRunner=extension=>{
  const implementation=import('data:text/javascript,'+encodeURIComponent(extension.code));
  return {ready:implementation,async apply(input){return validateExtensionResult(await (await implementation).apply(input),extension,input.world);},dispose(){}};
};
async function session(build,saved=null,gameplay=null){
  const play=new GameplaySession(build.scene.systems,build.scene.objects,gameplay),extensions=await createExtensionTable([drainExtension()],{runnerFactory:extRunner});
  let behavior;
  behavior=new BehaviorSession(build,saved,{gameplay:play.state,extensions,runnerFactory:runner,context:()=>({player:{position:{x:0,y:6,z:14},health:play.player.health,grounded:true},objects:behavior.data.view.objects.map(o=>({id:o.id,position:o.position,visible:o.visible,solid:false,health:play.state.targets[o.id]?.health||0}))}),apply:({effects})=>{for(const effect of effects){if(effect.type==='target.damage')play.state.targets[effect.id].health-=effect.amount;if(effect.type==='health.add')play.player.health=Math.min(100,play.player.health+effect.amount);}}});
  await behavior.start();return {behavior,play,close(){behavior.dispose();disposeExtensionTable(extensions);}};
}
test('startup rewards and extension state survive restart and compatible migration',async()=>{
  const build=compileScene(trainingScene(),{extensions:loaded});const first=await session(build);first.play.hurt(50);
  await first.behavior.execute({type:'key',targetId:null,code:'KeyG'},.1,true);
  assert.equal(first.play.player.health,60);assert.equal(first.behavior.snapshot().inventory['training-token'],1);
  const saved=first.behavior.snapshot(),gameplay=first.play.snapshot();first.close();
  const restored=await session(build,saved,gameplay);await restored.behavior.start();
  assert.equal(restored.behavior.snapshot().inventory['training-token'],1);
  await restored.behavior.execute({type:'key',targetId:null,code:'KeyG'},.1,true);
  assert.equal(restored.behavior.snapshot().modules['training-drain-key'].extensions['training-drain'].state.calls,2);
  assert.equal(restored.play.player.health,70);restored.close();
  const changed=trainingScene();changed.behaviors[0].stateVersion=2;changed.behaviors[0].initialState={rewarded:false};changed.behaviors[0].migrate=[{from:1,rename:{claimed:'rewarded'}}];
  const migrated=new BehaviorState(compileScene(changed,{extensions:loaded}),saved,gameplay);
  assert.equal(migrated.snapshot().modules['training-rewards'].initialized,true);
  assert.deepEqual(migrated.snapshot().modules['training-rewards'].state,{rewarded:false});
  delete changed.behaviors[0].migrate;assert.throws(()=>new BehaviorState(compileScene(changed,{extensions:loaded}),saved,gameplay),/迁移/);
  assert.deepEqual(saved.inventory,{'training-token':1});
});
test('new module installation has independent lifecycle and extension bindings',async()=>{
  const module=packages().modules.find(m=>m.kind==='creation');
  const scene=materializeCreation(module.payload,{id:module.id,version:module.version},{x:5,y:6,z:10},'garden-second');
  const run=await session(compileScene(scene,{extensions:loaded}));run.play.hurt(50);
  await run.behavior.execute({type:'key',targetId:null,code:'KeyG'},.1,true);
  assert.equal(run.play.player.health,60);assert.equal(run.play.state.targets['garden-second-o3'].health,50);
  const state=run.behavior.snapshot();assert.equal(state.modules['garden-second-b1'].extensions['training-drain'].state.calls,1);
  assert.equal(state.inventory['training-token'],1);run.close();
});
test('old saves never replay start and reject incompatible extension state',()=>{
  const build=compileScene(trainingScene(),{extensions:loaded}),old=new BehaviorState(build,null).snapshot();
  for(const module of Object.values(old.modules)){delete module.initialized;delete module.extensions;}
  const restored=new BehaviorState(build,old);assert.equal(restored.snapshot().modules['training-rewards'].initialized,true);
  old.modules['training-drain-key'].extensions={'training-drain':{version:2,state:{}}};
  assert.throws(()=>new BehaviorState(build,old),/不兼容/);
  old.modules['training-drain-key'].extensions={'training-drain':{version:1,state:{bad:Infinity}}};assert.throws(()=>validateBehaviorState(old),/非有限/);
});
test('combat cooldown, reload, actual damage and death survive persistence',()=>{
  const scene=trainingScene(),play=new GameplaySession(scene.systems,scene.objects);
  assert.equal(play.attack({id:'training-target',distance:5}).damage,20);
  const restored=new GameplaySession(scene.systems,scene.objects,play.snapshot());
  assert.equal(restored.attack({id:'training-target',distance:5}).fired,false);
  restored.tick(.2);restored.equip('melee');assert.equal(restored.attack({id:'training-target',distance:5}).damage,0);
  restored.tick(.3);assert.equal(restored.attack({id:'training-target',distance:1}).damage,25);
  restored.tick(.3);assert.equal(restored.attack({id:'training-target',distance:1}).damage,15);
  restored.equip('ranged');restored.tick(.3);restored.attack(null);restored.tick(.2);restored.attack(null);restored.tick(.2);
  assert.equal(restored.attack(null).fired,false);assert.equal(restored.reload(),true);restored.tick(.1);
  const reload=new GameplaySession(scene.systems,scene.objects,restored.snapshot());assert.ok(reload.state.systems['ranged-system'].reloadRemaining>0);reload.tick(.4);assert.equal(reload.state.systems['ranged-system'].ammo,3);
  reload.hurt(100);assert.equal(reload.dead,true);assert.equal(reload.attack(null).fired,false);assert.equal(reload.reload(),false);reload.revive();assert.equal(reload.player.health,100);
  for(const distance of [-1,NaN,Infinity])assert.throws(()=>reload.attack({id:'training-target',distance}),/命中/);
  for(const dt of [-1,NaN,Infinity])assert.throws(()=>reload.tick(dt));
  assert.throws(()=>validateGameplayState({...reload.snapshot(),cooldown:NaN}));
});
test('review assertions execute against real fixture traces but severity remains advisory',async()=>{
  const result=await stageExtension(drainExtension(),{createRunner:extRunner,verifyWorld:async()=>({passed:true}),review:async()=>({blocked:true,summary:'Consider a different damage balance',findings:[{claim:'The target should retain health',severity:'blocker'}],assertions:[{id:'advice',kind:'objectHealth',object:'training-target',exact:5,why:'Suggested balance',red:'Current authored damage'}]})});
  assert.equal(result.status,'ready');assert.equal(result.reviewExecution.ran,true);assert.equal(result.reviewExecution.passed,false);assert.equal(result.selfTests.results[0].noop.passed,false);
});
test('failed extension initialization and asynchronous dispose cannot reject unhandled',async()=>{
  const extension=drainExtension();await assert.rejects(createExtensionTable([extension],{runnerFactory:()=>({ready:Promise.reject(Error('load failed')),dispose:()=>Promise.reject(Error('closed'))})}),/load failed/);
  disposeExtensionTable(new Map([['x',{runner:{dispose:()=>Promise.reject(Error('closed'))}}]]));
  await new Promise(resolve=>setImmediate(resolve));
});
test('combat request validation is bounded and data-only',()=>{
  assert.doesNotThrow(()=>validateRequestStep({label:'aim',event:{type:'attack'},player:{x:0,y:6,z:8,yaw:0,pitch:0}}));
  assert.doesNotThrow(()=>validateRequestStep({label:'equip',event:{type:'equip',weapon:'melee'}}));
  assert.doesNotThrow(()=>validateRequestStep({label:'reload',event:{type:'reload'}}));
  assert.throws(()=>validateRequestStep({label:'bad',event:{type:'reload',weapon:'melee'}}));
  assert.throws(()=>validateRequestStep({label:'bad',event:{type:'attack'},player:{x:0,y:6,z:8,pitch:99}}));
});
