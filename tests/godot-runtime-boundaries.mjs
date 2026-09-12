import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import {createWorldRuntime} from '../desktop/godot/web/runtime.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir('test-results',{recursive:true});
const out=await fs.mkdtemp(path.resolve('test-results/godot-runtime-boundary-'));
const source=await fs.readFile('vendor/pi-desktop/apps/desktop/electron/main/godot-panel-coordinator.ts','utf8');
const {createGodotPanelCoordinator}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
function coordinator(){
  const events=[];let selection='alpha',fault='',held=0;
  const host={instance:{worldId:'alpha',buildId:'build-a'},state:{state:'ready'},async holdSelectionSync(){held++;return()=>held--;},async switchWorld(value){events.push('switch:'+value?.worldId);if(fault==='save'||fault==='rollback'&&value?.worldId==='alpha')throw Error('disk full');this.instance=value;},async resume(){events.push('resume');},async pause(){events.push('pause');},setSurfaceVisible(v){events.push('visible:'+v);},async save(){return {status:'persisted',receipt:{worldId:'alpha'}};},async checkpoint(){return this.save();}};
  const panel=createGodotPanelCoordinator({host,selection:async()=>{if(fault==='selection')throw Error('selection failed');return selection;},adapter:{async describe(id){events.push('describe:'+id);if(fault==='descriptor')throw Error('artifact corrupt');return {worldId:id,buildId:'build-'+id};}},invoke:async(channel,payload)=>{events.push('invoke:'+channel);assert.equal(held,1);if(fault==='commit'||fault==='rollback')throw Error('selection commit failed');selection=payload.id;if(fault==='lost-selection-reply')throw Error('reply lost');return {id:selection};}});
  return {panel,host,events,fault:v=>fault=v,get held(){return held;}};
}
test('world open holds polling through selection commit and releases after success',async()=>{const f=coordinator();assert.deepEqual(await f.panel.invoke('world.open',{id:'beta'}),{id:'beta'});assert.deepEqual(f.events,['describe:beta','switch:beta','invoke:world.open','visible:true']);assert.equal(f.held,0);});
test('failed selection read releases transaction so next open works',async()=>{const f=coordinator();f.fault('selection');await assert.rejects(f.panel.invoke('world.open',{id:'beta'}),/selection failed/);f.fault('');await f.panel.invoke('world.open',{id:'beta'});assert.equal(f.held,0);});
test('descriptor/save errors preserve prior instance and selection',async()=>{for(const fault of ['descriptor','save']){const f=coordinator();f.fault(fault);await assert.rejects(f.panel.invoke('world.open',{id:'beta'}));assert.equal(f.host.instance.worldId,'alpha');assert.ok(!f.events.includes('invoke:world.open'));assert.equal(f.held,0);}});
test('selection commit failure restores durable previous world',async()=>{const f=coordinator();f.fault('commit');await assert.rejects(f.panel.invoke('world.open',{id:'beta'}),/selection commit failed/);assert.equal(f.host.instance.worldId,'alpha');assert.ok(f.events.includes('switch:alpha'));});
test('failed selection write plus failed old startup hides and pauses the mismatched runtime',async()=>{const f=coordinator();f.fault('rollback');await assert.rejects(f.panel.invoke('world.open',{id:'beta'}),/selection commit failed.*recovery failed.*disk full/);assert.equal(f.host.instance.worldId,'beta');assert.ok(f.events.includes('visible:false'));assert.equal(f.events.at(-1),'pause');assert.equal(f.held,0);});
test('selection commit with lost reply hides runtime until panel explicitly reopens',async()=>{const f=coordinator();f.fault('lost-selection-reply');await assert.rejects(f.panel.invoke('world.open',{id:'beta'}),/SELECTION_CHANGED/);assert.equal(f.host.instance.worldId,'beta');assert.equal(f.events.at(-1),'pause');assert.ok(f.events.includes('visible:false'));});
test('panel cannot submit snapshot paths identities or save another world',async()=>{const f=coordinator();await assert.rejects(f.panel.invoke('godot.runtimeSave',{worldId:'beta',freeze:false}),/WORLD_CHANGED/);await assert.rejects(f.panel.invoke('godot.runtimeSave',{worldId:'alpha',freeze:false,snapshot:{}}),/INVALID/);await assert.rejects(f.panel.invoke('godot.runtimeSurface',{worldId:'alpha',visible:'yes'}),/INVALID/);});
test('declared assets are verified on every GET and HEAD; added files never served',async()=>{
 const dir=path.join(out,'assets');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'index.html'),'GOOD');await fs.writeFile(path.join(dir,'secret.txt'),'private');
 const runtime=await createWorldRuntime({worldId:'alpha',buildId:'build-a',root:dir,artifacts:[{path:'index.html',sha256:hash('GOOD'),bytes:4}]});
 try{let response=await fetch(runtime.url);assert.equal(response.status,200);assert.equal(await response.text(),'GOOD');assert.equal(response.headers.get('cross-origin-opener-policy'),'same-origin');assert.equal((await fetch(new URL('secret.txt',runtime.url))).status,404);await fs.writeFile(path.join(dir,'index.html'),'EVIL');assert.equal((await fetch(runtime.url)).status,409);assert.equal((await fetch(runtime.url,{method:'HEAD'})).status,409);}finally{await runtime.dispose({graceful:false});}
});
test('native transport rejects uncloneable/oversize responses and remains usable',async()=>{
 const dir=path.join(out,'wire');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'index.html'),'x');
 const runtime=await createWorldRuntime({worldId:'alpha',buildId:'build-a',root:dir,timeoutMs:1000});
 const scope={protocol:runtime.protocol,worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId};let latest;
 runtime.attach(message=>latest=message);runtime.receive({...scope,type:'ready'});
 try{for(const payload of [1n,'草'.repeat(3*1024*1024),(()=>{const x={};x.x=x;return x;})()]){const promise=runtime.request('snapshot');runtime.receive({...scope,id:latest.id,type:'response',result:payload});await assert.rejects(promise,/Invalid or oversized/);}let promise=runtime.request('snapshot');runtime.receive({...scope,worldId:'beta',id:latest.id,type:'response',result:'foreign'});runtime.receive({...scope,id:latest.id,type:'response',result:'valid'});assert.equal((await promise).result,'valid');await assert.rejects(runtime.request('snapshot',{}, {timeoutMs:Infinity}),/timeout/);await assert.rejects(runtime.request('snapshot',{}, {timeoutMs:1}),/timed out/);promise=runtime.request('snapshot');runtime.receive({...scope,type:'exited',exitCode:0});await assert.rejects(promise,/exited/);}finally{await runtime.dispose({graceful:false});}
});
test('page bridge explicitly rejects malformed/oversized completion and callback exceptions',async()=>{
 const messages=[];let receive;const status={hidden:false,textContent:''};
 const scope={protocol:'craftmine.godot-runtime/2',worldId:'alpha',buildId:'build-a',instanceId:'one'};
 const context={TextEncoder,console,requestAnimationFrame:callback=>{callback();return 1;},document:{getElementById:()=>status},craftmineRuntime:{scope,post:x=>messages.push(x),on:fn=>receive=fn}};context.window=context;
 vm.runInNewContext(await fs.readFile('desktop/godot/web/bridge.js','utf8'),context);
 let throwing=false;context.CraftmineGame.register(()=>{if(throwing)throw Error('callback failure');});context.CraftmineGame.start({startGame:async()=>{},requestQuit(){}});await Promise.resolve();
 assert.equal(status.hidden,false,'engine startup must not hide the loading layer');
 receive({...scope,id:5,op:'load',args:{}});assert.equal(status.hidden,false,'load keeps the layer until its response');context.CraftmineGame.complete(JSON.stringify({id:5,result:{loaded:true,snapshot:{}}}));assert.equal(status.hidden,true,'successful load hides the layer');
 status.hidden=false;receive({...scope,id:6,op:'restore-state',args:{}});context.CraftmineGame.complete(JSON.stringify({id:6,result:{loaded:true,snapshot:{}}}));assert.equal(status.hidden,true,'successful restore hides the layer');
 receive({...scope,id:1,op:'save',args:{}});context.CraftmineGame.complete('草'.repeat(3*1024*1024));assert.match(messages.find(x=>x.id===1).error,/oversized/);
 receive({...scope,id:2,op:'save',args:{}});context.CraftmineGame.complete('{');assert.match(messages.find(x=>x.id===2).error,/JSON/);
 throwing=true;receive({...scope,id:3,op:'save',args:{}});assert.match(messages.find(x=>x.id===3).error,/callback/);
 throwing=false;receive({...scope,id:4,op:'save',args:{}});context.CraftmineGame.complete(JSON.stringify({id:4,result:{okay:true}}));assert.equal(messages.find(x=>x.id===4).result.okay,true);
});
const adapterSource=await fs.readFile('vendor/pi-desktop/apps/desktop/electron/main/godot-runtime-adapter.ts','utf8');
const {createGodotRuntimeAdapter}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(adapterSource,{mode:'transform'})).toString('base64'));
test('production adapter rejects candidate descriptors and mismatched durable instance/text hash',async()=>{
 const snapshot={format:'craftmine.godot-progress/1',worldId:'alpha',body:{coins:4}},snapshotText=JSON.stringify(snapshot);
 const call={worldId:'alpha',buildId:'build-a',revision:4,snapshot,runnerReceipt:{format:'craftmine.godot-runner-receipt/1',worldId:'alpha',buildId:'build-a',instanceId:'one',snapshotText,snapshotSha256:hash(snapshotText),bytes:Buffer.byteLength(snapshotText)}};
 const receipt={format:'craftmine.godot-progress-receipt/1',worldId:'alpha',buildId:'build-a',revision:4,contentHash:'a'.repeat(64),instanceId:'one',snapshotSha256:hash(snapshotText)};
 let fault='candidate';
 const adapter=createGodotRuntimeAdapter({selection:async()=> 'alpha',instance:()=>({worldId:'alpha',buildId:'build-a',instanceId:'one'}),domain:async(method)=>{
  if(method==='godotRuntime.describe')return {format:'craftmine.godot-runtime-descriptor/1',phase:'candidate'};
  return {receipt:{...receipt,...(fault==='instance'?{instanceId:'stale'}:fault==='hash'?{snapshotSha256:'f'.repeat(64)}:{})}};
 }});
 await assert.rejects(adapter.descriptor(),/INVALID_GODOT_RUNTIME_DESCRIPTOR/);
 for(fault of ['instance','hash'])await assert.rejects(adapter.progress(call),/DURABLE_RECEIPT_MISMATCH/);
 fault='none';assert.equal((await adapter.progress(call)).receipt.revision,4);
});
