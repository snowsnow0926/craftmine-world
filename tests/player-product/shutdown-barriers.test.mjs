import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {EventEmitter,once} from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {awaitOwnedClose,utilityProcessClosed} from '../../vendor/pi-desktop/apps/desktop/electron/main/owned-resource-close.ts';
import {createWorldRuntime} from '../../desktop/godot/web/runtime.mjs';

const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function loadClass(file,name,globals={}) {
  const source=stripTypeScriptTypes(await fsp.readFile(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/'+file,import.meta.url),'utf8'),{mode:'transform'});
  const body=source.slice(source.indexOf('export class '+name)).replace('export class '+name,'class '+name);
  const context={setTimeout,clearTimeout,console,awaitOwnedClose,PLUGIN_DISPOSE_ALL_TIMEOUT_MS:3000,...globals};
  return vm.runInNewContext(body+'\n'+name,context);
}
const Sidecar=await loadClass('agent-sidecar.ts','AgentSidecar');
const Plugins=await loadClass('plugin-runtime.ts','PluginRuntime');
function sidecar(child,closed) {
  const value=Object.create(Sidecar.prototype);
  Object.assign(value,{child,childClosed:closed,disposal:null,projectInstructionRoots:new Map(),vendorAuthBindings:new Map(),exitHandlers:new Set(),stderrTail:[],closeTransport(){}});
  return value;
}
test('sidecar dispose shares one promise and waits for close, not exit or kill return',async()=>{
  const child=new EventEmitter();let kills=0;child.kill=()=>{kills++;};
  const value=sidecar(child,new Promise(r=>child.once('close',r)));
  const first=value.dispose(),second=value.dispose();assert.equal(first,second);
  let settled=false;first.then(()=>settled=true);child.emit('exit',0);await drain();assert.equal(settled,false);assert.equal(kills,1);
  child.emit('close',0);await first;assert.equal(settled,true);
});
test('real isolated child drains stdout/stderr and emits close before sidecar disposal completes',async t=>{
  const child=spawn(process.execPath,['-e','process.stdout.write("owned-ready\\n");process.stderr.write("owned-stderr\\n");process.stdin.resume();'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
  let stdout='',stderr='',closed=false;
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const completion=new Promise(r=>child.once('close',()=>{closed=true;r();}));
  await Promise.all([once(child.stdout,'data'),once(child.stderr,'data')]);
  const value=sidecar(child,completion);await value.dispose();
  assert.equal(closed,true);assert.equal(child.stdout.closed,true);assert.equal(child.stderr.closed,true);
  assert.match(stdout,/owned-ready/);assert.match(stderr,/owned-stderr/);
});
test('UtilityProcess barrier requires exit and both exposed pipe close events',async()=>{
  const child=new EventEmitter();child.stdout=Object.assign(new EventEmitter(),{closed:false});child.stderr=Object.assign(new EventEmitter(),{closed:false});
  const completion=utilityProcessClosed(child);let done=false;completion.then(()=>done=true);
  child.emit('exit');child.stdout.emit('close');await drain();assert.equal(done,false);
  child.stderr.emit('close');await completion;assert.equal(done,true);
});
test('plugin disposal kills once and awaits adapter terminal completion across callers',async()=>{
  const closed=gate();let kills=0;
  const value=Object.create(Plugins.prototype),loaded={manifest:{id:'owned-fixture'},child:{closed:closed.promise,kill(){kills++;}}};
  Object.assign(value,{disposal:null,loaded:new Map([['owned-fixture',loaded]]),serviceStates:new Map(),cancelRestarts(){},disposeWatchers(){},async disposePlugin(){}});
  const a=value.disposeAll(),b=value.disposeAll();assert.equal(a,b);let done=false;a.then(()=>done=true);
  await drain();assert.equal(kills,1);assert.equal(done,false);assert.equal(loaded.disposing,true);
  closed.resolve();await a;assert.equal(done,true);assert.equal(value.loaded.size,0);
});
test('a teardown deadline rejects with resource identity instead of marking completion',async()=>{
  await assert.rejects(awaitOwnedClose(new Promise(()=>{}),'OWNED_FIXTURE',5),/OWNED_FIXTURE_CLOSE_TIMEOUT/);
});
test('plugin hook failure still terminates owned child and remains a reported failure',async()=>{
  let kills=0;
  const value=Object.create(Plugins.prototype),loaded={manifest:{id:'owned-fixture'},child:{closed:Promise.resolve(),kill(){kills++;}}};
  Object.assign(value,{disposal:null,loaded:new Map([['owned-fixture',loaded]]),serviceStates:new Map(),cancelRestarts(){},disposeWatchers(){},async disposePlugin(){throw Error('OWNED_HOOK_FAILED');}});
  await assert.rejects(value.disposeAll(),/OWNED_HOOK_FAILED/);assert.equal(kills,1);
});
test('plugin missing terminal event rejects every disposal caller with a named timeout',async()=>{
  const BoundedPlugins=await loadClass('plugin-runtime.ts','PluginRuntime',{awaitOwnedClose:(promise,label)=>awaitOwnedClose(promise,label,5)});
  const value=Object.create(BoundedPlugins.prototype),loaded={manifest:{id:'owned-fixture'},child:{closed:new Promise(()=>{}),kill(){}}};
  Object.assign(value,{disposal:null,loaded:new Map([['owned-fixture',loaded]]),serviceStates:new Map(),cancelRestarts(){},disposeWatchers(){},async disposePlugin(){}});
  const completion=value.disposeAll();await assert.rejects(completion,/PLUGIN_owned-fixture_CLOSE_TIMEOUT/);assert.equal(value.disposeAll(),completion);
});
async function directory(t) {const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'craftmine-shutdown-'));await fsp.writeFile(path.join(dir,'index.html'),'x');return dir;}
test('real HTTP runtime shares graceful disposal through exit response and server closure',async t=>{
  const runtime=await createWorldRuntime({worldId:'alpha',buildId:'build-a',root:await directory(t)});
  const scope={protocol:runtime.protocol,worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId};let request;
  runtime.attach(message=>request=message);runtime.receive({...scope,type:'ready'});
  const first=runtime.dispose(),second=runtime.dispose({graceful:false});assert.equal(first,second);
  let done=false;first.then(()=>done=true);await drain();assert.equal(done,false);assert.equal(request.op,'exit');
  runtime.receive({...scope,type:'response',id:request.id,result:{exitCode:0}});await first;assert.equal(done,true);
  await assert.rejects(fetch(runtime.url));assert.equal(runtime.dispose(),first);
});
test('runtime never returns success when the server close callback is missing',async t=>{
  const dir=await directory(t),server=new EventEmitter();let deadline,closeCalls=0;
  Object.assign(server,{listen(){queueMicrotask(()=>server.emit('listening'));},address(){return {port:12345};},close(){closeCalls++;},closeAllConnections(){}});
  const source=(await fsp.readFile(new URL('../../desktop/godot/web/runtime.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const make=vm.runInNewContext(source+'\ncreateWorldRuntime',{fs,fsp,path,createHash,randomBytes,once,http:{createServer:()=>server},Buffer,TextEncoder,URL,structuredClone,console,setTimeout:(callback,ms)=>{if(ms===2000){deadline=callback;return null;}return setTimeout(callback,ms);},clearTimeout});
  const runtime=await make({worldId:'alpha',buildId:'build-a',root:dir});
  const first=runtime.dispose({graceful:false});assert.equal(first,runtime.dispose());
  const rejected=assert.rejects(first,/GODOT_RUNTIME_CLOSE_TIMEOUT/);deadline();await rejected;assert.equal(closeCalls,1);
  assert.equal(runtime.dispose(),first);
});
