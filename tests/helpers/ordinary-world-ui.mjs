import net from 'node:net';
import assert from 'node:assert/strict';
export async function reserveLoopbackPort(){
 const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function evaluate(url,expression){
 const socket=new WebSocket(url);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('OWNED_WORLD_DEBUG_CONNECTION_FAILED')),{once:true});});
 try{return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('OWNED_WORLD_UI_RESPONSE_TIMEOUT')),120000);
  socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id!==1)return;clearTimeout(timer);if(value.error||value.result?.exceptionDetails)reject(Error(value.result?.exceptionDetails?.exception?.description??value.error?.message??'World UI request failed'));else resolve(value.result?.result?.value);});
  socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
 });}finally{socket.close();}
}
// Only the freshly launched isolated Electron process's loopback endpoint.
// Invoke the same workbench bridge as the ordinary Continue button; no input events.
async function worldTaskAction(port,worldId,task,channel){
 assert.ok(Number.isSafeInteger(port)&&port>0&&port<65536);
 assert.ok(typeof worldId==='string'&&typeof task.taskId==='string'&&Number.isSafeInteger(task.generation));
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 for(const target of targets){
  if(!target.webSocketDebuggerUrl)continue;
  const url=new URL(target.webSocketDebuggerUrl);
  if(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')continue;
  if(url.port!==String(port))continue;
  const match=await evaluate(url.href,`!!globalThis.__craftmineHeadless && !!globalThis.pluginBridge && document.body.dataset.worldId===${JSON.stringify(worldId)}`);
  if(match)return evaluate(url.href,`globalThis.pluginBridge.invoke(${JSON.stringify(channel)},${JSON.stringify({worldId,taskId:task.taskId,generation:task.generation})})`);
 }
 throw Error('OWNED_WORLD_UI_NOT_FOUND');
}
export const resumeThroughWorldUi=(port,worldId,task)=>worldTaskAction(port,worldId,task,'task.resume');
export const finishInterruptedThroughWorldUi=(port,worldId,task)=>worldTaskAction(port,worldId,task,'task.discard');
// Use the ordinary Session API on the main renderer of our owned headless
// Electron. The first ordinary prompt binds this new session to selected world.
export async function createSessionThroughDesktopUi(port,worldId){
 assert.ok(Number.isSafeInteger(port)&&port>0&&port<65536);
 assert.ok(typeof worldId==='string'&&worldId.length>0);
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const matches=[];
 for(const target of targets){
  if(!target.webSocketDebuggerUrl)continue;
  const url=new URL(target.webSocketDebuggerUrl);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!==String(port))continue;
  if(await evaluate(url.href,'!!globalThis.__craftmineHeadless && !!globalThis.piDesktop && !new URLSearchParams(location.search).get("surface")'))matches.push(url.href);
 }
 assert.equal(matches.length,1,'OWNED_PLAYER_RENDERER_REQUIRED');
 return evaluate(matches[0],`(async()=>{
  const api=globalThis.piDesktop;
  const invoke=async(name,...args)=>{const result=await api.invoke(api.channels.invoke[name],...args);if(!result?.ok)throw Error(result?.error?.message??'Player session API failed');return result.data;};
  await api.pluginPanelInvoke('craftmine.world','workbench.capabilities',{worldId:${JSON.stringify(worldId)}});
  const existing=await invoke('sessionList');
  if(!Array.isArray(existing.sessions)||existing.sessions.length!==0)throw Error('PLAYER_EXISTING_SESSION_REVIEW_REQUIRED');
  const created=await invoke('sessionCreate',{title:'预制世界继续创造',mode:'agent',permissionMode:'inherit'});
  if(typeof created.session?.id!=='string')throw Error('PLAYER_SESSION_CREATE_FAILED');
  return {sessionId:created.session.id,worldId:${JSON.stringify(worldId)},method:'sessionCreate',existingSessions:0};
 })()`);
}
