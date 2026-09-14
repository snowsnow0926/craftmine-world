import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire,register} from 'node:module';
import {createPlayerWorldLibrary,validateArchive} from '../plugins/craftmine-world/player-world-library.cjs';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {invokeCraftmineNavigation}=await import('../vendor/pi-desktop/apps/desktop/electron/main/craftmine-navigation-host.ts');
const {createGodotPanelCoordinator}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-panel-coordinator.ts');
const {createWorldTemplatePanel}=await import('../vendor/pi-desktop/apps/desktop/electron/main/world-template-panel.ts');
const {createImmersionPauseController}=await import('../vendor/pi-desktop/apps/desktop/electron/main/immersion-pause-controller.ts');
const model=await import('../vendor/pi-desktop/apps/desktop/src/lib/player-library.ts');
const root=path.resolve(import.meta.dirname,'..'),sha=value=>createHash('sha256').update(value).digest('hex');
const ui=fs.readFileSync(path.join(root,'vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/LibraryPublishPanel.tsx'),'utf8');
const {transformSync}=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'))('esbuild');
const handler=transformSync(ui.slice(ui.indexOf('  const submit = async () => {'),ui.indexOf('  const cancel = async () => {'))+'\nglobalThis.submit=submit;',{loader:'ts',target:'es2022'}).code;
assert(handler.includes('worldTemplate.describe'));
const hostSource=fs.readFileSync(path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts'),'utf8');
const hostMethods=hostSource.slice(hostSource.indexOf('  async pause(): Promise<void>'),hostSource.indexOf('  /** Safe departure'));
const Host=vm.runInNewContext(transformSync('class Host {'+hostMethods+'}\nHost;',{loader:'ts',target:'es2022'}).code);

async function fixture({legacy=false,changed=false,saveFailure=false,cancelDuringSave=false,unmountDuringSave=false,selectedOther=false,manual=false}={}){
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'test-results/publication-capture-'));
  const worldId='world-publication',body=Buffer.from('[application]\nconfig/name="Fixture"\n');
  const state={live:true,tick:95,revision:11,imports:0,error:'',calls:[],phases:[]};
  let imported;
  const source=()=>({worldId,sourceWorldId:worldId,baseId:'creation-sandbox',baseVersion:'1.0.0',buildId:'formal-build',contentOid:sha('source'),revision:state.revision,
    files:[{path:'project.godot',bytes:body.length,sha256:sha(body)}],snapshot:{format:'craftmine.godot-progress/1',stateVersion:1,worldId,baseId:'creation-sandbox',baseVersion:'1.0.0',body:{worldId,tick:state.tick}}});
  const library=createPlayerWorldLibrary({directory,selected:async()=>worldId,call:async(method,args)=>{
    if(method==='godotRuntime.exportSource')return source();
    if(method==='content.readFile'){if(state.live)state.tick++;if(changed)state.revision++;return{base64:body.toString('base64')};}
    if(method==='asset.import'){state.imports++;imported=fs.readFileSync(args.sourcePath);return{};}
    if(method==='asset.read')return{version_:{contentHash:sha(imported),files:[{sha256:sha(imported)}]}};
    throw Error('Unexpected Core call '+method);
  }});
  const instance={worldId,buildId:'formal-build',instanceId:'instance',alive:true};
  const pauseController=createImmersionPauseController();await pauseController.attach(instance,{pause:()=>{state.live=false;},resume:()=>{state.live=true;}});await pauseController.setManual(instance,manual);
  const host=Object.assign(new Host(),{instance,current:instance,pauseController,pauseIntentRevision:new WeakMap(),identityOf:value=>value,publish:()=>{},setSurfaceVisible:()=>{},
    save:async()=>{if(saveFailure)return{status:'failed',error:'SAVE_FAILED'};if(cancelDuringSave)context.cancelled.current=true;if(unmountDuringSave)context.alive.current=false;return{status:'persisted',receipt:{worldId,revision:11},snapshot:source().snapshot};}});
  const panel=createGodotPanelCoordinator({host,adapter:{},selection:async()=>selectedOther?'different-world':worldId,invoke:async(channel,args)=>{
    if(channel==='worldTemplate.save'){const {includePreview,...request}=args;return library.save(request);}
    if(channel==='worldTemplate.describe')return library.describe(args);
    if(channel==='worldTemplate.status')return library.status(args);
    throw Error('Unexpected panel call '+channel);
  }});
  const publication=createWorldTemplatePanel({selection:async()=>selectedOther?'different-world':worldId,capture:async()=>legacy?{receipt:(await host.save()).receipt,release:async()=>{}}:host.checkpointForPublication(),capturePreview:async()=>{throw Error('no preview');},pick:async()=>{throw Error('no picker');},domain:async(channel,args)=>library[channel.slice('worldTemplate.'.length)](args)});
  const bridge={call:async(channel,args)=>{state.calls.push({channel,args:structuredClone(args)});return channel.startsWith('worldTemplate.')?publication.request(channel,args):invokeCraftmineNavigation({pluginId:'craftmine.world',channel,payload:args},{invoke:(c,a)=>panel.invoke(c,a)});}};
  const context={...model,bridge,worldId,kind:'world',checkpoint:true,name:'Live template',description:'Progress preserved',tags:'',aliases:'',ownAssets:[],updateId:'',includePreview:false,zh:false,
    locked:{current:false},cancelled:{current:false},alive:{current:true},latestAttempt:{current:null},retained:new Map(),cacheKey:worldId,crypto:{randomUUID},
    setError:value=>{state.error=typeof value==='function'?value(state.error):value;},setBusy:()=>{},setResult:()=>{},setPhase:value=>state.phases.push(value),setAttempt:()=>{},
    finish:value=>{state.result=value;},status:current=>library.status({operationId:current.operationId})};
  vm.createContext(context);vm.runInContext(handler,context);
  return{state,context,panel,library,host,publication,pauseController,archive:()=>imported};
}

