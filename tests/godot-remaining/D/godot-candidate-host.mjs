// Exercises the real host class with deterministic transport/store fault injection.
// No Electron, browser, Godot import, OS input, or actual durable-store claim.
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import * as immersionTools from '../../helpers/immersion-host-tools.mjs';
import {PRIVATE_PLAY_OPS} from '../../../vendor/pi-desktop/apps/desktop/electron/main/headless-play-action.ts';

const source = await readFile(new URL('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts',import.meta.url),'utf8');
const compiled = stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const directory = await mkdtemp(join(tmpdir(),'godot-host-lifecycle-'));
const root = join(directory,'builds'); await mkdir(root);
const deferred=()=>{let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve};};
function fixture({cold = false} = {}) {
  const events=[], runtimes=[], views=[];
  let fault=null, descriptor=null, startupGate=null, callback=null, formalExists=!cold, pendingReady=null;
  const context={module:{exports:{}},join,resolve,sep,realpath,setInterval,clearInterval,setTimeout,clearTimeout,console,...immersionTools,
    hasHeadlessController:()=>false,PRIVATE_PLAY_OPS,
    WORLD_CHROME_HEIGHT:76,GODOT_WORLD_MESSAGE_CHANNEL:'message',GODOT_WORLD_DETACH_CHANNEL:'detach',
    async createWorldRuntime(options){
      events.push('start:'+options.worldId);
      if(startupGate) await startupGate.promise;
      const runtime={...options,instanceId:'instance-'+runtimes.length,url:'http://127.0.0.1/test',origin:'http://127.0.0.1',
        requests:[],
        attach(){return ()=>{};},onEvent(){},
        abortStartup(reason){if(!pendingReady)return false;const reject=pendingReady;pendingReady=null;reject(Error(reason));return true;},
        async waitReady(){
          if(fault==='startup')throw Error('broken candidate');
          if(fault==='hang')await new Promise((_resolve,reject)=>{pendingReady=reject;});
        },
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
  host.createView=()=>{
    const handlers={};
    const contents=new EventEmitter(),on=contents.on.bind(contents);
    Object.assign(contents,{async loadURL(){},setBackgroundThrottling(){},async executeJavaScript(){return {ready:'complete',visibility:'hidden',canvas:[640,360],raf:false};},on(name,handler){handlers[name]=handler;return on(name,handler);},send(){},isDestroyed(){return this.closed===true;},close(){this.closed=true;events.push('close-view');this.emit('destroyed');}});
    const view={webContents:contents};
    views.push({view,handlers});
    return view;
  };
  const request=(worldId='alpha',revision=8)=>({worldId,buildId:'build-'+worldId,revision,root,artifacts:[{path:'index.html',sha256:'a'.repeat(64),bytes:0}]});
  return {host,events,runtimes,views,request,metadata:context.module.exports.godotEngineOf,setFault:x=>fault=x,setDescriptor:x=>descriptor=x,setGate:x=>startupGate=x,setProgress:x=>callback=x};
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

test('cancelling a stalled candidate disposes diagnostics and retains the exact formal instance',async()=>{
 const f=fixture();await f.host.ensure(f.request());const original=f.host.instance.instanceId;
 f.setFault('hang');const staging=f.host.stageCandidate({...f.request(),buildId:'build-v2'});
 const rejected=assert.rejects(staging,/World startup was cancelled.*phase=wait-ready/);
 await waitFor(()=>f.views.length===2&&f.views[1].view.webContents.listenerCount('paint')===1);
 assert.equal(await f.host.cancelStaging('foreign'),false);
 assert.equal(await f.host.cancelStaging('alpha'),true);await rejected;
 assert.equal(f.views[1].view.webContents.listenerCount('paint'),0);
 assert.equal(f.views[1].view.webContents.isDestroyed(),true);
 assert.equal(f.views[0].view.webContents.isDestroyed(),false);
 assert.equal(f.host.instance.instanceId,original);await f.host.close();
});
test('candidate commands target pending runtime rather than formal request path',async()=>{
 const f=fixture();await f.host.ensure(f.request());await f.host.stageCandidate({...f.request(),buildId:'build-v2'});await f.host.candidateRequest('snapshot');await assert.rejects(f.host.request('snapshot'),/WORLD_BUSY/);await f.host.discardCandidate();await assert.rejects(f.host.candidateRequest('snapshot'),/UNAVAILABLE/);await f.host.close();
});
const waitFor=async predicate=>{for(let i=0;i<400;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('fixture condition was never reached');};
test('renderer crash during candidate startup fails fast with the renderer cause and keeps the original',async()=>{
 const f=fixture();await f.host.ensure(f.request());const original=f.host.instance.instanceId;
 f.setFault('hang');
 const staging=f.host.stageCandidate({...f.request(),buildId:'build-v2'});
 await waitFor(()=>f.views.length===2&&!!f.views[1].handlers['render-process-gone']);
 const handlers=f.views[1].handlers;
 handlers['console-message']({message:'WebGL: CONTEXT_LOST_WEBGL',level:'error'});
 handlers['render-process-gone']({},{reason:'crashed',exitCode:-1073741819});
 await assert.rejects(staging,/World renderer stopped: crashed[\s\S]*fault=render-process-gone crashed -1073741819[\s\S]*console\[error\]=WebGL: CONTEXT_LOST_WEBGL/);
 assert.equal(f.host.instance.instanceId,original);assert.equal(f.host.candidateInstance,null);assert.equal(f.host.diagnostics('candidate'),null);
 await f.host.close();
});
test('main-frame load failure during candidate startup fails fast and keeps the original',async()=>{
 const f=fixture();await f.host.ensure(f.request());const original=f.host.instance.instanceId;
 f.setFault('hang');
 const staging=f.host.stageCandidate({...f.request(),buildId:'build-v2'});
 await waitFor(()=>f.views.length===2&&!!f.views[1].handlers['did-fail-load']);
 f.views[1].handlers['did-fail-load']({},-105,'NAME_NOT_RESOLVED','http://127.0.0.1/x',true);
 await assert.rejects(staging,/failed to load \(-105 NAME_NOT_RESOLVED\)[\s\S]*fault=did-fail-load -105/);
 assert.equal(f.host.instance.instanceId,original);assert.equal(f.host.candidateInstance,null);
 await f.host.close();
});
test('first instance stages and promotes with no formal world, and refuses while one is running',async()=>{
 const f=fixture({cold:true});
 assert.equal(f.host.instance,null);
 await f.host.stageCandidate(f.request(),{first:true});
 const staged=f.host.candidateInstance.instanceId;
 assert.equal(f.host.instance,null);
 assert.equal(f.host.diagnostics('candidate').instanceId,staged);
 await assert.rejects(f.host.stageCandidate(f.request(),{first:true}),/WORLD_BUSY/);
 await f.host.promoteCandidate({...f.request(),revision:9});
 assert.equal(f.host.instance.instanceId,staged);assert.equal(f.host.candidateInstance,null);assert.equal(f.host.state.state,'ready');
 await f.host.close();
});
test('first staging is refused once a formal instance is alive',async()=>{
 const f=fixture();await f.host.ensure(f.request());
 await assert.rejects(f.host.stageCandidate(f.request(),{first:true}),/ALREADY_RUNNING/);
 await f.host.close();
});
test('a discarded first instance leaves no instance and can be staged again',async()=>{
 const f=fixture({cold:true});
 await f.host.stageCandidate(f.request(),{first:true});
 await f.host.discardCandidate();
 assert.equal(f.host.instance,null);assert.equal(f.host.candidateInstance,null);
 await f.host.stageCandidate(f.request(),{first:true});
 assert.ok(f.host.candidateInstance);
 await f.host.promoteCandidate({...f.request(),revision:9});
 assert.equal(f.host.state.state,'ready');
 await f.host.close();
});
test('diagnostics report bounded renderer evidence with the exact instance identity',async()=>{
 const f=fixture();await f.host.ensure(f.request());
 const d=f.host.diagnostics('formal');
 assert.equal(d.worldId,'alpha');assert.equal(d.buildId,'build-alpha');assert.equal(d.instanceId,f.host.instance.instanceId);
 assert.equal(d.faults.length,0);assert.equal(d.console.length,0);assert.equal(d.requests.length,0);assert.equal(d.alive,true);
 assert.equal(f.host.diagnostics('candidate'),null);
 await f.host.close();
});
test('diagnostics keep a bounded console tail and redact the instance origin token',async()=>{
 const f=fixture();await f.host.ensure(f.request());
 f.runtimes[0].requests.push({method:'GET',url:'/w/'+'a'.repeat(64)+'/index.html',status:200});
 const handlers=f.views[0].handlers;
 for(let i=0;i<60;i++)handlers['console-message']({message:'line '+i,level:i%10===0?'error':'info'});
 const d=f.host.diagnostics('formal');
 assert.equal(d.console.length,40);assert.equal(d.console[39].message,'line 59');
 assert.ok(d.console.every(entry=>entry.message.length<=400));
 assert.equal(d.requests[0].path,'/w/*/index.html');
 assert.ok(!JSON.stringify(d).includes('a'.repeat(64)));
 for(let i=0;i<40;i++)handlers['render-process-gone']({},{reason:'crashed',exitCode:i});
 assert.equal(f.host.diagnostics('formal').faults.length,20);
 await f.host.close();
});
test('renderer console control characters never reach the startup error text',async()=>{
 const f=fixture();await f.host.ensure(f.request());
 f.setFault('hang');
 const staging=f.host.stageCandidate({...f.request(),buildId:'build-v2'});
 await waitFor(()=>f.views.length===2&&!!f.views[1].handlers['console-message']);
 f.views[1].handlers['console-message']({message:'evil\u0007\u001b[31m line',level:'error'});
 f.views[1].handlers['render-process-gone']({},{reason:'crashed',exitCode:1});
 const error=await staging.then(()=>null,failure=>failure);
 assert.ok(error&&/console\[error\]=evil/.test(error.message));
 assert.ok(!/[\u0000-\u001f\u007f]/.test(error.message.replace(/\n/g,'')));
 await f.host.close();
});
