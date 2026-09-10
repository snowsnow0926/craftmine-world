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
  host.createView=()=>({webContents:{async loadURL(){},on(){},once(){},send(){},isDestroyed(){return this.closed===true;},close(){this.closed=true;events.push('close-view');}}});
  const request=(worldId='alpha',revision=8)=>({worldId,buildId:'build-'+worldId,revision,root,artifacts:[{path:'index.html',sha256:'a'.repeat(64),bytes:0}]});
  return {host,events,runtimes,request,metadata:context.module.exports.godotEngineOf,setFault:x=>fault=x,setDescriptor:x=>descriptor=x,setGate:x=>startupGate=x,setProgress:x=>callback=x};
}

test('staged runtime retains old identity and blocks formal saves/departure/quit',async()=>{
 const f=fixture();await f.host.ensure(f.request());await f.host.checkpoint();const original=f.host.instance.instanceId;f.events.length=0;
 const next={...f.request(),buildId:'build-v2'};await f.host.stageCandidate(next);
 assert.equal(f.host.instance.instanceId,original);assert.equal(f.host.candidateInstance.buildId,'build-v2');assert.ok(!f.events.includes('dispose:alpha'));
 assert.equal((await f.host.save()).status,'failed');assert.equal((await f.host.checkpoint()).status,'failed');assert.equal((await f.host.prepareForQuit()).ok,false);
 await assert.rejects(f.host.switchWorld(null),/CANDIDATE_ACTIVE/);assert.ok(!f.events.some(x=>x.startsWith('persist:')));
 await f.host.discardCandidate();assert.equal(f.host.instance.instanceId,original);assert.equal(f.host.candidateInstance,null);await f.host.close();
});
test('promotion requires matching committed artifacts and revision; only then disposes previous',async()=>{
 const f=fixture();await f.host.ensure(f.request());const original=f.host.instance.instanceId;const next={...f.request(),buildId:'build-v2'};await f.host.stageCandidate(next);const staged=f.host.candidateInstance.instanceId;
 await assert.rejects(f.host.promoteCandidate({...next,revision:8}),/PROMOTION_MISMATCH/);await assert.rejects(f.host.promoteCandidate({...next,revision:9,artifacts:[{path:'evil.html',sha256:'c'.repeat(64),bytes:0}]}),/PROMOTION_MISMATCH/);
 assert.equal(f.host.instance.instanceId,original);await f.host.promoteCandidate({...next,revision:9});assert.equal(f.host.instance.instanceId,staged);assert.equal(f.host.candidateInstance,null);assert.equal(f.host.state.state,'ready');await f.host.close();
});
test('bad candidate startup leaves original running object available for recovery',async()=>{
 const f=fixture();await f.host.ensure(f.request());const original=f.host.instance.instanceId;f.setFault('startup');await assert.rejects(f.host.stageCandidate({...f.request(),buildId:'bad'}),/broken candidate/);assert.equal(f.host.instance.instanceId,original);assert.equal(f.host.candidateInstance,null);await f.host.close();
});
test('candidate commands target pending runtime rather than formal request path',async()=>{
 const f=fixture();await f.host.ensure(f.request());await f.host.stageCandidate({...f.request(),buildId:'build-v2'});await f.host.candidateRequest('snapshot');await assert.rejects(f.host.request('snapshot'),/WORLD_BUSY/);await f.host.discardCandidate();await assert.rejects(f.host.candidateRequest('snapshot'),/UNAVAILABLE/);await f.host.close();
});
