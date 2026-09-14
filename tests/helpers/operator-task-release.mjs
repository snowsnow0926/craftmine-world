import assert from 'node:assert/strict';

export function operatorReleaseIdentity(live,{worldId,sessionId}) {
  const context=live?.context??(live?.binding?live:null),binding=context?.binding;
  assert.equal(live?.active,false,'RELEASE_REQUIRES_INACTIVE_TASK');
  assert.equal(context?.world?.id,worldId,'RELEASE_WORLD_CHANGED');
  assert.equal(binding?.sessionId,sessionId,'RELEASE_SESSION_CHANGED');
  assert.equal(context?.recovery,'interrupted','RELEASE_REQUIRES_INTERRUPTED_TASK');
  assert(typeof binding?.taskId==='string'&&binding.taskId.length>0,'RELEASE_TASK_REQUIRED');
  assert(Number.isSafeInteger(context.generation)&&context.generation>=0,'RELEASE_GENERATION_REQUIRED');
  return {worldId,sessionId,taskId:binding.taskId,generation:context.generation};
}

export function operatorReleasePageScript(expected,submit=false) {
  return `(async()=>{
    if(!globalThis.__craftmineHeadless||!globalThis.pluginBridge||document.body.dataset.worldId!==${JSON.stringify(expected.worldId)})throw Error('OWNED_RELEASE_PAGE_REQUIRED');
    const live=await pluginBridge.invoke('task.current',{worldId:${JSON.stringify(expected.worldId)}}),context=live?.context??(live?.binding?live:null);
    const form=document.querySelector('form[data-release-execution-limits="true"]'),forms=document.querySelectorAll('form[data-release-execution-limits="true"]');
    const notice=document.querySelector('.workbench-notice'),page=document.querySelector('[data-workbench-page="task"]');
    const evidence={live,notice:notice?.textContent??'',error:notice?.dataset.error==='true',taskPageVisible:!!page&&!page.hidden,taskText:page?.textContent??'',formCount:forms.length,formDisabled:!!form?.querySelector('button:disabled'),buttonText:form?.querySelector('button')?.textContent??null};
    ${submit?`if(live?.active!==false||context?.world?.id!==${JSON.stringify(expected.worldId)}||context?.binding?.sessionId!==${JSON.stringify(expected.sessionId)}||context?.binding?.taskId!==${JSON.stringify(expected.taskId)}||context?.generation!==${expected.generation}||context?.recovery!=='interrupted')throw Error('RELEASE_TASK_IDENTITY_CHANGED');
    if(evidence.error)throw Error(evidence.notice);
    if(!evidence.taskPageVisible||forms.length!==1||evidence.formDisabled)throw Error('RELEASE_FORM_UNAVAILABLE');
    form.requestSubmit();evidence.submitted=true;`:''}
    return evidence;
  })()`;
}

export async function withOwnedReleasePage({port,worldId,redact},use) {
  assert(Number.isSafeInteger(port)&&port>0&&port<65536,'OWNED_RELEASE_PORT_REQUIRED');
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  for(const target of targets){
    if(target.type!=='page'||!String(target.url).replaceAll('\\','/').includes('/plugins/craftmine.world/views/world.html')||!target.webSocketDebuggerUrl)continue;
    const url=new URL(target.webSocketDebuggerUrl);if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!==String(port))continue;
    const socket=new WebSocket(url);let sequence=0;
    try{
      await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('OWNED_RELEASE_CONNECTION_FAILED')),{once:true});});
      const evaluate=expression=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{socket.removeEventListener('message',listener);reject(Error('OWNED_RELEASE_RPC_TIMEOUT'));},120000),listener=event=>{const value=JSON.parse(event.data);if(value.id!==id)return;clearTimeout(timer);socket.removeEventListener('message',listener);if(value.error||value.result?.exceptionDetails)reject(Error(redact(value.result?.exceptionDetails?.exception?.description??value.error?.message??'RELEASE_PAGE_EVALUATION_FAILED')));else resolve(value.result?.result?.value);};socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
      if(!await evaluate(`!!globalThis.__craftmineHeadless&&!!globalThis.pluginBridge&&document.body.dataset.worldId===${JSON.stringify(worldId)}`))continue;
      return await use(evaluate);
    }finally{socket.close();}
  }
  throw Error('OWNED_RELEASE_PAGE_NOT_FOUND');
}
