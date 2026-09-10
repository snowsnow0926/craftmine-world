import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {targetFeedbackConfiguration} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
const {build}=createRequire(path.resolve(process.env.CRAFTMINE_DEPS_ROOT||'vendor/pi-desktop/apps/desktop','package.json'))('esbuild');
async function load(name){const result=await build({entryPoints:[`vendor/pi-desktop/apps/desktop/electron/main/${name}.ts`],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const {createCraftmineTargetFeedbackPanel}=await load('craftmine-target-feedback-panel'),{createCraftmineOperationJournal}=await load('craftmine-operation-journal'),{createCraftminePanelGateway}=await load('craftmine-panel-gateway');
const binding={format:'craftmine.target-feedback-source/1',worldId:'alpha',buildId:'build-a',contentOid:'a'.repeat(40),revision:1,manifestHash:'b'.repeat(64),targetId:'target_a',targetHash:'c'.repeat(64)};
const defaults={format:'craftmine.target-feedback-default/1',values:{hitFlashMilliseconds:250},source:{kind:'balance-profile',path:'data/balance/training_range.tres',sha256:'f'.repeat(64)}};
const payload={targetId:'target_a',sourceBinding:binding,values:{hitFlashMilliseconds:500}};
function fixture(){const f={world:'alpha',blocked:false,throwCode:null,defaults:structuredClone(defaults),calls:[],applies:0,status:'queued',receipts:new Map()};
 f.native=createCraftmineTargetFeedbackPanel({selection:async()=>f.world,blocked:()=>f.blocked,domain:async(method,args)=>{
  f.calls.push({method,args});if(f.throwCode)throw Object.assign(Error(f.throwCode),{code:f.throwCode});
  if(method==='targetFeedback.describe')return{worldId:'alpha',buildId:'build-a',targets:[{targetId:'target_a',label:'训练靶 <script>',configuration:targetFeedbackConfiguration(),defaults:f.defaults,binding,values:{hitFlashMilliseconds:120},hostPath:'private'}],unsupported:[],hostContext:'private'};
  let r=f.receipts.get(args.operationId);if(!r){f.applies++;r={worldId:'alpha',operationId:args.operationId,status:'check-queued',applied:false,draftRetained:true,source:{revision:2,manifestHash:'d'.repeat(64),secret:'private'},job:{jobId:'gjob-'+'e'.repeat(64),status:'queued',sourcePath:'private'}};f.receipts.set(args.operationId,r);}
  return{...r,...(method==='targetFeedback.status'?{status:f.status==='passed'?'passed':'check-queued',job:{...r.job,status:f.status}}:{})};
 }});return f;}
test('panel translates bounded source binding and projects no private response fields',async()=>{
 const f=fixture(),result=await f.native('targetFeedback.describe',{worldId:'alpha'});assert.deepEqual(result.targets[0].sourceBinding,binding);assert.deepEqual(result.targets[0].defaults,defaults);assert.equal(JSON.stringify(result).includes('private'),false);
 const submitted=await f.native('targetFeedback.submit',{worldId:'alpha',operationId:'operation-a',...payload});assert.equal(submitted.applied,false);assert.equal(JSON.stringify(submitted).includes('private'),false);assert.deepEqual(f.calls[1].args.binding,binding);assert.equal('sourceBinding' in f.calls[1].args,false);
});
test('zero/fraction/range, forged host fields and mismatching worlds reject before a private mutation',async()=>{
 const f=fixture();for(const value of [0,-1,1.5,1001,NaN,'500'])await assert.rejects(f.native('targetFeedback.submit',{worldId:'alpha',operationId:'op-invalid',...payload,values:{hitFlashMilliseconds:value}}));
 await assert.rejects(f.native('targetFeedback.submit',{worldId:'alpha',operationId:'op-invalid',...payload,binding:{host:'forged'}}));
 await assert.rejects(f.native('targetFeedback.submit',{worldId:'alpha',operationId:'op-invalid',...payload,sourceBinding:{...binding,worldId:'beta'}}));assert.equal(f.calls.length,0);
 f.blocked=true;await assert.rejects(f.native('targetFeedback.describe',{worldId:'alpha'}),/WORLD_BUSY/);
});
test('only proven pre-write rejection becomes a completed rejection; storage/transport errors stay uncertain',async()=>{
 const f=fixture();f.throwCode='TARGET_FEEDBACK_STALE_BINDING';const rejected=await f.native('targetFeedback.submit',{worldId:'alpha',operationId:'op-rejected',...payload});assert.equal(rejected.status,'rejected');assert.equal(rejected.draftRetained,false);
 f.throwCode='LOST_REPLY';await assert.rejects(f.native('targetFeedback.submit',{worldId:'alpha',operationId:'op-uncertain',...payload}),/LOST_REPLY/);
});
test('existing operation journal survives restart, holds original args, and queries completed check independently',async()=>{
 const f=fixture(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'target-feedback-journal-'));let lose=true;
 const make=()=>createCraftminePanelGateway({operations:createCraftmineOperationJournal(directory),viewingSession:()=>null,session:async()=>null,activeTurn:()=>undefined,begin:async()=>{throw Error('No model turn');},end:async()=>{},stop:async()=>{},resume:async()=>{},interrupt:async()=>{},backup:async()=>{},diagnostics:async()=>{},
  domain:async(method)=>{if(method==='selection.read')return{worldId:f.world};throw Error('No arbitrary domain method');},targetFeedback:async(channel,input)=>{const result=await f.native(channel,input);if(channel==='targetFeedback.submit'&&lose){lose=false;throw Error('LOST_REPLY');}return result;}});
 let panel=make();const prepared=await panel('workbench.prepare',{worldId:'alpha',channel:'targetFeedback.submit',payload});await assert.rejects(panel('workbench.execute',{worldId:'alpha',operationId:prepared.operationId}),/LOST_REPLY/);
 panel=make();const listed=await panel('workbench.operations',{worldId:'alpha'});assert.deepEqual(listed.items[0].payload,payload);assert.equal(listed.items[0].state,'uncertain');
 const recovered=await panel('workbench.execute',{worldId:'alpha',operationId:prepared.operationId});assert.equal(recovered.status,'check-queued');assert.equal(f.applies,1);
 f.status='passed';assert.equal((await panel('targetFeedback.status',{worldId:'alpha',operationId:prepared.operationId})).status,'passed');
 panel=make();assert.deepEqual(await panel('workbench.execute',{worldId:'alpha',operationId:prepared.operationId}),recovered);assert.equal(f.applies,1);
 await panel('workbench.acknowledge',{worldId:'alpha',operationId:prepared.operationId});assert.deepEqual((await panel('workbench.operations',{worldId:'alpha'})).items,[]);
});

test('panel refuses missing or malformed default provenance rather than filling static120',async()=>{
 const f=fixture();for(const value of [undefined,{...defaults,source:{...defaults.source,path:'C:/private.tres'}},{...defaults,values:{hitFlashMilliseconds:1001}},{...defaults,source:{...defaults.source,kind:'custom'}}]){f.defaults=value;await assert.rejects(f.native('targetFeedback.describe',{worldId:'alpha'}));}assert.equal(f.applies,0);
});
