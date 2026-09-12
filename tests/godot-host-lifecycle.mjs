// Exercises the real host class with deterministic transport/store fault injection.
// No Electron, browser, Godot import, OS input, or actual durable-store claim.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createWorldRuntime} from '../desktop/godot/web/runtime.mjs';
import {createGodotRuntimeAdapter} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-runtime-adapter.ts';
import * as immersionTools from './helpers/immersion-host-tools.mjs';
import {PRIVATE_PLAY_OPS} from '../vendor/pi-desktop/apps/desktop/electron/main/headless-play-action.ts';
import {WORLD_CURSOR_CHANNEL} from '../vendor/pi-desktop/apps/desktop/shared/world-cursor-presentation.ts';

const source = await readFile(new URL('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts',import.meta.url),'utf8');
const compiled = stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const layers=stripTypeScriptTypes(await readFile(new URL('../vendor/pi-desktop/apps/desktop/electron/main/main-window-layers.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const {setMainViewBackground}=vm.runInNewContext(layers+'\n({setMainViewBackground})',immersionTools);
const directory = await mkdtemp(join(tmpdir(),'godot-host-lifecycle-'));
const root = join(directory,'builds'); await mkdir(root);
const deferred=()=>{let resolve,reject; const promise=new Promise((r,j)=>{resolve=r;reject=j;}); return {promise,resolve,reject};};
function fixture(clock={setTimeout,clearTimeout}) {
  const events=[], runtimes=[];
  let fault=null, descriptor=null, startupGate=null, callback=null, runtimeSetup=null, factory=null;
  const context={module:{exports:{}},join,resolve,sep,realpath,setInterval,clearInterval,...clock,console,...immersionTools,
    hasHeadlessController:()=>false,PRIVATE_PLAY_OPS,setMainViewBackground,WORLD_CURSOR_CHANNEL,
    WORLD_CHROME_HEIGHT:76,GODOT_WORLD_MESSAGE_CHANNEL:'message',GODOT_WORLD_DETACH_CHANNEL:'detach',
    async createWorldRuntime(options){
      events.push('start:'+options.worldId);
      if(startupGate) await startupGate.promise;
      if(factory)return factory(options);
      if(fault==='factory')throw Error('factory failed');
      const runtime={...options,instanceId:'instance-'+runtimes.length,url:'http://127.0.0.1/test',origin:'http://127.0.0.1',
        requests:[],
        attach(){return ()=>{};},onEvent(){},async waitReady(){if(fault==='startup')throw Error('broken candidate');},
        async load(){return {};},async pause(){events.push('pause:'+options.worldId);return fault==='pause'?{error:'pause rejected'}:{};},
        async resume(){events.push('resume:'+options.worldId);return {};},
        async save(){events.push('save:'+options.worldId);return {result:{status:'confirmed',state:{coins:7},runnerReceipt:{sha256:'a'.repeat(64)}}};},
        async acknowledge(){return {};},async snapshot(){return {result:{state:{coins:7}}};},async request(){return {};},
        async exit(){events.push('exit:'+options.worldId);return {};},async dispose(){events.push('dispose:'+options.worldId);}
      };runtimeSetup?.(runtime);runtimes.push(runtime);return runtime;
    }};
  vm.runInNewContext(compiled+'\nmodule.exports={GodotWorldViewHost,godotEngineOf};',context);
  const host=new context.module.exports.GodotWorldViewHost({window:()=>null,allowedRoots:()=>[root],
    descriptor:async()=>{if(fault==='descriptor')throw Error('temporary RPC failure');return descriptor;},
    progress:async call=>{
      events.push('persist:'+call.worldId+':'+call.revision);
      if(callback) return callback(call);
      if(fault==='persist')return {failed:true,error:'disk unavailable'};
      const receipt={format:'craftmine.progress-receipt/1',worldId:call.worldId,buildId:call.buildId,revision:call.revision+1,contentHash:'b'.repeat(64)};
      if(fault==='hash')delete receipt.contentHash;
      if(fault==='identity')receipt.worldId='foreign';
      if(fault==='revision')receipt.revision=call.revision-1;
      return {receipt};
    }});
  host.createView=()=>{const contents=new EventEmitter();let destroyed=false,backgroundThrottling=true;return {webContents:Object.assign(contents,{async loadURL(){},send(){},setBackgroundThrottling(value){backgroundThrottling=value;},getBackgroundThrottling(){return backgroundThrottling;},isDestroyed(){return destroyed;},close(){events.push('close-view');destroyed=true;contents.emit('destroyed');}})};};
  const request=(worldId='alpha',revision=8)=>({worldId,buildId:'build-'+worldId,revision,root,artifacts:[{path:'index.html',sha256:'a'.repeat(64),bytes:0}]});
  return {host,events,runtimes,request,metadata:context.module.exports.godotEngineOf,setFault:x=>fault=x,setDescriptor:x=>descriptor=x,setGate:x=>startupGate=x,setProgress:x=>callback=x,setRuntime:x=>runtimeSetup=x,setFactory:x=>factory=x};
}

const compactImmersion={active:true,overlay:'compact',overlayBounds:{x:0,y:400,width:800,height:200}};
const closedImmersion={active:true,overlay:'closed',overlayBounds:null};

test('manual pause survives overlay close and failed save/replacement recovery',async()=>{
  const f=fixture();await f.host.ensure(f.request());await f.host.pause();f.events.length=0;
  await f.host.setImmersion(compactImmersion);await f.host.setImmersion(closedImmersion);
  f.setFault('persist');assert.equal((await f.host.checkpoint()).status,'failed');
  assert.equal(f.host.pauseController.manualPaused(f.host.current),true);assert.ok(!f.events.includes('resume:alpha'));
  f.setFault('startup');await assert.rejects(f.host.ensure(f.request('beta')),/broken candidate/);
  assert.equal(f.host.pauseController.manualPaused(f.host.current),true);assert.ok(!f.events.includes('resume:alpha'));
});

test('failed save during overlay restores running intent without premature resume',async()=>{
  const f=fixture();await f.host.ensure(f.request());await f.host.setImmersion(compactImmersion);f.events.length=0;
  f.setFault('persist');assert.equal((await f.host.checkpoint()).status,'failed');
  assert.equal(f.host.state.state,'paused');assert.ok(!f.events.includes('resume:alpha'));
  await f.host.setImmersion(closedImmersion);
  assert.equal(f.host.state.state,'ready');assert.equal(f.events.filter(event=>event==='resume:alpha').length,1);
});

test('failed pause acknowledgement cannot trigger automatic checkpoint resume',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.events.length=0;f.setFault('pause');
  assert.equal((await f.host.checkpoint()).status,'failed');
  assert.deepEqual(f.events,['pause:alpha']);
  assert.equal(f.host.pauseController.manualPaused(f.host.current),true);
});

test('save and quit recover a committed snapshot whose reply and first reconciliation were lost',async()=>{
  const f=fixture(),hash=text=>createHash('sha256').update(text).digest('hex');
  let state={format:'craftmine.godot-progress/1',worldId:'alpha',body:{coins:7,quest:{complete:false}}},stored=structuredClone(state),revision=8,lose=true,readsUnavailable=true;
  f.setRuntime(runtime=>{runtime.save=async()=>{const snapshot=structuredClone(state),snapshotText=JSON.stringify(snapshot);return {result:{status:'confirmed',state:snapshot,runnerReceipt:{format:'craftmine.godot-runner-receipt/1',worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId,snapshotText,snapshotSha256:hash(snapshotText),bytes:Buffer.byteLength(snapshotText)}}};};});
  const adapter=createGodotRuntimeAdapter({selection:async()=> 'alpha',instance:()=>f.host.instance,domain:async(method,args)=>{
    if(method==='world.read'){if(readsUnavailable)throw Error('read transport unavailable');return {id:'alpha',world:{build:{id:'build-alpha'},snapshot:structuredClone(stored)},revision,contentHash:'c'.repeat(64)};}
    assert.equal(method,'godotRuntime.saveProgress');
    if(args.revision!==revision)throw Object.assign(Error('WORLD_REVISION_CONFLICT'),{errorCode:'WORLD_REVISION_CONFLICT'});
    stored=structuredClone(args.snapshot);revision++;
    if(lose){lose=false;throw Error('reply lost after commit');}
    return {receipt:{format:'craftmine.godot-progress-receipt/1',worldId:'alpha',buildId:'build-alpha',instanceId:args.runnerReceipt.instanceId,snapshotSha256:args.runnerReceipt.snapshotSha256,revision,contentHash:'c'.repeat(64)}};
  }});
  f.setProgress(call=>adapter.progress(call));await f.host.ensure(f.request());
  state.body.coins=8;assert.equal((await f.host.checkpoint()).status,'failed');assert.equal(f.host.revision,8);assert.equal(stored.body.coins,8);
  assert.equal(f.host.instance.worldId,'alpha','failed acknowledgement leaves the live original world available');
  readsUnavailable=false;state.body.quest.complete=true;
  const saved=await f.host.checkpoint();assert.equal(saved.status,'persisted');assert.equal(f.host.revision,10);assert.deepEqual(stored,state);
  const quit=await f.host.prepareForQuit();assert.equal(quit.ok,true);assert.equal(revision,10,'quit uses the now-confirmed frozen snapshot');
  assert.ok(f.events.includes('exit:alpha'));await f.host.dispose();
});

test('exited and fatally failed runtimes receive no subsequent overlay commands',async()=>{
  for(const stop of [host=>host.handleEvent(host.current,{type:'exited'}),host=>host.fail(host.current,'renderer gone',true)]){
    const f=fixture();await f.host.ensure(f.request());const old=f.host.current;f.events.length=0;
    stop(f.host);assert.equal(f.host.pauseController.has(old),false);
    await f.host.setImmersion(compactImmersion);await f.host.setImmersion(closedImmersion);
    assert.deepEqual(f.events,[]);
  }
});

test('manual pause arriving during failed persistence is preserved',async()=>{
  const f=fixture();await f.host.ensure(f.request());const gate=deferred();
  f.setProgress(async()=>{await gate.promise;return {failed:true,error:'disk unavailable'};});
  f.events.length=0;const pending=f.host.checkpoint();
  while(!f.events.some(event=>event.startsWith('persist:')))await new Promise(resolve=>setImmediate(resolve));
  await f.host.pause();gate.resolve();assert.equal((await pending).status,'failed');
  assert.equal(f.host.pauseController.manualPaused(f.host.current),true);assert.ok(!f.events.includes('resume:alpha'));
});

test('switch freezes and persists exact durable revision before starting replacement',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.events.length=0;
  await f.host.ensure(f.request('beta',24));
  assert.deepEqual(f.events.slice(0,4),['pause:alpha','save:alpha','persist:alpha:8','start:beta']);
  assert.equal(f.host.instance.worldId,'beta');await f.host.save();assert.ok(f.events.includes('persist:beta:24'));
});
test('save failure preserves and resumes old instance; no new runner starts',async()=>{
  const f=fixture();await f.host.ensure(f.request());const old=f.host.instance.instanceId;f.setFault('persist');
  await assert.rejects(f.host.ensure(f.request('beta')),/disk unavailable/);
  assert.equal(f.host.instance.instanceId,old);assert.ok(f.events.includes('resume:alpha'));assert.ok(!f.events.includes('start:beta'));
});
test('failed candidate resumes the saved old instance without destroying it',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.setFault('startup');await assert.rejects(f.host.ensure(f.request('beta')),/broken candidate/);
  assert.equal(f.host.instance.worldId,'alpha');assert.equal(f.host.state.state,'ready');assert.ok(!f.events.includes('dispose:alpha'));
});
test('temporary descriptor failure never closes or saves current world',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.events.length=0;f.setFault('descriptor');await f.host.sync({force:true});
  assert.equal(f.host.instance.worldId,'alpha');assert.deepEqual(f.events,[]);
});

