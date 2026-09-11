import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPromoWishPlan,nextWishStep,PROMO_GROUP_IDS} from './helpers/promo-wish-plan.mjs';
import {parseOptions} from '../scripts/prepare-promo-wishes.mjs';

const cli=fileURLToPath(new URL('../scripts/prepare-promo-wishes.mjs',import.meta.url));
test('six independent groups start with no fabricated evidence or model authorization',()=>{
  const plan=createPromoWishPlan();
  assert.deepEqual(plan.stories.map(item=>item.id),PROMO_GROUP_IDS);
  assert.equal(new Set(plan.stories.map(item=>item.worldGroup)).size,6);
  assert.equal(plan.preparation.liveAdapterImplemented,false);
  assert.equal(plan.preparation.modelRequests,0);
  assert.equal(plan.packageIdentity,null);
  assert.equal(plan.budget.authorized,false);
  for(const item of plan.stories.flatMap(story=>story.steps)){
    assert.equal(item.outcome,'NOT_RUN');assert.equal(item.requestAttempts,null);
    assert.equal(item.visualReview,'pending');assert.ok(Object.values(item.evidence).every(value=>value===null));
  }
});
test('mainline is one world and does not splice independent scenario results',()=>{
  const plan=createPromoWishPlan({suite:'mainline'});
  assert.equal(plan.stories.length,1);
  assert.deepEqual(plan.stories[0].steps.map(item=>item.id),['ENTER01','ENV01','ENV02','PET01','PET03','COM01','COM02','COM03','COM04','COM05','A-REOPEN']);
  assert.ok(!plan.stories[0].steps.some(item=>item.id==='PET02'));
  assert.throws(()=>createPromoWishPlan({suite:'mainline',selected:['pet']}),/MAINLINE_CANNOT_BE_SLICED/);
});
test('same seed gives stable prompts and subset-independent follow-up choices',()=>{
  const whole=createPromoWishPlan({seed:0});
  assert.deepEqual(whole,createPromoWishPlan({seed:0}));
  assert.deepEqual(whole.stories.find(item=>item.id==='pet'),createPromoWishPlan({seed:0,selected:['pet']}).stories[0]);
  const choices=new Set(Array.from({length:16},(_,seed)=>createPromoWishPlan({seed,selected:['pet']}).stories[0].optionalFollowUp.text));
  assert.equal(choices.size,2);
});
test('plan objects never share mutable scenario or evidence data',()=>{
  const a=createPromoWishPlan();a.stories[0].steps[0].observe.push('leaked');a.stories[0].steps[0].evidence.check=true;
  const b=createPromoWishPlan();assert.ok(!b.stories[0].steps[0].observe.includes('leaked'));assert.equal(b.stories[0].steps[0].evidence.check,null);
});
test('reject invalid suites, selections, duplicate groups and seeds',()=>{
  for(const options of [{suite:'live'},{selected:[]},{selected:['pet','pet']},{selected:['dog']},{selected:'pet'},{seed:-1},{seed:1.2},{seed:2**32},{seed:NaN},{seed:'2'}])assert.throws(()=>createPromoWishPlan(options));
});
test('failure blocks its own story but not another independent world',()=>{
  const plan=createPromoWishPlan();
  assert.deepEqual(nextWishStep(plan,'pet',{PET01:'FAIL'}),{status:'DEPENDENCY_BLOCKED',stepId:'PET01',result:'FAIL'});
  assert.deepEqual(nextWishStep(plan,'rain',{PET01:'FAIL'}),{status:'PENDING',stepId:'RAIN01'});
  assert.deepEqual(nextWishStep(plan,'pet',{PET01:'PASS'}),{status:'PENDING',stepId:'PET02'});
});
test('even a completed supplied checklist cannot issue an automatic pass',()=>{
  const plan=createPromoWishPlan({selected:['pet']});
  const results=Object.fromEntries(plan.stories[0].steps.map(item=>[item.id,'PASS']));
  assert.deepEqual(nextWishStep(plan,'pet',results),{status:'REVIEW_REQUIRED',stepId:null});
  assert.throws(()=>nextWishStep(plan,'missing'));
});
test('CLI rejects live flags, duplicated switches, malformed seeds and missing values',()=>{
  for(const args of [['--live'],['--plan','--plan'],['--seed'],['--seed','--out'],['--seed','1e3'],['--cases','']])assert.throws(()=>parseOptions(args));
  assert.deepEqual(parseOptions(['--seed','0','--cases','pet,rain']),{seed:0,selected:['pet','rain']});
});
test('CLI prints a plan without credentials or a repository checkout',()=>{
  const result=spawnSync(process.execPath,[cli,'--plan','--cases','pet'],{cwd:os.tmpdir(),encoding:'utf8',env:{...process.env,CRAFTMINE_LIVE_CONFIG:'/nonexistent/not-read.json'}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).stories[0].id,'pet');
});
test('CLI writes only a new directory and refuses to overwrite an old run',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'promo-plan-'));
  try{
    const out=path.join(root,'run');
    const run=()=>spawnSync(process.execPath,[cli,'--out',out],{encoding:'utf8'});
    assert.equal(run().status,0);
    const bytes=fs.readFileSync(path.join(out,'plan.json'));
    assert.equal(run().status,1);
    assert.deepEqual(fs.readFileSync(path.join(out,'plan.json')),bytes);
    assert.deepEqual(fs.readdirSync(out).sort(),['README.zh-CN.md','plan.json']);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
