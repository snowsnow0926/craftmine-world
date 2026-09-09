import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../../../app/scene.mjs';
import {BehaviorSession} from '../../../app/behavior-session.mjs';
import {GameplaySession} from '../../../app/gameplay.mjs';
import {part} from '../../scene-fixtures.mjs';

async function fixture(extensionApply,{commands=null}={}){
  const build=compileScene({format:'craftmine.scene/3',title:'Atomic fixture',night:false,
    systems:[{id:'life',name:'Life',type:'health',source:null,config:{maxHealth:100,fallDamage:0,regenPerSecond:0}}],
    objects:[{id:'target',name:'Target',source:null,position:{x:0,y:6,z:8},components:{health:40,contactDamage:0},parts:[part([0,0,0],[.6,1.5,.6],'#7d9b63','box',true)]}],
    behaviors:[{format:'craftmine.behavior/3',id:'atomic',name:'Atomic',description:'Fixture',code:'export function step({state}) { return {state,commands:[]}; }',stateVersion:1,initialState:{steps:0},params:{},targets:['target'],permissions:['targets.write','health.write','inventory.write','objects.write','hud.message'],capabilities:['inventory.read@1'],requires:['ext:drain@1'],binding:null,keys:['KeyG']}],
  },{extensions:new Set(['ext:drain@1'])});
  const play=new GameplaySession(build.scene.systems,build.scene.objects);play.hurt(80);
  const player={position:{x:0,y:6,z:20},grounded:true},published=[],observed=[];
  const runner={ready:Promise.resolve(),closed:false,dispose(){this.closed=true;},async step(frame,state){return frame.event.type==='key'?{state:{steps:state.steps+1},commands:commands??[{type:'inventory.add',item:'token',count:1},{type:'hud.message',text:'Completed'},{type:'drain.use',targetId:'target',amount:10},{type:'drain.use',targetId:'target',amount:3}]}:{state,commands:[]};}};
  const entry={extensionId:'drain',version:1,permission:'targets.write',permissions:['targets.write','health.write','inventory.write','objects.write'],targets:['target'],capabilities:[],runner:{apply:extensionApply}};
  let session;session=new BehaviorSession(build,null,{gameplay:play.state,extensions:new Map([['drain.use',entry]]),runnerFactory:()=>runner,
    context:()=>({player:{...player,health:play.player.health},objects:session.data.view.objects.map(object=>({id:object.id,position:object.position,visible:object.visible&&play.alive(object.id),solid:session.data.view.primitives.some(p=>p.id===object.id&&p.solid),health:play.state.targets[object.id]?.health??0}))}),
    apply:result=>{published.push(structuredClone(result));for(const effect of result.effects){if(effect.type==='target.damage')play.state.targets[effect.id].health=Math.max(0,play.state.targets[effect.id].health-effect.amount);if(effect.type==='health.add')play.player.health=Math.min(100,Math.max(0,play.player.health+effect.amount));}},onStep:step=>observed.push(step),
  });
  await session.start();published.length=0;observed.length=0;
  return {session,play,player,published,observed,step:()=>session.execute({type:'key',targetId:null,code:'KeyG'},.1,true)};
}

for(const mode of ['throw','invalid-permission','invalid-state'])test(`second extension ${mode} cannot publish a partial reward or damage`,async t=>{
  let calls=0;const f=await fixture(async({command})=>{if(++calls===2){if(mode==='throw')throw Error('Extension failed');if(mode==='invalid-permission')return {state:{},effects:[{type:'player.impulse',velocity:{x:0,y:1,z:0}}]};return {state:[],effects:[]};}return {state:{calls},effects:[{type:'target.damage',id:command.targetId,amount:command.amount},{type:'health.add',amount:7}]};});
  t.after(()=>f.session.dispose());const before=f.session.snapshot();await assert.rejects(f.step());
  const after=f.session.snapshot();assert.ok(after.modules.atomic.error);after.modules.atomic.error='';
  assert.deepEqual(after,before);assert.equal(f.play.player.health,20);assert.equal(f.play.state.targets.target.health,40);
  assert.equal(f.published.length,0);assert.equal(f.observed.length,0);assert.equal(f.session.extensionStates.size,0);
});

test('successful extension batch sees staged state and health then publishes once',async t=>{
  const seen=[];let release,entered;const gate=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>entered=resolve);
  const f=await fixture(async input=>{seen.push(input);if(seen.length===2){entered();await gate;}return {state:{calls:(input.state?.calls??0)+1},effects:[{type:'target.damage',id:'target',amount:input.command.amount},{type:'health.add',amount:7}]};});
  t.after(()=>f.session.dispose());const pending=f.step();await waiting;
  assert.equal(f.session.snapshot().inventory.token,undefined);assert.equal(f.play.player.health,20);assert.equal(f.published.length,0);
  assert.equal(seen[1].state.calls,1);assert.equal(seen[1].world.objects[0].health,30);assert.equal(seen[1].world.player.health,27);
  f.session.data.value.time+=5;release();await pending;
  assert.equal(f.published.length,1);assert.equal(f.session.snapshot().inventory.token,1);assert.equal(f.play.player.health,34);
  assert.equal(f.play.state.targets.target.health,27);assert.equal(f.session.snapshot().time,5);
  assert.deepEqual(f.session.snapshot().modules.atomic.extensions.drain,{version:1,state:{calls:2}});
});

test('moving player into staged geometry during an extension wait rejects the entire step',async t=>{
  let entered,release,calls=0;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const f=await fixture(async()=>{if(++calls===1)return {state:{calls},effects:[{type:'object.patch',id:'target',position:{x:0,y:6,z:14}}]};entered();await gate;return {state:{calls},effects:[]};});
  t.after(()=>f.session.dispose());const before=f.session.snapshot(),pending=f.step();await waiting;
  f.player.position.z=14.2;release();await assert.rejects(pending,/玩家困/);
  const after=f.session.snapshot();after.modules.atomic.error='';assert.deepEqual(after,before);assert.equal(f.published.length,0);
});

test('disposal discards all staged effects and extension state',async()=>{
  let entered,release,calls=0;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const f=await fixture(async()=>{if(++calls===2){entered();await gate;}return {state:{calls},effects:[{type:'health.add',amount:7}]};});
  const before=f.session.snapshot(),pending=f.step();await waiting;f.session.dispose();release();await pending;
  assert.deepEqual(f.session.snapshot(),before);assert.equal(f.play.player.health,20);assert.equal(f.published.length,0);
});
