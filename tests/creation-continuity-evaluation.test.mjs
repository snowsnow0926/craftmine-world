import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {register} from 'node:module';
import {CONTINUITY_EVALUATION_SUITE as suite,CONTINUITY_EVALUATION_CASES as cases,CONTINUITY_EVALUATION_LIMITS as limits,claimContinuityAttempt,claimContinuityCase,inspectContinuityOutcome,continuityHash} from './helpers/creation-continuity-evaluation.mjs';
import {continuityEvaluationConfiguration,claimContinuityAction,assertContinuityRequest,continuityRepairState} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-continuity-evaluation.ts';
import {createEvaluationBudget} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-evaluation-budget.ts';
import {countModelRepairs} from './helpers/creation-model-evaluation.mjs';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {freezeCreationRequirements}=await import('../vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-round-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const manifest={format:suite,evidenceUse:'development_cases',cases,limits,runId:randomUUID(),model:'deepseek-flash',thinking:'high'},file=path.join(directory,'suite-manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
 for(const entry of cases)fs.mkdirSync(path.join(directory,entry.id,'profile'),{recursive:true});
 const attempt=claimContinuityAttempt(file);for(const entry of cases)claimContinuityCase(directory,attempt,entry.id);
 const env={CRAFTMINE_EVAL_SUITE:suite,CRAFTMINE_EVAL_CASE:'CM01',CRAFTMINE_EVAL_MANIFEST:file,CRAFTMINE_DATA_DIR:path.join(directory,'CM01/profile'),CRAFTMINE_EVAL_MODEL:manifest.model,CRAFTMINE_EVAL_THINKING:manifest.thinking};
 const configuration=continuityEvaluationConfiguration(env),sessionId=randomUUID(),messageId=randomUUID(),context={projectId:'project-a',sessionId,turnId:'turn-a'};
 claimContinuityAction(configuration,'prompt',{sessionId,messageId});const messages=[{id:messageId,role:'user',content:cases[0].request}];
 return {directory,file,manifest,attempt,env,configuration,sessionId,messageId,context,messages};
}
test('all four frozen development inputs are independently verifiable and retain original CM04 words',()=>{
 const tree={id:'tree-a',kind:'tree',position:[2,0,-3],scale:[1,1,1],color:'#84a866',visible:true,solid:true};
 for(const entry of cases){const capture={source:entry.id==='CM03'?'recent':'ray',target:{surface:entry.id==='CM01'?'ground':'entity',entityId:entry.id==='CM01'?null:'tree-a',position:[2,0,-3]},entities:entry.id==='CM01'?[]:[tree]};assert.equal(freezeCreationRequirements(capture,entry.request).status,'verifiable',entry.id);}
 assert.equal(cases[3].request,'这棵树的颜色改成#88bb44，其他东西保持原样');assert.equal(cases.length,4);assert.equal(limits.perCaseRequests,10);assert.equal(limits.totalRequests,40);
});
test('one durable attempt and one case claim cannot be replayed; each fixed profile independently caps at ten',t=>{
 const f=fixture(t);assert.throws(()=>claimContinuityAttempt(f.file),/EEXIST/);assert.throws(()=>claimContinuityCase(f.directory,f.attempt,'CM01'),/EEXIST/);
 let total=0;for(const entry of cases){const config=continuityEvaluationConfiguration({...f.env,CRAFTMINE_EVAL_CASE:entry.id,CRAFTMINE_DATA_DIR:path.join(f.directory,entry.id,'profile')}),budget=createEvaluationBudget(config.profile,config.limit);for(let i=0;i<10;i++)budget.reserve(entry.id+'-'+i);assert.throws(()=>budget.reserve('eleventh'),/REQUEST_LIMIT/);assert.equal(createEvaluationBudget(config.profile,10).snapshot().remaining,0);total+=budget.snapshot().reserved;}assert.equal(total,40);
});
test('suite/profile/model/manifest changes reject; legacy default and full suite remain compatible',t=>{
 const f=fixture(t);assert.equal(continuityEvaluationConfiguration({}),null);assert.equal(continuityEvaluationConfiguration({CRAFTMINE_EVAL_SUITE:'full'}),null);
 for(const patch of [{CRAFTMINE_EVAL_CASE:'CM05'},{CRAFTMINE_EVAL_SUITE:'arbitrary'},{CRAFTMINE_EVAL_MODEL:'deepseek-other'},{CRAFTMINE_DATA_DIR:path.join(f.directory,'CM02/profile')}])assert.throws(()=>continuityEvaluationConfiguration({...f.env,...patch}),/CONTINUITY_/);
 fs.writeFileSync(f.file,JSON.stringify({...f.manifest,limits:{...limits,perCaseRequests:40}}));assert.throws(()=>continuityEvaluationConfiguration(f.env),/MANIFEST_INVALID/);
});
test('prepare and prompt have separate durable one-shot receipts and survive process reconstruction',t=>{
 const f=fixture(t);claimContinuityAction(f.configuration,'prepare');assert.throws(()=>claimContinuityAction(continuityEvaluationConfiguration(f.env),'prepare'),/ALREADY_ATTEMPTED/);assert.throws(()=>claimContinuityAction(f.configuration,'prompt',{sessionId:f.sessionId,messageId:f.messageId}),/ALREADY_ATTEMPTED/);
});
const tool=(id,name,status='ok',body={})=>({id,role:'tool',toolCallId:id,toolName:name,toolStatus:status,toolResult:body});
test('two repairs follow existing semantics; ordinary successful polling does not add a repair',async t=>{
 const f=fixture(t),read=async()=>({session:{id:f.sessionId,messages:f.messages}});
 await assertContinuityRequest(f.configuration,f.context,f.sessionId,read);
 f.messages.push(tool('initial-fail','creation_operation','error'));await assertContinuityRequest(f.configuration,f.context,f.sessionId,read);
 f.messages.push(tool('repair-one','creation_operation'));f.messages.push(tool('read-one','godot_build_read','ok',{status:'failed'}));await assertContinuityRequest(f.configuration,f.context,f.sessionId,read);
 f.messages.push(tool('repair-two','godot_project_patch'));f.messages.push(tool('read-pass','godot_build_read','ok',{status:'passed'}));await assertContinuityRequest(f.configuration,f.context,f.sessionId,read);
 assert.equal(continuityRepairState(f.messages).repairs,2);assert.equal(continuityRepairState(f.messages).repairs,countModelRepairs(f.messages));
 f.messages.push(tool('failed-again','godot_build_read','ok',{status:'failed'}));await assert.rejects(assertContinuityRequest(f.configuration,f.context,f.sessionId,read),/EVALUATION_REQUEST_LIMIT/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.configuration.profile,'continuity-request-stop.json'))).reason,'CONTINUITY_REPAIR_LIMIT');
});
test('missing history, wrong session/turn, another user message and elapsed deadline fail closed',async t=>{
 const f=fixture(t),read=async()=>({session:{id:f.sessionId,messages:f.messages}});await assertContinuityRequest(f.configuration,f.context,f.sessionId,read);
 await assert.rejects(assertContinuityRequest(f.configuration,f.context,f.sessionId,async()=>{throw Error('history offline');}),/REQUEST_LIMIT/);
 for(const patch of [{sessionId:'wrong'},{turnId:'other'},{projectId:'other'}])await assert.rejects(assertContinuityRequest(f.configuration,{...f.context,...patch},f.sessionId,read),/REQUEST_LIMIT/);
 f.messages.push({role:'user',id:'other',content:'another request'});await assert.rejects(assertContinuityRequest(f.configuration,f.context,f.sessionId,read),/REQUEST_LIMIT/);f.messages.pop();
 const file=path.join(f.configuration.profile,'continuity-prompt.json'),record=JSON.parse(fs.readFileSync(file));fs.writeFileSync(file,JSON.stringify({...record,at:new Date(Date.now()-600001).toISOString()}));await assert.rejects(assertContinuityRequest(f.configuration,f.context,f.sessionId,read),/REQUEST_LIMIT/);
});
test('actual product reserve persists the request before history refusal; replay does not consume another slot',async t=>{
 const f=fixture(t),env={...f.env,CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_SESSION:f.sessionId,CRAFTMINE_EVAL_KEY:'synthetic-test-no-network'},old=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]])),oldSend=process.send,listeners=new Set(process.listeners('message'));
 t.after(()=>{for(const[key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}process.send=oldSend;for(const listener of process.listeners('message'))if(!listeners.has(listener))process.removeListener('message',listener);});Object.assign(process.env,env);
 let readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});process.send=message=>{if(message.id==='initialize'){assert.equal(message.error,undefined);readyResolve();}return true;};
 const {installCreationEvaluation,reserveCreationEvaluationRequest}=await import('../vendor/pi-desktop/apps/desktop/electron/main/craftmine-creation-evaluation.ts');
 let unavailable=false;const session={id:f.sessionId,mode:'agent',providerId:'provider',modelId:'deepseek-flash',thinkingLevel:'high',messages:f.messages};
 installCreationEvaluation({enabled:true,window:()=>({isDestroyed:()=>false,webContents:{executeJavaScript:async()=>null}}),active:()=>true,call:async method=>{if(unavailable)throw Error('history unavailable');return method==='providers.list'?{providers:[{id:'provider',vendorKey:'deepseek',baseUrl:'https://api.deepseek.com'}]}:{session};},observe:async()=>null,action:async()=>null,domain:async()=>null});
 for(const listener of process.listeners('message'))if(!listeners.has(listener))listener({type:'craftmine-creation-evaluation',id:'initialize',method:'initialize'});await ready;
 unavailable=true;await assert.rejects(reserveCreationEvaluationRequest('reserved-one',f.context),/REQUEST_LIMIT/);assert.equal(createEvaluationBudget(f.configuration.profile,10).snapshot().reserved,1);
 unavailable=false;await reserveCreationEvaluationRequest('reserved-one',f.context);assert.equal(createEvaluationBudget(f.configuration.profile,10).snapshot().reserved,1);
 for(let i=2;i<=10;i++)await reserveCreationEvaluationRequest('request-'+i,f.context);await assert.rejects(reserveCreationEvaluationRequest('eleventh',f.context),/REQUEST_LIMIT/);
});
test('outcome requires actual color/scale, checked formal build, exact wish and full cold-restored state',()=>{
 const entity={id:'tree-a',kind:'tree',position:[2,0,-3],scale:[1,1,1],color:'#84a866',visible:true,solid:true},changed={...entity,scale:[2,2,2],color:'#0000ff'},obstacles=[{entityId:'tree-a',min:[1,0,-4],max:[3,3,-2]}];
 const observe=(buildId,instanceId,entities)=>({baseId:'creation-sandbox',worldId:'world-a',buildId,instanceId,payload:{creation:{entities,obstacles,target:{entityId:'tree-a'}}}});
 const progress={format:'craftmine.godot-progress/1',baseId:'creation-sandbox',body:{format:'craftmine.creation-progress/1',inventory:{wood:7},openedChests:['old-chest'],player:{position:[0,0,0]}}};
 const input={entry:cases[1],before:observe('before','old',[entity]),after:observe('after','current',[changed]),target:{source:'ray',target:{entityId:'tree-a'}},beforeProgress:progress,afterProgress:progress,job:{kind:'check',worldId:'world-a',status:'passed',buildId:'after',output:{check:{assertions:[{passed:true}]}},checkRequirements:{creation:{requestHash:continuityHash(cases[1].request)}}},reopened:observe('after','new',[changed]),restoredProgress:progress};
 assert.ok(inspectContinuityOutcome(input).every(item=>item.passed));
 for(const patch of [{after:input.before},{after:observe('after','current',[{...changed,color:'#84a866'}])},{job:{...input.job,worldId:'other'}},{job:{...input.job,checkRequirements:null}},{restoredProgress:{...progress,body:{...progress.body,inventory:{wood:0}}}}])assert.ok(inspectContinuityOutcome({...input,...patch}).some(item=>!item.passed));
});