test('production submit -> navigation -> coordinator -> actual archive keeps a live saved snapshot stable',async()=>{
  const f=await fixture();await f.pauseController.setOverlay(true);await f.context.submit();assert.equal(f.state.error,'');assert.equal(f.state.imports,1);
  assert.deepEqual(f.state.calls.map(row=>row.channel),['worldTemplate.capture','worldTemplate.describe','worldTemplate.save','worldTemplate.releaseCapture']);
  assert.equal(f.state.calls[0].args.operationId,f.state.calls.at(-1).args.operationId);assert.equal(f.state.live,false);
  const archive=await validateArchive(f.archive());assert.equal(archive.snapshot.body.tick,95);assert.equal(archive.manifest.source.revision,11);
  assert.equal(archive.manifest.source.snapshotHash,sha(JSON.stringify(archive.snapshot)));
  // The ordinary asset-close flow only removes the overlay blocker. It needs
  // no extra runtimeResume because publication released its own manual intent.
  await f.pauseController.setOverlay(false);assert.equal(f.state.live,true);
});

test('the former nonfreezing handler reproduces source drift without importing a version',async()=>{
  const f=await fixture({legacy:true});await f.context.submit();assert.equal(f.state.imports,0);assert.equal(f.state.tick,96);
  assert.match(f.state.error,/changed/i);assert.equal((await f.library.status({operationId:f.context.latestAttempt.current.operationId})).error,'WORLD_TEMPLATE_SOURCE_CHANGED');
});

test('a real source revision change is still rejected after freeze and retains the original operation',async()=>{
  const f=await fixture({changed:true});await f.context.submit();assert.equal(f.state.imports,0);assert.match(f.state.error,/changed/i);
  assert(f.context.latestAttempt.current);assert.equal(f.state.live,true);
  const original=JSON.stringify(f.context.latestAttempt.current.args);f.state.tick++;
  await f.context.submit();assert.equal(f.state.imports,0);assert.equal(JSON.stringify(f.context.latestAttempt.current.args),original);
  assert.equal(f.state.calls.filter(row=>row.channel==='worldTemplate.capture').length,1);assert.match(f.state.error,/Cancel any retained save/);
});

for(const option of ['saveFailure','cancelDuringSave','unmountDuringSave','selectedOther'])test(option+' stops before describe/save and releases only its own pause',async()=>{
  const f=await fixture({[option]:true});await f.context.submit();assert.equal(f.state.imports,0);
  assert.deepEqual(f.state.calls.map(row=>row.channel),['worldTemplate.capture','worldTemplate.releaseCapture']);assert.equal(f.context.latestAttempt.current,null);
  if(!['cancelDuringSave','unmountDuringSave'].includes(option))assert(f.state.error);
  assert.equal(f.state.live,true);
});

test('publication completion and asset close preserve an existing manual pause',async()=>{
  const f=await fixture({manual:true});await f.pauseController.setOverlay(true);await f.context.submit();
  assert.equal(f.state.imports,1);await f.pauseController.setOverlay(false);assert.equal(f.state.live,false);
});

test('failed checkpoint retains an earlier manual pause, and shutdown disposal never releases it',async()=>{
  const f=await fixture({manual:true,saveFailure:true});await f.context.submit();assert.equal(f.state.live,false);
  const normal=await fixture();await normal.publication.request('worldTemplate.capture',{worldId:'world-publication',operationId:'shutdown-capture'});
  normal.publication.dispose();assert.equal(normal.state.live,false);
  await assert.rejects(normal.publication.request('worldTemplate.releaseCapture',{worldId:'world-publication',operationId:'shutdown-capture'}),/UNAVAILABLE/);
});