test('failed saved selection is not recreated by forced polling; explicit retry still runs',async()=>{
  const f=fixture();f.setDescriptor(f.request());f.setFault('startup');
  await f.host.sync({force:true});assert.equal(f.host.state.state,'failed');
  for(let i=0;i<5;i++)await f.host.sync({force:true});
  assert.equal(f.events.filter(e=>e==='start:alpha').length,1);
  f.setFault(null);await f.host.ensure(f.request());
  assert.equal(f.events.filter(e=>e==='start:alpha').length,2);assert.equal(f.host.state.state,'ready');
  await f.host.dispose();
});

test('explicit failed open suppresses automatic retries, but changed saved inputs can recover',async()=>{
  for(const changed of [r=>({...r,revision:r.revision+1}),r=>({...r,buildId:'build-fixed'}),r=>({...r,snapshot:{player:{position:[0,.9,6]}}}),r=>({...r,artifacts:[{path:'index.html',sha256:'c'.repeat(64),bytes:1}]})]){
    const f=fixture(),request=f.request();f.setDescriptor(request);f.setFault('startup');
    await assert.rejects(f.host.ensure(request),/broken candidate/);await f.host.sync({force:true});
    assert.equal(f.runtimes.length,1);f.setFault(null);f.setDescriptor(changed(request));
    await f.host.sync({force:true});assert.equal(f.runtimes.length,2);assert.equal(f.host.state.state,'ready');await f.host.dispose();
  }
});

