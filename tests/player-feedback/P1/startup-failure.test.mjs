// Actual runtime HTTP/request state machine with controlled Electron lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createWorldRuntime} from '../../../desktop/godot/web/runtime.mjs';
const file=new URL('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts',import.meta.url);
const compiled=stripTypeScriptTypes(await fs.readFile(file,'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
async function fixture(mode){
 const root=await fs.mkdtemp(join(tmpdir(),'p1-startup-'));await fs.writeFile(join(root,'index.html'),'<!doctype html>');
 let runtime,view;
 const context={module:{exports:{}},console,join,resolve,sep,realpath:fs.realpath,setTimeout,clearTimeout,setInterval,clearInterval,Date,Promise,WORLD_CHROME_HEIGHT:76,GODOT_WORLD_MESSAGE_CHANNEL:'message',GODOT_WORLD_DETACH_CHANNEL:'detach',
  createWorldRuntime:async options=>(runtime=await createWorldRuntime(options))};
 const Host=vm.runInNewContext(compiled+'\nGodotWorldViewHost',context);
 const host=new Host({window:()=>null,allowedRoots:()=>[root]});
 host.createView=()=>{
  const contents=new EventEmitter();
  Object.assign(contents,{closed:false,isDestroyed(){return this.closed;},async loadURL(){runtime.receive({...runtime,type:'ready',ops:['load']});},send(_channel,message){
   if(message?.op==='load'&&mode==='crash')setImmediate(()=>contents.emit('render-process-gone',{}, {reason:'crashed',exitCode:123}));
  },close(){setImmediate(()=>{this.closed=true;this.emit('destroyed');});}});
  view={webContents:contents,getBounds:()=>({x:0,y:0,width:640,height:360})};return view;
 };
 const bytes=await fs.readFile(join(root,'index.html'));
 return {host,request:{worldId:'alpha',buildId:'build-alpha',root,revision:0,snapshot:null,timeoutMs:80,artifacts:[{path:'index.html',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]},runtime:()=>runtime};
}
test('a load timeout reports its pre-cleanup cause, not the renderer destroyed by cleanup',async()=>{
 const f=await fixture('timeout');
 try{await assert.rejects(f.host.ensure(f.request),error=>{
  assert.match(error.message,/Runtime request timed out: load/);
  assert.doesNotMatch(error.message,/fault=renderer-destroyed/);
  return true;
 });assert.equal(f.host.instance,null);}finally{await f.host.dispose();}
});
test('renderer failure after ready rejects its pending load with the real renderer cause',async()=>{
 const f=await fixture('crash');
 try{await assert.rejects(f.host.ensure(f.request),error=>{
  assert.match(error.message,/World renderer stopped: crashed/);
  assert.doesNotMatch(error.message,/Runtime request timed out/);
  assert.match(error.message,/fault=render-process-gone crashed 123/);
  return true;
 });assert.equal(f.host.instance,null);}finally{await f.host.dispose();}
});