for(const blocker of ['later-manual-pause','candidate','replacement-instance','joined-checkpoint'])test(blocker+' cannot be released by an older publication closure',async()=>{
  const f=await fixture();if(blocker==='joined-checkpoint')await f.host.checkpoint();
  const capture=await f.host.checkpointForPublication();
  if(blocker==='later-manual-pause')await f.host.pause();
  if(blocker==='candidate')f.host.stagedRequest={worldId:'world-publication'};
  if(blocker==='replacement-instance')f.host.current={...f.host.current,instanceId:'replacement'};
  await capture.release();await capture.release();assert.equal(f.state.live,false);
});

test('capture release is exact-operation owned, concurrent capture refuses, and stale release cannot resume the next publication',async()=>{
  const f=await fixture(),request=(method,operationId,worldId='world-publication')=>f.publication.request('worldTemplate.'+method,{worldId,operationId});
  await request('capture','capture-first');assert.equal(f.state.live,false);
  await assert.rejects(request('capture','capture-second'),/WORLD_BUSY/);
  await assert.rejects(request('releaseCapture','capture-first','other-world'),/OPERATION_CONFLICT/);
  await request('releaseCapture','capture-first');assert.equal(f.state.live,true);
  await request('capture','capture-second');await request('releaseCapture','capture-first');assert.equal(f.state.live,false);
  await request('releaseCapture','capture-second');assert.equal(f.state.live,true);
  await request('releaseCapture','cancelled-before-capture');await assert.rejects(request('capture','cancelled-before-capture'),/CAPTURE_RELEASED/);
});

test('release waits for capture and archive work, including a failed save, before restoring its own pause',async()=>{
  let finishCapture,finishSave,releases=0;
  const capturePromise=new Promise(resolve=>finishCapture=resolve),savePromise=new Promise((_,reject)=>finishSave=reject);
  const panel=createWorldTemplatePanel({selection:async()=>'world',capture:()=>capturePromise,capturePreview:async()=>null,pick:async()=>null,domain:async()=>savePromise});
  const args={worldId:'world',operationId:'capture-pending'};
  const acquiring=panel.request('worldTemplate.capture',args);await new Promise(resolve=>setImmediate(resolve));
  const saving=panel.request('worldTemplate.save',{...args,includePreview:false});
  const saveFailure=assert.rejects(saving,/ARCHIVE_FAILED/);await new Promise(resolve=>setImmediate(resolve));
  const releasing=panel.request('worldTemplate.releaseCapture',args);assert.equal(releases,0);
  finishCapture({receipt:{saved:true},release:async()=>{releases++;}});await acquiring;await new Promise(resolve=>setImmediate(resolve));assert.equal(releases,0);
  finishSave(Error('ARCHIVE_FAILED'));await saveFailure;await releasing;assert.equal(releases,1);
  await panel.request('worldTemplate.releaseCapture',args);assert.equal(releases,1);
  await assert.rejects(panel.request('worldTemplate.capture',{...args,pauseState:false}),/INVALID_PARAMS/);
});

test('the real main callback cannot release a publication pause after shutdown, export or restoration takes ownership',async()=>{
  const main=fs.readFileSync(path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/index.ts'),'utf8');
  const start=main.indexOf('  capture: async worldId => {',main.indexOf('const playerWorldTemplates ='));
  const code='globalThis.captureFn=({'+main.slice(start,main.indexOf('  pick:',start))+'}).capture;';
  for(const owner of ['quitting','craftmineQuitPreparation','craftmineQuitPrepared','profileRestore','copy','export','restore','candidate']){
    const f=await fixture(),context={godotSelection:async()=>'world-publication',godotWorld:f.host,quitting:false,craftmineQuitPreparation:false,craftmineQuitPrepared:false,profileRestore:false,godotExportBusy:false,godotCandidates:{blocking:false},godotCopies:{busy:false},godotRestores:{busy:false}};
    vm.createContext(context);vm.runInContext(transformSync(code,{loader:'ts',target:'es2022'}).code,context);
    const capture=await context.captureFn('world-publication');
    if(owner==='copy')context.godotCopies.busy=true;else if(owner==='restore')context.godotRestores.busy=true;else if(owner==='candidate')context.godotCandidates.blocking=true;else if(owner==='export')context.godotExportBusy=true;else context[owner]=true;
    await capture.release();assert.equal(f.state.live,false,owner);
  }
});