test('failed replacement polling preserves the old live instance and does not resave it repeatedly',async()=>{
  const f=fixture();await f.host.ensure(f.request());const original=f.host.instance.instanceId;
  f.setDescriptor(f.request('beta'));f.setFault('startup');await f.host.sync({force:true});
  const attempts=f.events.length;for(let i=0;i<3;i++)await f.host.sync({force:true});
  assert.equal(f.events.length,attempts);assert.equal(f.host.instance.instanceId,original);
  f.setFault(null);f.setDescriptor(null);await f.host.sync({force:true});
  f.setDescriptor(f.request('beta'));await f.host.sync({force:true});assert.equal(f.host.instance.worldId,'beta');await f.host.dispose();
});

test('polling while a first candidate is staged cannot poison the formal selection after discard',async()=>{
  const f=fixture(),formal=f.request();f.setDescriptor(formal);
  await f.host.stageCandidate({...formal,buildId:'candidate-build'},{first:true,candidateId:'candidate-proof'});
  await f.host.sync({force:true});assert.equal(f.runtimes.length,1);assert.notEqual(f.host.state?.state,'failed');
  await f.host.discardCandidate();await f.host.sync({force:true});
  assert.equal(f.runtimes.length,2);assert.equal(f.host.instance.buildId,formal.buildId);assert.equal(f.host.state.state,'ready');await f.host.dispose();
});
test('null descriptor safely checkpoints then departs; failure keeps old world',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.setFault('persist');await f.host.sync({force:true});assert.equal(f.host.instance.worldId,'alpha');
  f.setFault(null);await f.host.sync({force:true});assert.equal(f.host.instance,null);assert.ok(f.events.indexOf('persist:alpha:8')<f.events.indexOf('dispose:alpha'));
});
test('explicit checkpoint is reused only while paused',async()=>{
  const f=fixture();await f.host.ensure(f.request());const a=await f.host.checkpoint(),b=await f.host.checkpoint();assert.equal(a,b);
  assert.equal(f.host.state.state,'paused');await assert.rejects(f.host.request('fire'),/WORLD_BUSY/);
  await f.host.resume();await f.host.checkpoint();assert.deepEqual(f.events.filter(x=>x.startsWith('persist:')),['persist:alpha:8','persist:alpha:9']);
});
for(const fault of ['hash','identity','revision','pause'])test('invalid '+fault+' cannot authorize quit',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.setFault(fault);const result=await f.host.prepareForQuit();assert.equal(result.ok,false);
  assert.ok(!f.events.includes('exit:alpha'));assert.equal(f.host.instance.worldId,'alpha');
  if(fault==='pause')assert.equal(f.events.filter(event=>event==='resume:alpha').length,1,'only initial startup may resume');
  else assert.ok(f.events.includes('resume:alpha'));
});
test('concurrent startup rejected before runtime async creation completes',async()=>{
  const f=fixture(),gate=deferred();f.setGate(gate);const first=f.host.ensure(f.request());
  await assert.rejects(f.host.ensure(f.request('beta')),/WORLD_BUSY/);gate.resolve();await first;assert.equal(f.runtimes.length,1);
});
test('dispose during startup cannot resurrect the world',async()=>{
  const f=fixture(),gate=deferred();f.setGate(gate);const first=f.host.ensure(f.request());
  while(!f.events.includes('start:alpha'))await new Promise(r=>setImmediate(r));
  const disposal=f.host.dispose();gate.resolve();await assert.rejects(first,/cancelled/);await disposal;assert.equal(f.host.instance,null);assert.ok(f.events.includes('dispose:alpha'));
});
test('missing revision is rejected instead of guessed zero',async()=>{
  const f=fixture(),request=f.request();delete request.revision;await assert.rejects(f.host.ensure(request),/revision is required/);assert.equal(f.runtimes.length,0);
});

