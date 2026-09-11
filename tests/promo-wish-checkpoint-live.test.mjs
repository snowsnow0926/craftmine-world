import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileProof} from './helpers/promo-checkpoint-contract.mjs';
import {CHECKPOINT_A05,parseCheckpointLiveArgs,inspectCheckpointLive,checkpointBudget,checkpointA05Plan,checkpointPoll,checkpointSanitizer,checkpointRecoverySignal} from './helpers/promo-checkpoint-live-contract.mjs';

function fixture(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-live-contract-')),out=path.join(base,'test-results','desktop-native-restored'),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(legacySource);
 const put=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
 const marker=path.join(profile,'headless-profile.json');put(marker,{format:'craftmine.headless-profile/1',token:'fixture-token-only',legacySource});
 const pilot=path.join(base,'old-pilot.json'),oldLedger=path.join(base,'old-budget.json'),oldMarker=path.join(base,'old-marker.json');
 put(pilot,{format:'craftmine.promo-pilot/1',model:'deepseek-flash'});put(oldLedger,{limit:10,requests:Array.from({length:10},(_,i)=>String(i))});put(oldMarker,{format:'test-proof-only'});
 const restored={format:'craftmine.promo-checkpoint/1',phase:'restore',ok:true,trialKind:'checkpoint-derived',modelRequestsAdded:0,originalEvidenceUnchanged:true,
  newProfile:{root:out,profile,markerSha256:fileProof(marker).sha256},checkpoint:{worldId:'same-dog',buildId:'frozen-build'},packageIdentity:{packaged:path.join(base,'not-launched'),inventorySha256:'frozen-inventory'},originalReport:pilot,sourceProofs:[pilot,oldLedger,oldMarker].map(fileProof)};
 const file=path.join(out,'report.json');put(file,restored);return {file,out,profile,put,restored};
}
test('only fixed A05 and explicit live flag are permitted',()=>{
 assert.deepEqual(CHECKPOINT_A05,{id:'PET_CHECKPOINT_A05',text:'我希望狗换成白色博美犬。'});
 const f=fixture();assert.equal(parseCheckpointLiveArgs([f.file]).live,false);assert.equal(parseCheckpointLiveArgs([f.file,'--live']).live,true);
 for(const args of [[f.file,'--wish','answer'],[f.file,'--live','--retry'],['relative'],[f.file,'--initialize']])assert.throws(()=>parseCheckpointLiveArgs(args));
 const plan=checkpointA05Plan(inspectCheckpointLive(f.file,{}));assert.equal(plan.derivedAttempt,2);assert.equal(plan.mainlineStep,'A05');assert.equal(plan.checkpointBase,'PET01');assert.equal(plan.maxRequests,10);assert.equal(plan.thinking,'high');assert.match(plan.note,/不是独立清单 PET02/);
});
test('successful restore must preserve isolation, proof hashes and zero reservations',()=>{
 const f=fixture();assert.equal(inspectCheckpointLive(f.file,{}).budget.reserved,0);
 f.put(path.join(f.profile,'creation-evaluation-budget.json'),{format:'craftmine.creation-evaluation-budget/1',limit:10,requests:['used']});assert.throws(()=>inspectCheckpointLive(f.file,{}),/ALREADY_CONSUMED/);
 assert.equal(checkpointBudget(f.profile).reserved,1);assert.equal(checkpointBudget(f.profile).remaining,9);
});
test('does not reset or change an existing ledger',()=>{
 const f=fixture(),file=path.join(f.profile,'creation-evaluation-budget.json');f.put(file,{format:'craftmine.creation-evaluation-budget/1',limit:40,requests:[]});const before=fs.readFileSync(file);assert.throws(()=>inspectCheckpointLive(f.file,{}),/LIMIT_CHANGED/);assert.deepEqual(fs.readFileSync(file),before);
});
test('existing report, old session and altered model settings prevent reuse',()=>{
 const f=fixture();for(const env of [{CRAFTMINE_EVAL_SESSION:'old'},{CRAFTMINE_EVAL_REQUEST_LIMIT:'40'},{CRAFTMINE_EVAL_THINKING:'low'},{CRAFTMINE_EVAL_MODEL:'deepseek-other'}])assert.throws(()=>inspectCheckpointLive(f.file,env));
 fs.writeFileSync(path.join(f.out,'model-report.json'),'existing evidence');assert.throws(()=>inspectCheckpointLive(f.file,{}),/MODEL_REPORT_EXISTS/);assert.equal(fs.readFileSync(path.join(f.out,'model-report.json'),'utf8'),'existing evidence');
});
test('changed source evidence and failed restore refuse execution',()=>{
 const f=fixture();f.put(f.file,{...f.restored,ok:false});assert.throws(()=>inspectCheckpointLive(f.file,{}),/SUCCESSFUL_RESTORE/);f.put(f.file,f.restored);fs.appendFileSync(f.restored.sourceProofs[1].path,' ');assert.throws(()=>inspectCheckpointLive(f.file,{}),/SOURCE_CHANGED/);
});
test('queued build waits after model stops, bounded settlement remains truthful',()=>{
 const state=(active,job,reserved=1)=>({active,job:{status:job},budget:{limit:10,reserved,remaining:10-reserved}});
 assert.equal(checkpointPoll(state(false,'passed',0),false).settled,false);
 assert.equal(checkpointPoll(state(true,'queued'),false).started,true);
 assert.equal(checkpointPoll(state(false,'queued'),true).settled,false);
 assert.equal(checkpointPoll(state(false,'running'),true).settled,false);
 assert.equal(checkpointPoll(state(false,'passed',4),true).reason,'TASK_SETTLED_UNVERIFIED');
 assert.equal(checkpointPoll(state(false,'passed',10),true).reason,'BUDGET_STOP');
 assert.throws(()=>checkpointPoll(state(false,'passed',11),true),/RUNTIME_BUDGET/);
});
test('secret sanitizer covers nested responses and exact token substrings',()=>{
 const clean=checkpointSanitizer(['example-private-key','marker-private-token']);
 assert.deepEqual(clean({text:'prefix example-private-key suffix',nested:[{authorization:'anything',tokenText:'marker-private-token'}]}),{text:'prefix [REDACTED] suffix',nested:[{authorization:'[REDACTED]',tokenText:'[REDACTED]'}]});
});
test('recovery blockers come from error fields, not assistant prose',()=>{
 assert.equal(checkpointRecoverySignal({record:{content:'Documentation mentions EXPLICIT_RECOVERY_REQUIRED'}}),false);
 assert.equal(checkpointRecoverySignal({application:{error:'EXPLICIT_RECOVERY_REQUIRED'}}),true);
});
test('prepare-only does not read config, launch package, create report or budget',()=>{
 const f=fixture(),before=fs.readFileSync(f.file),env={...process.env,CRAFTMINE_LIVE_CONFIG:path.join(f.out,'missing-secret-config')};for(const key of ['CRAFTMINE_EVAL_SESSION','CRAFTMINE_EVAL_REQUEST_LIMIT','CRAFTMINE_EVAL_THINKING','CRAFTMINE_EVAL_MODEL'])delete env[key];
 const output=execFileSync(process.execPath,['tests/promo-wish-checkpoint-live.mjs',f.file],{cwd:process.cwd(),env,windowsHide:true,encoding:'utf8'});const plan=JSON.parse(output);assert.equal(plan.mode,'prepare-only');assert.equal(plan.modelRequests,0);assert.equal(fs.existsSync(path.join(f.out,'model-report.json')),false);assert.equal(fs.existsSync(path.join(f.profile,'creation-evaluation-budget.json')),false);assert.deepEqual(fs.readFileSync(f.file),before);
});
