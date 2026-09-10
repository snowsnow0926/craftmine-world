import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const {build}=createRequire(path.resolve('vendor/pi-desktop/apps/desktop/package.json'))('esbuild');
const compiled=await build({entryPoints:['vendor/pi-desktop/apps/desktop/electron/main/craftmine-panel-gateway.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {createCraftminePanelGateway}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fixture(enabled=true){
 const calls=[];const forbidden=async()=>{throw Error('model or world mutation forbidden');};
 const panel=createCraftminePanelGateway({viewingSession:()=>null,session:forbidden,activeTurn:()=>undefined,begin:forbidden,end:forbidden,stop:forbidden,resume:forbidden,interrupt:forbidden,backup:forbidden,diagnostics:forbidden,
  domain:async(method,args)=>{if(method==='selection.read')return{worldId:'alpha'};if(method==='workbench.request'&&args.channel==='workbench.capabilities')return{channels:[]};throw Error('Unexpected domain call '+method);},
  ...(enabled?{issues:async(channel,input)=>{calls.push({channel,input});return{ok:true};}}:{})});return{panel,calls};
}
test('local notebook dispatch retains selected world without a model session or task mutation',async()=>{
 const f=fixture();const result=await f.panel('workbench.capabilities',{worldId:'alpha'});assert.ok(result.channels.includes('issue.create'));
 for(const channel of ['issue.create','issue.list','issue.read','issue.delete','issue.followupPrepare','issue.followup'])assert.deepEqual(await f.panel(channel,{worldId:'alpha',operationId:'op-owned'}),{ok:true});
 assert.equal(f.calls.length,6);assert.ok(f.calls.every(x=>x.input.worldId==='alpha'));
});
test('changed selections and forged host identity never reach the service',async()=>{
 const f=fixture();await assert.rejects(f.panel('issue.create',{worldId:'beta'}),/SELECTED_WORLD_CHANGED/);
 for(const key of ['context','host','sessionId','turnId','projectId','binding','origin'])await assert.rejects(f.panel('issue.create',{worldId:'alpha',[key]:'forged'}),/HOST_IDENTITY_REQUIRED/);
 await assert.rejects(f.panel('issue.upload',{worldId:'alpha'}),/UNSUPPORTED_WORKBENCH_CHANNEL/);assert.equal(f.calls.length,0);
});
test('unavailable notebook has no advertised capability or fallback domain execution',async()=>{
 const f=fixture(false);const result=await f.panel('workbench.capabilities',{worldId:'alpha'});assert.ok(result.channels.every(x=>!x.startsWith('issue.')));
 await assert.rejects(f.panel('issue.list',{worldId:'alpha'}),/ISSUE_SERVICE_UNAVAILABLE/);
});