test('shutdown disposal waits for owned runtime cleanup and shares concurrent callers',async()=>{
  const f=fixture(),gate=deferred();await f.host.ensure(f.request());let cleaned=false,returned=false;
  f.runtimes[0].dispose=async()=>{await gate.promise;cleaned=true;};
  const first=f.host.dispose(),second=f.host.dispose();assert.equal(first,second);
  first.then(()=>{returned=true;});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(returned,false);assert.equal(cleaned,false);assert.equal(f.host.instance,null);
  gate.resolve();await first;assert.equal(cleaned,true);assert.equal(returned,true);
});
test('concurrent save requests share one persistence transaction',async()=>{
  const f=fixture();await f.host.ensure(f.request());const gate=deferred();f.setProgress(async call=>{await gate.promise;return {receipt:{format:'craftmine.progress-receipt/1',worldId:call.worldId,buildId:call.buildId,revision:call.revision+1,contentHash:'b'.repeat(64)}};});
  const first=f.host.save(),second=f.host.save();gate.resolve();await Promise.all([first,second]);assert.equal(f.events.filter(x=>x.startsWith('persist:')).length,1);
});

test('outside canonical build root is rejected before a runtime starts',async()=>{
  const f=fixture();await assert.rejects(f.host.ensure({...f.request(),root:directory}),/outside the allowed/);assert.equal(f.runtimes.length,0);
});
test('checkpoint waits for earlier save then takes a fresh snapshot after pause',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.events.length=0;const gate=deferred();let count=0;
  f.setProgress(async call=>{if(++count===1)await gate.promise;return {receipt:{format:'craftmine.progress-receipt/1',worldId:call.worldId,buildId:call.buildId,revision:call.revision+1,contentHash:'b'.repeat(64)}};});
  const save=f.host.save(),checkpoint=f.host.checkpoint();gate.resolve();await save;assert.equal((await checkpoint).status,'persisted');
  assert.deepEqual(f.events.filter(x=>x.startsWith('save:')||x.startsWith('pause:')||x.startsWith('persist:')),['save:alpha','persist:alpha:8','pause:alpha','save:alpha','persist:alpha:9']);
});

