import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {validateAdoptionReport,inspectAdoptionSource,adoptionEnvironment,validateAdoptionCall} from './helpers/promo-adoption-contract.mjs';
import {assertProofs} from './helpers/promo-checkpoint-contract.mjs';
function fixture(remaining=4){
 const budget={limit:10,reserved:10-remaining,remaining};
 return {report:{format:'craftmine.promo-pilot/1',worldId:'world-a',maxRequests:10,budget,
  endedAt:'2026-09-12T00:00:00Z',exitReport:{violations:[],pageErrors:[],shutdownFailures:[]},
  packageIdentity:{packaged:path.resolve('fixture-package'),inventorySha256:'a'.repeat(64)},
  latest:{active:false,job:{kind:'check',status:'passed',sourceStale:false,jobId:'job-a',worldId:'world-a',candidateId:'candidate-a',buildId:'build-a',output:{passed:true,check:{passed:true,assertions:[{passed:true}]}}}}},
 ledger:{format:'craftmine.creation-evaluation-budget/1',limit:10,requests:Array.from({length:budget.reserved},(_,i)=>'request-'+i)}};
}
test('a stopped successful pilot can be adopted with either remaining or exhausted budget',()=>{
 for(const remaining of [0,4,9]){const {report,ledger}=fixture(remaining);assert.equal(validateAdoptionReport(report,ledger).budget.remaining,remaining);}
});
test('active, unknown, unclean and unchecked runs cannot be adopted',()=>{
 for(const mutate of [r=>r.latest.active=true,r=>delete r.latest.active,r=>r.latest.active='false',r=>delete r.endedAt,r=>r.forcedStop=true,r=>r.exitReport=null,r=>r.exitReport.shutdownFailures=['failed'],r=>r.latest.job.status='running',r=>r.latest.job.kind='preview',r=>r.latest.job.sourceStale=true,r=>r.latest.job.output.check.passed=false,r=>r.latest.job.output.check.assertions=[],r=>r.latest.job.output.check.assertions[0].passed=false]){
  const {report,ledger}=fixture();mutate(report);assert.throws(()=>validateAdoptionReport(report,ledger));
 }
});
test('invalid or inconsistent remaining budget, ledger and checked identity fail closed',()=>{
 for(const remaining of [-1,1.5,'4',NaN,Infinity,11]){const {report,ledger}=fixture();report.budget.remaining=remaining;assert.throws(()=>validateAdoptionReport(report,ledger));}
 for(const mutate of [(r,l)=>l.requests.pop(),(r,l)=>l.requests[1]=l.requests[0],(r,l)=>l.limit++,(r)=>r.budget.reserved++,(r)=>r.maxRequests++,(r)=>r.latest.job.worldId='another',(r)=>delete r.latest.job.candidateId,(r)=>r.packageIdentity.inventorySha256='fake']){
  const {report,ledger}=fixture();mutate(report,ledger);assert.throws(()=>validateAdoptionReport(report,ledger));
 }
});
test('adoption environment removes evaluation, credentials and arbitrary injection settings',()=>{
 const supplied={SystemRoot:'C:/Windows',PATH:'runtime-bin',TEMP:'test-temp',CRAFTMINE_DATA_DIR:'isolated',CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_TOKEN:'fixture-authority',PI_DESKTOP_HOST_BIN:'host.exe',CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_REQUEST_LIMIT:'10',CRAFTMINE_EVAL:'1',EVAL:'1',EVAL_MODEL:'model',CRAFTMINE_LIVE_CONFIG:'private',DEEPSEEK_API_KEY:'fake-secret',ANTHROPIC_AUTH_TOKEN:'fake-token',AWS_ACCESS_KEY_ID:'fake-key',OPENAI_API_TOKEN:'fake-token',CUSTOM_CREDENTIAL:'fake',NODE_OPTIONS:'injection',ELECTRON_RUN_AS_NODE:'1'};
 const env=adoptionEnvironment({environment:()=>({...supplied})},{});
 assert.deepEqual(env,{SystemRoot:'C:/Windows',PATH:'runtime-bin',TEMP:'test-temp',CRAFTMINE_DATA_DIR:'isolated',CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_TOKEN:'fixture-authority',PI_DESKTOP_HOST_BIN:'host.exe'});
 assert.equal(supplied.EVAL,'1');
});
test('driver permits only normal fixed-candidate player actions, never model startup or task resume',()=>{
 const selection={worldId:'world-a',candidateId:'candidate-a'};
 for(const method of ['initialize','resume-play','wish','evaluate','worldNavigation','agentPrompt','task.resume'])assert.throws(()=>validateAdoptionCall(method,{},selection));
 for(const fields of [{channel:'godot.candidateApply',payload:{worldId:'other',candidateId:'candidate-a'}},{channel:'task.resume',payload:{}},{channel:'godot.candidateApply',payload:{worldId:'world-a',candidateId:'candidate-a',force:true}}])assert.throws(()=>validateAdoptionCall('worldPanel',fields,selection));
 assert.throws(()=>validateAdoptionCall('status',{type:'craftmine-creation-evaluation'},selection));
 validateAdoptionCall('worldPanel',{channel:'godot.candidateApply',payload:selection},selection);
 validateAdoptionCall('worldPanel',{channel:'godot.runtimeSave',payload:{worldId:'world-a',freeze:true}},selection);
});
test('model-report beside a restored profile retains immutable report and ledger proofs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'adoption-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=path.join(root,'test-results','desktop-native-fixture'),profile=path.join(out,'profile'),legacy=path.join(out,'legacy');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(legacy);
 const {report,ledger}=fixture(),file=path.join(out,'model-report.json'),budget=path.join(profile,'creation-evaluation-budget.json');
 fs.writeFileSync(file,JSON.stringify(report));fs.writeFileSync(budget,JSON.stringify(ledger));fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token:'fixture-authority',legacySource:legacy}));
 const inspected=inspectAdoptionSource(file);assert.equal(inspected.profile,profile);assert.equal(inspected.selection.budget.remaining,4);assertProofs(inspected.proofs);
 fs.appendFileSync(file,' ');assert.throws(()=>assertProofs(inspected.proofs),/SOURCE_CHANGED/);
 fs.writeFileSync(file,JSON.stringify(report));fs.appendFileSync(budget,' ');assert.throws(()=>assertProofs(inspected.proofs),/SOURCE_CHANGED/);
});
