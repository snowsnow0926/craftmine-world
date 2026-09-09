// Exercises the real host class with deterministic transport/store fault injection.
// No Electron, browser, Godot import, OS input, or actual durable-store claim.
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts',import.meta.url),'utf8');
const compiled = stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const directory = await mkdtemp(join(tmpdir(),'godot-host-lifecycle-'));
const root = join(directory,'builds'); await mkdir(root);
const deferred=()=>{let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve};};
function fixture() {
  const events=[], runtimes=[];
  let fault=null, descriptor=null, startupGate=null, callback=null;
  const context={module:{exports:{}},join,resolve,sep,realpath,setInterval,clearInterval,console,
    WORLD_CHROME_HEIGHT:76,GODOT_WORLD_MESSAGE_CHANNEL:'message',GODOT_WORLD_DETACH_CHANNEL:'detach',
    async createWorldRuntime(options){
      events.push('start:'+options.worldId);
      if(startupGate) await startupGate.promise;
      const runtime={...options,instanceId:'instance-'+runtimes.length,url:'http://127.0.0.1/test',origin:'http://127.0.0.1',
        attach(){return ()=>{};},onEvent(){},async waitReady(){if(fault==='startup')throw Error('broken candidate');},
        async load(){return {};},async pause(){events.push('pause:'+options.worldId);return fault==='pause'?{error:'pause rejected'}:{};},
        async resume(){events.push('resume:'+options.worldId);return {};},
        async save(){events.push('save:'+options.worldId);return {result:{status:'confirmed',state:{coins:7},runnerReceipt:{sha256:'a'.repeat(64)}}};},
        async acknowledge(){return {};},async snapshot(){return {result:{state:{coins:7}}};},async request(){return {};},
        async exit(){events.push('exit:'+options.worldId);return {};},async dispose(){events.push('dispose:'+options.worldId);}
      };runtimes.push(runtime);return runtime;
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
  host.createView=()=>({webContents:{async loadURL(){},on(){},once(){},send(){},isDestroyed(){return false;},close(){events.push('close-view');}}});
  const request=(worldId='alpha',revision=8)=>({worldId,buildId:'build-'+worldId,revision,root,artifacts:[{path:'index.html',sha256:'a'.repeat(64),bytes:0}]});
  return {host,events,runtimes,request,metadata:context.module.exports.godotEngineOf,setFault:x=>fault=x,setDescriptor:x=>descriptor=x,setGate:x=>startupGate=x,setProgress:x=>callback=x};
}

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
  assert.ok(!f.events.includes('exit:alpha'));assert.equal(f.host.instance.worldId,'alpha');assert.ok(f.events.includes('resume:alpha'));
});
test('concurrent startup rejected before runtime async creation completes',async()=>{
  const f=fixture(),gate=deferred();f.setGate(gate);const first=f.host.ensure(f.request());
  await assert.rejects(f.host.ensure(f.request('beta')),/WORLD_BUSY/);gate.resolve();await first;assert.equal(f.runtimes.length,1);
});
test('dispose during startup cannot resurrect the world',async()=>{
  const f=fixture(),gate=deferred();f.setGate(gate);const first=f.host.ensure(f.request());
  while(!f.events.includes('start:alpha'))await new Promise(r=>setImmediate(r));
  f.host.dispose();gate.resolve();await assert.rejects(first,/cancelled/);assert.equal(f.host.instance,null);assert.ok(f.events.includes('dispose:alpha'));
});
test('missing revision is rejected instead of guessed zero',async()=>{
  const f=fixture(),request=f.request();delete request.revision;await assert.rejects(f.host.ensure(request),/revision is required/);assert.equal(f.runtimes.length,0);
});
test('concurrent save requests share one persistence transaction',async()=>{
  const f=fixture();await f.host.ensure(f.request());const gate=deferred();f.setProgress(async call=>{await gate.promise;return {receipt:{format:'craftmine.progress-receipt/1',worldId:call.worldId,buildId:call.buildId,revision:call.revision+1,contentHash:'b'.repeat(64)}};});
  const first=f.host.save(),second=f.host.save();gate.resolve();await Promise.all([first,second]);assert.equal(f.events.filter(x=>x.startsWith('persist:')).length,1);
});

test('outside canonical build root is rejected before a runtime starts',async()=>{
  const f=fixture();await assert.rejects(f.host.ensure({...f.request(),root:directory}),/outside the allowed/);assert.equal(f.runtimes.length,0);
});
test('checkpoint waits for earlier save then takes a fresh snapshot after pause',async()=>{
  const f=fixture();await f.host.ensure(f.request());const gate=deferred();let count=0;
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