test('B formal build metadata is recognized without trusting document filesystem paths',()=>{
  const f=fixture();
  const metadata=f.metadata({id:'gbd-example',scene:{format:'craftmine.godot-scene/1'},godot:{target:'web'},engine:{root:'C:/private',entry:'secret.txt'}});
  assert.equal(metadata.buildId,'gbd-example');assert.equal(metadata.kind,'godot-web');assert.equal(metadata.root,undefined);assert.equal(metadata.entry,undefined);
  assert.equal(f.metadata({engine:{kind:'godot-web',buildId:'fixture',root:'C:/private'}}).root,undefined);
});

test('formal world disposal waits for destroyed even after runtime cleanup, without closing twice',async()=>{
  const f=fixture();await f.host.ensure(f.request());
  const contents=f.host.current.view.webContents;let closes=0,done=false;
  contents.close=()=>{closes++;};
  const first=f.host.close(),disposal=f.host.dispose();
  assert.equal(f.host.dispose(),disposal);disposal.then(()=>done=true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.equal(closes,1);
  contents.emit('destroyed');await Promise.all([first,disposal]);assert.equal(done,true);assert.equal(closes,1);
});

test('missing renderer destroyed event rejects disposal with a specific timeout and removes listener',async()=>{
  let deadline;
  const f=fixture({setTimeout:callback=>{deadline=callback;return 1;},clearTimeout(){}});await f.host.ensure(f.request());
  const instance=f.host.current,contents=instance.view.webContents;contents.close=()=>{};
  const disposal=f.host.dispose(),rejected=assert.rejects(disposal,/GODOT_RENDERER_CLOSE_TIMEOUT/);
  await new Promise(resolve=>setImmediate(resolve));deadline();await rejected;assert.equal(contents.listenerCount('destroyed'),1); // The separate diagnostics listener remains.
  assert.ok(instance.faults.some(value=>value.includes('GODOT_RENDERER_CLOSE_TIMEOUT')));
  assert.equal(f.host.dispose(),disposal);
});

test('dispose waits for a replaced instance no longer in current or pending',async()=>{
  const f=fixture();await f.host.ensure(f.request());
  const previous=f.host.current,contents=previous.view.webContents;contents.close=()=>{};
  const replacement=f.host.ensure(f.request('beta',24));
  while(f.host.current===previous)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.host.current.worldId,'beta');assert.equal(f.host.pending,null);
  let stopped=false;const disposal=f.host.dispose();disposal.then(()=>stopped=true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);
  contents.emit('destroyed');await Promise.all([replacement,disposal]);assert.equal(stopped,true);
});

