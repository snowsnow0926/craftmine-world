import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createSessionThroughDesktopUi} from './helpers/ordinary-world-ui.mjs';

function fixture(t,{sessions=[],world='demo'}={}){
 const calls=[];
 const context={__craftmineHeadless:true,location:{search:''},URLSearchParams,
  piDesktop:{channels:{invoke:{sessionList:'sessionList',sessionCreate:'sessionCreate'}},
   pluginPanelInvoke:async(plugin,channel,args)=>{calls.push({plugin,channel,args});assert.equal(plugin,'craftmine.world');assert.equal(channel,'workbench.capabilities');if(args.worldId!==world)throw Error('SELECTED_WORLD_CHANGED');return{channels:[]};},
   invoke:async(channel,...args)=>{calls.push({channel,args});if(channel==='sessionList')return{ok:true,data:{sessions}};assert.equal(channel,'sessionCreate');assert.deepEqual(JSON.parse(JSON.stringify(args)),[{title:'预制世界继续创造',mode:'agent',permissionMode:'inherit'}]);return{ok:true,data:{session:{id:'actual-session'}}};}}};
 class Socket{
  listeners=new Map();constructor(url){assert.equal(url,'ws://127.0.0.1:12345/main');queueMicrotask(()=>this.listeners.get('open')?.({}));}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  send(raw){const request=JSON.parse(raw);Promise.resolve().then(()=>vm.runInNewContext(request.params.expression,context)).then(value=>this.listeners.get('message')({data:JSON.stringify({id:1,result:{result:{value}}})}),error=>this.listeners.get('message')({data:JSON.stringify({id:1,result:{exceptionDetails:{exception:{description:error.message}}}})}));}
  close(){}
 }
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,'http://127.0.0.1:12345/json/list');return{json:async()=>[{webSocketDebuggerUrl:'ws://elsewhere:12345/deny'},{webSocketDebuggerUrl:'ws://127.0.0.1:12345/main'}]};});
 const original=globalThis.WebSocket;globalThis.WebSocket=Socket;t.after(()=>{globalThis.WebSocket=original;});
 return calls;
}
test('new session uses ordinary IPC once after world and empty-session checks',async t=>{
 const calls=fixture(t);assert.deepEqual(await createSessionThroughDesktopUi(12345,'demo'),{sessionId:'actual-session',worldId:'demo',method:'sessionCreate',existingSessions:0});assert.deepEqual(calls.map(c=>c.channel),['workbench.capabilities','sessionList','sessionCreate']);
});
test('existing session requires explicit review and is never silently replaced',async t=>{
 const calls=fixture(t,{sessions:[{id:'keep'}]});await assert.rejects(createSessionThroughDesktopUi(12345,'demo'),/PLAYER_EXISTING_SESSION_REVIEW_REQUIRED/);assert.equal(calls.some(c=>c.channel==='sessionCreate'),false);
});
test('world mismatch fails before creating a durable session',async t=>{
 const calls=fixture(t,{world:'different'});await assert.rejects(createSessionThroughDesktopUi(12345,'demo'),/SELECTED_WORLD_CHANGED/);assert.deepEqual(calls.map(c=>c.channel),['workbench.capabilities']);
});
