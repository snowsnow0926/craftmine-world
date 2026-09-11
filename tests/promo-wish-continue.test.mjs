import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {continuationArgs,continuationBudget,assertContinuationLedger,validateContinuationSource,inspectContinuationSource,continuationEnvironment,assertContinuationSnapshot,claimContinuation,CONTINUATION_TEXT} from './helpers/promo-continuation-contract.mjs';
import {createEvaluationBudget} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-evaluation-budget.ts';
import {validateAdoptionReport} from './helpers/promo-adoption-contract.mjs';
const sessionId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function fixture(limit=40,reserved=9){
  const session={id:sessionId,mode:'agent',permissionMode:'auto',providerId:'provider-a',modelId:'deepseek-flash',thinkingLevel:'high',messages:[{role:'user',id:'message-a',content:'我想复刻奥格瑞玛。'},{role:'assistant',status:'error',error:{code:'EMPTY_MODEL_RESPONSE'}}]};
  const budget={limit,reserved,remaining:limit-reserved};
  const report={format:'craftmine.promo-pilot/1',status:'TASK_SETTLED_UNVERIFIED',endedAt:'2026-09-12T00:00:00Z',worldId:'world-a',model:'deepseek-flash',maxRequests:limit,wish:{id:'CITY01',text:'我想复刻奥格瑞玛。'},session:{sessionId},budget,
    packageIdentity:{packaged:path.resolve('fixture-package'),inventorySha256:'a'.repeat(64)},exitReport:{violations:[],pageErrors:[],shutdownFailures:[]},
    latest:{sessionId,active:false,budget,record:{session},observation:{worldId:'world-a',buildId:'build-a'},job:null}};
  const ledger={format:'craftmine.creation-evaluation-budget/1',limit,requests:Array.from({length:reserved},(_,i)=>'request-'+i)};
  const registry={format:'craftmine.creation-evaluation-sessions/1',sessions:{[sessionId]:{sessionId,providerId:'provider-a',modelId:'deepseek-flash',thinkingLevel:'high'}}};
  const journal={format:'craftmine.evaluation-wishes/1',entries:[{...report.wish,sessionId,worldId:'world-a',messageId:'message-a',status:'submitted'}]};
  return {report,ledger,registry,journal};
}
function context(f){return {original:f.report,selection:validateContinuationSource(f.report,f.ledger,f.registry,f.journal)};}
function diskFixture(t,limit=40,reserved=9){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-continue-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const out=path.join(root,'test-results','desktop-native-fixture'),profile=path.join(out,'profile'),legacy=path.join(out,'legacy');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(legacy);
  const f=fixture(limit,reserved),file=path.join(out,'model-report.json');
  for(const [name,value] of [['headless-profile.json',{format:'craftmine.headless-profile/1',token:'fixture-token',legacySource:legacy}],['creation-evaluation-budget.json',f.ledger],['creation-evaluation-sessions.json',f.registry],['creation-evaluation-wishes.json',f.journal]])fs.writeFileSync(path.join(profile,name),JSON.stringify(value));
  fs.writeFileSync(file,JSON.stringify(f.report));return {...f,root,out,profile,file};
}
test('continuation is explicit, fixed-text, and inherits both 10 and 40 request trials',()=>{
  for(const [limit,spent] of [[10,4],[40,9],[2,1]]){const f=fixture(limit,spent),c=context(f);assert.equal(c.selection.budget.remaining,limit-spent);}
  assert.equal(CONTINUATION_TEXT,'继续完成刚才的愿望。');
  assert.deepEqual(continuationArgs([path.resolve('report.json')]),{file:path.resolve('report.json'),live:false});
  assert.equal(continuationArgs([path.resolve('report.json'),'--live']).live,true);
  for(const args of [[],['relative.json'],[path.resolve('report.json'),'--limit','40'],[path.resolve('report.json'),'--prompt']])assert.throws(()=>continuationArgs(args));
});
test('clean TIME_STOP may contain a pre-abort active snapshot but live must be inactive',()=>{
  const f=fixture();f.report.status='TIME_STOP';f.report.latest.active=true;f.report.latest.record.session.messages.pop();
  const c=context(f);assert.throws(()=>assertContinuationSnapshot(f.report.latest,c,{beforeSubmission:true}),/STILL_ACTIVE/);
  f.report.latest.active=false;assertContinuationSnapshot(f.report.latest,c,{beforeSubmission:true});
});
test('successful, running, unclean and exhausted sources cannot silently resume',()=>{
  for(const mutate of [f=>f.report.latest.record.session.messages.at(-1).status='complete',f=>f.report.latest.active=true,f=>delete f.report.endedAt,f=>f.report.forcedStop=true,f=>f.report.integrityError='changed',f=>f.report.exitReport.violations=['focus'],f=>f.report.latest.job={status:'running'},f=>f.ledger.requests=Array.from({length:40},(_,i)=>'request-'+i)]){
    const f=fixture();mutate(f);assert.throws(()=>context(f));
  }
  assert.throws(()=>context(fixture(1,1)),/REMAINING_BUDGET/);
});
test('report, registry, original wish and world must agree before any launch',()=>{
  for(const mutate of [f=>f.report.maxRequests=10,f=>f.report.budget.reserved++,f=>f.registry.sessions[sessionId].modelId='other',f=>f.report.session.sessionId='other',f=>f.report.latest.observation.worldId='other',f=>f.report.wish.text='rewritten',f=>f.journal.entries[0].status='uncertain',f=>f.journal.entries[0].sessionId='other',f=>f.report.latest.record.session.messages[0].content='rewritten',f=>f.report.packageIdentity.inventorySha256='bad']){
    const f=fixture();mutate(f);assert.throws(()=>context(f));
  }
});
test('runtime identity, permission, budget and original user message are rechecked',()=>{
  for(const mutate of [s=>s.sessionId='other',s=>s.record.session.providerId='other',s=>s.record.session.permissionMode='bypass',s=>s.observation.worldId='other',s=>s.observation.buildId='other',s=>s.budget.limit=40,s=>s.budget.reserved++,s=>s.record.session.messages=[],s=>s.application={phase:'applying'}]){
    const f=fixture(10,4),c=context(f),s=structuredClone(f.report.latest);mutate(s);assert.throws(()=>assertContinuationSnapshot(s,c,{beforeSubmission:true}));
  }
  const f=fixture(),c=context(f);assertContinuationSnapshot(f.report.latest,c,{beforeSubmission:true});
});
test('only an append-only ledger with its original limit is accepted',()=>{
  const f=fixture(10,4),next=structuredClone(f.ledger);next.requests.push('follow-up');assertContinuationLedger(f.ledger,next);
  for(const mutate of [l=>l.limit=40,l=>l.requests.shift(),l=>l.requests.reverse(),l=>l.requests.push(l.requests[0]),l=>l.requests[0]='replaced']){const ledger=structuredClone(next);mutate(ledger);assert.throws(()=>assertContinuationLedger(f.ledger,ledger));}
  for(const limit of [0,41,1.5,'10'])assert.throws(()=>continuationBudget({...f.ledger,limit}));
});
test('the real evaluator budget reopens the original ledger without resetting spent requests',t=>{
  const f=diskFixture(t,10,9),before=fs.readFileSync(path.join(f.profile,'creation-evaluation-budget.json'));
  const budget=createEvaluationBudget(f.profile,10);assert.deepEqual(budget.snapshot(),{limit:10,reserved:9,remaining:1});
  assert.deepEqual(fs.readFileSync(path.join(f.profile,'creation-evaluation-budget.json')),before);
  budget.reserve('follow-up-last');assert.equal(budget.snapshot().remaining,0);assert.throws(()=>budget.reserve('too-many'),/REQUEST_LIMIT/);
  assertContinuationLedger(f.ledger,JSON.parse(fs.readFileSync(path.join(f.profile,'creation-evaluation-budget.json'))));
  assert.throws(()=>createEvaluationBudget(f.profile,40),/BUDGET_CORRUPT/);
});
test('environment supplies exactly the old session and limit, stripping inherited model and code injection settings',()=>{
  const f=fixture(10,4),c={...context(f),out:'original-out',profile:'original-profile',marker:{token:'authority'}};
  const env=continuationEnvironment({environment:()=>({PATH:'runtime',CRAFTMINE_DATA_DIR:c.profile,CRAFTMINE_HEADLESS_TOKEN:'authority',CRAFTMINE_EVAL_SESSION:'other',CRAFTMINE_EVAL_REQUEST_LIMIT:'40',CRAFTMINE_CONTINUITY_EVAL:'enabled',NODE_OPTIONS:'injected',OPENAI_API_KEY:'unrelated'})},c,'explicit-key');
  assert.equal(env.CRAFTMINE_EVAL_SESSION,sessionId);assert.equal(env.CRAFTMINE_EVAL_REQUEST_LIMIT,'10');assert.equal(env.CRAFTMINE_DATA_DIR,c.profile);assert.equal(env.CRAFTMINE_EVAL_KEY,'explicit-key');
  for(const key of ['NODE_OPTIONS','OPENAI_API_KEY','CRAFTMINE_CONTINUITY_EVAL'])assert.equal(env[key],undefined);
});
test('prepare inspection is read-only; exclusive claim preserves old report and blocks duplicate attempts',t=>{
  const f=diskFixture(t),before=fs.readFileSync(f.file),names=fs.readdirSync(f.out),c=inspectContinuationSource(f.file);
  assert.deepEqual(fs.readdirSync(f.out),names);assert.equal(c.profile,f.profile);
  const claim=claimContinuation(c,{format:'craftmine.promo-pilot/1',status:'PREPARING'});
  assert.equal(path.dirname(claim.output),f.out);assert.match(path.basename(claim.output),/^continuation-.*\.json$/);
  assert.deepEqual(fs.readFileSync(f.file),before);assert.throws(()=>claimContinuation(c,{}));
  claim.release();assert.throws(()=>inspectContinuationSource(f.file),/ALREADY_CLAIMED/);
  assert.deepEqual(JSON.parse(fs.readFileSync(c.budgetFile)),f.ledger);
});
test('changed source proof or ledger refuses a claim before starting a process',t=>{
  const f=diskFixture(t),c=inspectContinuationSource(f.file);fs.appendFileSync(f.file,' ');assert.throws(()=>claimContinuation(c,{}),/SOURCE_CHANGED/);
  fs.writeFileSync(f.file,JSON.stringify(f.report));const fresh=inspectContinuationSource(f.file);fs.writeFileSync(c.budgetFile,JSON.stringify({...f.ledger,requests:[...f.ledger.requests,'new']}));
  assert.throws(()=>claimContinuation(fresh,{}),/LEDGER_CHANGED/);
});
test('a successful continuation report keeps the pilot shape accepted by normal adoption',()=>{
  const f=fixture(10,4),c=context(f),ledger={...f.ledger,requests:[...f.ledger.requests,'follow-up']};
  const report={...f.report,trialKind:'same-session-player-follow-up',originalReportUnchanged:true,budgetAppendOnly:true,budget:continuationBudget(ledger),followUp:{id:'CONTINUE_x',text:CONTINUATION_TEXT},latest:{...f.report.latest,active:false,job:{kind:'check',status:'passed',sourceStale:false,jobId:'job-a',worldId:c.selection.worldId,candidateId:'candidate-a',buildId:'checked-a',output:{passed:true,check:{passed:true,assertions:[{passed:true}]}}}}};
  assert.equal(validateAdoptionReport(report,ledger).budget.remaining,5);
  for(const update of [{originalReportUnchanged:false},{budgetAppendOnly:false},{integrityError:'source changed'},{closeoutError:'abort failed'}])assert.throws(()=>validateAdoptionReport({...report,...update},ledger),/CONTINUATION_INTEGRITY/);
});