test('an already retired renderer timeout remains a shutdown failure after replacement succeeds',async()=>{
  const timers=new Map();let sequence=0;
  const f=fixture({setTimeout:callback=>{timers.set(++sequence,callback);return sequence;},clearTimeout:id=>timers.delete(id)});
  await f.host.ensure(f.request());const previous=f.host.current;previous.view.webContents.close=()=>{};
  const replacement=f.host.ensure(f.request('beta',24));
  while(!timers.size)await new Promise(resolve=>setImmediate(resolve));
  const expire=[...timers.values()][0];expire();await replacement;
  assert.equal(f.host.current.worldId,'beta');assert.equal(f.host.retiring.size,0);
  await assert.rejects(f.host.dispose(),/GODOT_RETIREMENT_INCOMPLETE.*GODOT_RENDERER_CLOSE_TIMEOUT/);
});

test('dispose waits for a pending factory and its later returned runtime cleanup',async()=>{
  const f=fixture(),factory=deferred(),cleanup=deferred();f.setGate(factory);
  f.setRuntime(runtime=>{runtime.dispose=async()=>{f.events.push('cleanup-entered');await cleanup.promise;};});
  const opening=f.host.ensure(f.request()),cancelled=assert.rejects(opening,/cancelled/);
  while(!f.events.includes('start:alpha'))await new Promise(resolve=>setImmediate(resolve));
  let done=false;const disposal=f.host.dispose();assert.equal(f.host.dispose(),disposal);disposal.then(()=>done=true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.equal(f.host.pending,null);
  factory.resolve();while(!f.events.includes('cleanup-entered'))await new Promise(resolve=>setImmediate(resolve));
  assert.equal(done,false);cleanup.resolve();await Promise.all([disposal,cancelled]);assert.equal(done,true);assert.equal(f.host.starting.size,0);
});

test('factory failure is preserved for its caller while disposal waits for that failure to settle',async()=>{
  const f=fixture(),factory=deferred();f.setGate(factory);f.setFault('factory');
  const opening=f.host.ensure(f.request()),failed=assert.rejects(opening,/factory failed/);
  while(!f.events.includes('start:alpha'))await new Promise(resolve=>setImmediate(resolve));
  let done=false;const disposal=f.host.dispose();disposal.then(()=>done=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
  factory.resolve();await Promise.all([failed,disposal]);assert.equal(f.runtimes.length,0);assert.equal(f.host.instance,null);
});

test('cleanup failure from a late factory result rejects disposal instead of being hidden by cancellation',async()=>{
  const f=fixture(),factory=deferred();f.setGate(factory);
  f.setRuntime(runtime=>{runtime.dispose=async()=>{throw Error('LATE_RUNTIME_CLOSE_FAILED');};});
  const opening=f.host.ensure(f.request()),cancelled=assert.rejects(opening,/cancelled/);
  while(!f.events.includes('start:alpha'))await new Promise(resolve=>setImmediate(resolve));
  const disposal=f.host.dispose(),failed=assert.rejects(disposal,/GODOT_RETIREMENT_INCOMPLETE.*LATE_RUNTIME_CLOSE_FAILED/);
  factory.resolve();await Promise.all([failed,cancelled]);assert.equal(f.host.dispose(),disposal);
});

test('disposing an instance waiting for ready cancels it before draining startup, without a cycle',async()=>{
  const f=fixture(),ready=deferred();
  f.setRuntime(runtime=>{runtime.waitReady=()=>ready.promise;runtime.dispose=async()=>{ready.reject(Error('owned runtime disposed'));};});
  const opening=f.host.ensure(f.request()),cancelled=assert.rejects(opening,/owned runtime disposed/);
  while(!f.host.pending)await new Promise(resolve=>setImmediate(resolve));
  await Promise.all([f.host.dispose(),cancelled]);assert.equal(f.host.pending,null);assert.equal(f.host.instance,null);
});

test('stalled factory produces a sticky named shutdown timeout; a late runtime is still cleaned',async()=>{
  let deadline;
  const f=fixture({setTimeout:(callback,ms)=>{assert.equal(ms,10000);deadline=callback;return 1;},clearTimeout(){}}),factory=deferred();f.setGate(factory);
  const opening=f.host.ensure(f.request()),cancelled=assert.rejects(opening,/cancelled/);
  while(!f.events.includes('start:alpha'))await new Promise(resolve=>setImmediate(resolve));
  const disposal=f.host.dispose(),failure=assert.rejects(disposal,/GODOT_STARTUP_CLOSE_TIMEOUT/);deadline();await failure;
  factory.resolve();await cancelled;assert.ok(f.events.includes('dispose:alpha'));assert.equal(f.host.dispose(),disposal);
  await assert.rejects(f.host.dispose(),/GODOT_STARTUP_CLOSE_TIMEOUT/);
});

test('real local HTTP runtime returned after disposal starts is closed before disposal succeeds',async()=>{
  const f=fixture(),factory=deferred();f.setGate(factory);let actual;
  await writeFile(join(root,'index.html'),'owned');
  f.setFactory(async options=>{actual=await createWorldRuntime({worldId:options.worldId,buildId:options.buildId,root});return actual;});
  const opening=f.host.ensure(f.request()),cancelled=assert.rejects(opening,/cancelled/);
  while(!f.events.includes('start:alpha'))await new Promise(resolve=>setImmediate(resolve));
  const disposal=f.host.dispose();factory.resolve();await Promise.all([disposal,cancelled]);
  assert.ok(actual);await assert.rejects(fetch(actual.url));assert.equal(f.host.instance,null);
});

test('manual pause while checkpoint awaits an earlier save survives later persistence failure',async()=>{
  const f=fixture();await f.host.ensure(f.request());f.events.length=0;
  const saving=deferred();f.setProgress(()=>saving.promise);
  const earlier=f.host.save();const checkpoint=f.host.checkpoint();
  await f.host.pause();saving.resolve({failed:true,error:'disk unavailable'});
  await earlier;const result=await checkpoint;
  assert.equal(result.status,'failed');assert.equal(f.host.state.state,'failed');
  assert.ok(!f.events.includes('resume:alpha'));
  await f.host.setImmersion({active:true,overlay:'compact',overlayBounds:{x:0,y:200,width:300,height:100}});
  await f.host.setImmersion({active:false,overlay:'closed',overlayBounds:null});
  assert.ok(!f.events.includes('resume:alpha'));
});
