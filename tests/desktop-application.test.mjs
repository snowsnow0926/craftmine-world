import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {compileScene,INITIAL_SNAPSHOT} from '../app/scene.mjs';
import {BehaviorState} from '../app/behavior-state.mjs';
import {GameplaySession} from '../app/gameplay.mjs';
import {behaviorScene,doorBehavior} from './behavior-fixtures.mjs';
import {prepareApplication,parseReview} from '../plugins/craftmine-world/domain-adapter.mjs';
const {createApplications}=createRequire(import.meta.url)('../desktop/build/craftmine.world/applications.cjs');

function scenario(change={}){
  const scene=behaviorScene();scene.behaviors=[doorBehavior()];
  const build=compileScene(scene);build.id='v-'+build.hash.slice(0,20);
  const gameplay=new GameplaySession(scene.systems,scene.objects),state=new BehaviorState(build,null,gameplay.state).snapshot();
  state.inventory.crystal=7;state.modules['sliding-door'].state.open=true;
  const snapshot={format:'craftmine.progress/3',player:{...INITIAL_SNAPSHOT.player,x:12},gameplay:gameplay.snapshot(),behaviors:state};
  const next=compileScene({...scene,behaviors:[{...doorBehavior(),...change}]});next.id='v-'+next.hash.slice(0,20);
  return {record:{id:'world',revision:7,world:{build,snapshot,extensions:[]}},job:{status:'passed',current:true,input:{worldId:'world',binding:{baseBuild:build.id}},output:{artifact:{build:next}}}};
}

test('application migrates latest compatible state without executing authored startup effects',()=>{
  const {record,job}=scenario({code:'globalThis.__unexpectedStartup=true; '+doorBehavior().code});
  const previous=structuredClone(record);
  const prepared=prepareApplication(job,record);
  assert.deepEqual(prepared.snapshot.player,record.world.snapshot.player);
  assert.equal(prepared.snapshot.behaviors.inventory.crystal,7);
  assert.equal(prepared.snapshot.behaviors.modules['sliding-door'].state.open,true);
  assert.equal(globalThis.__unexpectedStartup,undefined);
  assert.deepEqual(record,previous);
});

test('missing state migration and collision from saved overrides preserve the original world',()=>{
  const missing=scenario({stateVersion:2,initialState:{open:false,cooldown:0}});
  assert.throws(()=>prepareApplication(missing.job,missing.record),/migrate/);
  const declared=scenario({stateVersion:2,initialState:{open:false,cooldown:0},migrate:[{from:1,keep:['open'],add:{cooldown:3}}]});
  const changed=prepareApplication(declared.job,declared.record);
  assert.deepEqual(changed.snapshot.behaviors.modules['sliding-door'].state,{open:true,cooldown:3});
  const collision=scenario();
  const door=collision.record.world.build.scene.objects.find(o=>o.id==='door-one'),p=collision.record.world.snapshot.player;
  collision.record.world.snapshot.behaviors.modules['sliding-door'].overrides['door-one']={offset:{x:p.x-door.position.x,y:p.y-door.position.y,z:p.z-door.position.z},visible:true,solid:true,color:null};
  const previous=structuredClone(collision.record);
  assert.throws(()=>prepareApplication(collision.job,collision.record),/当前位置重叠/);
  assert.deepEqual(collision.record,previous);
});

test('review accepts an advisory block but rejects empty claims, unknown steps and simulated tool transcripts',()=>{
  const plan={summary:'建议仅供参考',verdict:'block',suggestions:['可以换颜色'],limitations:['未检查美术'],steps:[],assertions:[
    {id:'errors',kind:'noErrors',why:'能运行',red:'运行报错'},{id:'new',kind:'newObjects',min:1,why:'新增对象',red:'空实现'}]};
  assert.equal(parseReview({modelKey:'fixture/model',text:'```json\n'+JSON.stringify(plan)+'\n```'}).verdict,'block');
  assert.throws(()=>parseReview({text:JSON.stringify({...plan,assertions:[plan.assertions[0]]})}),/EFFECT_ASSERTION/);
  assert.throws(()=>parseReview({text:JSON.stringify({...plan,assertions:[plan.assertions[0],{...plan.assertions[1],step:'imaginary'}]})}),/STEP_MISSING/);
  assert.throws(()=>parseReview({text:JSON.stringify(plan)+'\n<result>passed</result>\n'+JSON.stringify(plan)}));
});

test('a lost commit reply recovers its receipt without applying twice or accepting a different request',async()=>{
  const {record,job}=scenario();let current=record,receipt,loads=0,commits=0,release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  // Transport/storage fixture: Rust atomicity is covered by the Rust transaction tests.
  const core={call:async(method,args)=>{
    if(method==='world.read')return current;
    if(method==='verification.read')return job;
    if(method==='application.read'){if(!receipt)throw Error('APPLICATION_NOT_FOUND');return receipt;}
    if(method==='application.prepare'){
      receipt={id:args.id,status:'prepared',input:args,inputHash:'fixture-input'};return receipt;
    }
    if(method==='application.commit'){
      commits++;receipt.status='applied';current={...record,revision:record.revision+1,world:prepareApplication(job,record)};
      throw Error('INJECTED_REPLY_LOSS_AFTER_COMMIT');
    }
    throw Error('Unexpected fixture call: '+method);
  }};
  const applications=createApplications(core,{verify:async()=>{
    loads++;entered();await new Promise(resolve=>{release=resolve;});return {render:{passed:true}};
  }});
  const args={operationId:randomUUID(),worldId:record.id,revision:record.revision,verificationId:'fixture-check',reviewId:'fixture-review'};
  const applying=applications.apply(args);await started;
  await assert.rejects(applications.apply({...args,reviewId:'different-review'}),/REPLAY_MISMATCH/);
  await assert.rejects(applications.apply({...args,acknowledgeReviewWarnings:true}),/REPLAY_MISMATCH/);
  release();assert.equal((await applying).status,'applied');
  current.world.snapshot.player.x=14;current.revision++;
  const recovered=await applications.apply(args);
  assert.equal(recovered.record.world.snapshot.player.x,14);
  await assert.rejects(applications.apply({...args,revision:args.revision+1}),/REPLAY_MISMATCH/);
  await assert.rejects(applications.apply({...args,acknowledgeReviewWarnings:true}),/REPLAY_MISMATCH/);
  await assert.rejects(applications.apply({...args,acknowledgeReviewWarnings:'true'}),/INVALID_REVIEW_ACKNOWLEDGEMENT/);
  assert.equal(loads,1);assert.equal(commits,1);
});
