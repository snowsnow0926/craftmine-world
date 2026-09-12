// Execute the actual index.ts queue callback with controlled domain facts, plus
// the real queue/service/dispatcher. Real Rust read-after-end proof is separate.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import ts from 'typescript';
import {createCreationAutoApplyService} from '../electron/main/creation-auto-apply-service.ts';
import {createCreationAutoQueue} from '../electron/main/creation-auto-queue.ts';
import {createCreationRepairDispatcher} from '../electron/main/creation-repair-dispatch.ts';
import {creationApplicationRepairReason,CREATION_APPLICATION_REPAIR_PREFIX} from '../electron/main/creation-application-repair.ts';
const text=fs.readFileSync(new URL('../electron/main/index.ts',import.meta.url),'utf8'),tree=ts.createSourceFile('index.ts',text,ts.ScriptTarget.Latest,true);
let perform;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='creationAutoQueue')perform=node.initializer.arguments[0].properties.find(property=>property.name?.getText(tree)==='perform').initializer.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert.ok(perform);
const callback=ts.transpileModule('const handler='+perform,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'\nreturn handler;';
const context={projectId:'project',sessionId:'session',turnId:'turn'},worldId='world',taskId='work-'+createHash('sha256').update(JSON.stringify([context.sessionId,context.turnId])).digest('hex');
const jobId=n=>'gjob-'+String(n).repeat(64),input=n=>({context,jobId:jobId(n)});
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'creation-multi-check-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const capture={format:'craftmine.creation-target/1',snapshotId:'request',worldId,buildId:'formal',instanceId:'instance',sourceRevision:1,manifestHash:'a'.repeat(64),autoApply:true,authorization:'full-auto',requestHash:'b'.repeat(64),creationRequirements:{status:'unverified'}};
 const state={latest:null,jobs:new Map(),revision:1,manifestHash:'a'.repeat(64),applies:[],repairs:0};
 const activeTurns=new Map([[context.sessionId,context.turnId]]),turnFinalizations=new Map();
 const add=(n,status='passed',kind='check',sameSource=false)=>{if(!sameSource){state.revision++;state.manifestHash=String(n+1).repeat(64);}const job={worldId,jobId:jobId(n),taskId,kind,status,baseId:'creation-sandbox',candidateId:'candidate-'+n,buildId:'build-'+n,sourceRevision:state.revision,manifestHash:state.manifestHash,outputHash:'c'.repeat(64),branchId:'main'};state.jobs.set(job.jobId,job);state.latest=job;return job;};
 const domain=async(method,args)=>{
  if(method==='godotBuild.read')return structuredClone(state.jobs.get(args.jobId));
  if(method==='godotBuild.latest')return structuredClone(state.latest);
  if(method==='godotRuntime.describe')return {worldId,baseId:'creation-sandbox',buildId:'formal',sourceRevision:1,manifestHash:'a'.repeat(64)};
  if(method==='godotProject.index')return {worldId,baseId:'creation-sandbox',currentTaskId:taskId,revision:state.revision,manifestHash:state.manifestHash};
  if(method==='godotCandidate.read'){const job=[...state.jobs.values()].find(job=>job.candidateId===args.candidateId);return {checkStatus:'passed',candidate:{...job,status:'ready',checkJobId:job.jobId,checkOutputHash:job.outputHash},check:{assertions:['runtime.ready','runtime.frame','runtime.no-errors','runtime.snapshot','runtime.isolation','runtime.recovery'].map(id=>({id,passed:true}))}};}
  throw Error(method);
 };
 const service=createCreationAutoApplyService({capture:async()=>structuredClone(capture),settled:async()=>!activeTurns.size&&!turnFinalizations.size,domain,apply:async(world,candidate,expected,guard)=>{await guard();assert.equal(activeTurns.size,0,'core task is not consumed while model can still edit');state.applies.push(candidate);return {status:'applied',worldId:world,candidateId:candidate};}});
 const repair=createCreationRepairDispatcher({directory:path.join(directory,'repairs'),authorize:async()=>{},lookup:async()=>({state:'absent'}),submit:async()=>{state.repairs++;return {accepted:true,turnId:'repair-turn'};}});
 let queue;
 const deps={creationTargets:{owned:()=>structuredClone(capture),authorizedTurns:()=>[{context,capture}]},plugins:{requestCraftmineHost:domain},createHash,
  creationAutoQueue:{status:(...args)=>queue.status(...args)},repairOwnsUncheckedWork:()=>false,creationFullAuto:async()=>true,activeTurns,turnFinalizations,godotSelection:async()=>worldId,
  profileRestore:false,godotCopies:{busy:false},godotExportBusy:false,godotInitializer:{busy:false},godotRestores:{busy:false},groundMaintenance:{busy:false},immersionState:{blocked:false},
  submitCreationAutomaticRepair:input=>repair.dispatch(input),creationAutoApply:service,godotCandidates:{blocking:false},creationApplicationRepairReason,CREATION_APPLICATION_REPAIR_PREFIX};
 const handler=new Function(...Object.keys(deps),callback)(...Object.values(deps));
 queue=createCreationAutoQueue({directory:path.join(directory,'queue'),world:async()=>worldId,perform:handler});
 return {state,activeTurns,turnFinalizations,queue,add};
}
test('two checks with additional source edits keep the active task writable and adopt only the last check after finish',async t=>{
 const {state,activeTurns,queue,add}=fixture(t);add(1);assert.equal((await queue.completed(input(1))).status,'deferred');assert.deepEqual(state.applies,[]);
 add(2);assert.equal((await queue.completed(input(2))).status,'deferred');assert.deepEqual(state.applies,[]);
 activeTurns.clear();await queue.resume();assert.deepEqual(state.applies,['candidate-2']);assert.equal(queue.status(jobId(1),'session').reason,'CREATION_CHECK_SUPERSEDED');
});
for(const newer of ['failed','build'])test('new latest '+newer+' suppresses an older pass even when source bytes are identical',async t=>{
 const {state,activeTurns,queue,add}=fixture(t);add(1);await queue.completed(input(1));
 add(2,newer==='failed'?'failed':'passed',newer==='build'?'build':'check',true);
 if(newer==='failed')await queue.completed(input(2));activeTurns.clear();await queue.resume();
 assert.deepEqual(state.applies,[]);assert.equal(queue.status(jobId(1),'session').reason,'CREATION_CHECK_SUPERSEDED');
 if(newer==='failed'){assert.equal(state.repairs,1);assert.equal(queue.status(jobId(2),'session').status,'repairing');}
});
test('finalization also defers adoption until the persistent turn close has settled',async t=>{
 const {state,activeTurns,turnFinalizations,queue,add}=fixture(t);add(1);activeTurns.clear();turnFinalizations.set('session',true);await queue.completed(input(1));assert.deepEqual(state.applies,[]);
 turnFinalizations.clear();await queue.resume();assert.deepEqual(state.applies,['candidate-1']);
});
