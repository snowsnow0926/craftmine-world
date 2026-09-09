import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {flower} from './scene-fixtures.mjs';

const require=createRequire(import.meta.url);
const {createVerificationJobs}=require('../desktop/build/craftmine.world/verification-jobs.cjs');
const {emptyWorld,compileVerification}=require('../desktop/build/craftmine.world/domain.cjs');
const input=()=>{
  const world=emptyWorld('Verifier transport fixture');
  return {world,draft:{scene:{...structuredClone(world.build.scene),objects:[flower('test-flower',3,4)]}}};
};

test('failed native cancellation cannot prevent stopping a job or persist late success',{timeout:5000},async()=>{
  let started,release,finishes=0;
  const ready=new Promise(resolve=>{started=resolve;});
  const result=new Promise(resolve=>{release=resolve;});
  const core={call:async method=>{
    if(method==='verification.claim')return {inputHash:'fixture',input:input()};
    if(method==='verification.finish')finishes++;
  }};
  const jobs=createVerificationJobs(core,{verify:async()=>{started();return result;},cancelVerification:async()=>{throw Error('INJECTED_CANCEL_TRANSPORT_FAILURE');}});
  const context={sessionId:'fixture-session',turnId:'fixture-turn'};
  jobs.enqueue({id:'fixture-job',status:'queued'},context);await ready;
  await assert.doesNotReject(jobs.cancelTurn(context));
  release({behaviors:{passed:true},render:{passed:true}});
  await jobs.stop();assert.equal(finishes,0);
});

test('the bundled desktop parser validates module syntax without executing top-level code',()=>{
  const data=input();
  const behavior={format:'craftmine.behavior/2',id:'syntax-probe',name:'Syntax probe',description:'Parser only',
    code:'globalThis.__craftmineSyntaxProbe=true; export function step({state}){return {state,commands:[]};}',
    stateVersion:1,initialState:{},params:{},targets:['test-flower'],permissions:[],requires:[],binding:null,keys:[]};
  data.draft.scene.behaviors=[behavior];
  assert.equal(compileVerification(data).build.behaviors.length,1);
  assert.equal(globalThis.__craftmineSyntaxProbe,undefined);
  behavior.code='export function step( {';
  assert.throws(()=>compileVerification(data),/语法错误/);
});
