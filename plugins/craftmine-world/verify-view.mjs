import {verifyBehaviorsInBrowser} from '../../app/behavior-check.mjs';

let used=false;
// This surface is loaded only in the trusted host's isolated verification
// renderer. It has no plugin bridge; authored code stays in bounded Workers.
globalThis.craftmineVerify=async world=>{
  if(used)throw Error('VERIFIER_ALREADY_USED');used=true;
  const behaviors=await verifyBehaviorsInBrowser(world.build,{extensions:world.extensions});
  if(!behaviors.passed)return {behaviors,render:{passed:false,skipped:true}};
  const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.title='Background verification';document.body.append(frame);
  const nonce=crypto.randomUUID();
  const render=await new Promise((resolve,reject)=>{
    const receive=event=>{
      const message=event.data;
      if(event.source!==frame.contentWindow||message?.channel!=='craftmine-game/1'||message.nonce!==nonce)return;
      if(message.type==='ready')frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'load',...world,preview:true},'*');
      if(message.type==='error'){removeEventListener('message',receive);reject(Error(message.message));}
      if(message.type==='loaded'){
        removeEventListener('message',receive);
        if(message.version!==world.build.id){reject(Error('RENDER_BUILD_MISMATCH'));return;}
        resolve({passed:true,version:message.version,renderer:message.renderer});
      }
    };
    addEventListener('message',receive);
    frame.srcdoc=CRAFTMINE_GAME_DOCUMENT.replace('__CRAFTMINE_NONCE__',nonce).replace('__CRAFTMINE_INPUT_GUARD__',CRAFTMINE_INPUT_GUARD);
  });
  return {behaviors,render};
};
