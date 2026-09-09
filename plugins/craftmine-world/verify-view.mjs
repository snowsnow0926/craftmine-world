import {verifyBehaviorsInBrowser} from '../../app/behavior-check.mjs';
import {validateRequestPlan} from '../../app/request-plan.mjs';
import {evaluateAssertions} from '../../app/harness/assertions.mjs';

let used=false;
// Trusted service surface. Authored code remains in Workers in an opaque frame.
globalThis.craftmineVerify=async input=>{
  if(used)throw Error('VERIFIER_ALREADY_USED');used=true;
  const {world,mode='verification'}=input;
  let behaviors;
  if(mode==='verification'){
    behaviors=await verifyBehaviorsInBrowser(world.build,{extensions:world.extensions});
    if(!behaviors.passed)return {behaviors,render:{passed:false,skipped:true}};
  }
  const plan=mode==='acceptance'?validateRequestPlan(input.plan):null;
  const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.title='Background verification';
  document.body.append(frame);
  const nonce=crypto.randomUUID(),pending=new Map();
  const post=value=>frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,...value},'*');
  const request=(type,value={})=>new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('PREVIEW_REQUEST_TIMEOUT'));},8000);
    pending.set(requestId,{resolve,reject,timer});post({type,requestId,...value});
  });
  let readyResolve,readyReject;
  const loaded=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const receive=event=>{
    const message=event.data;
    if(event.source!==frame.contentWindow||message?.channel!=='craftmine-game/1'||message.nonce!==nonce)return;
    if(message.type==='ready')post({type:'load',...world,preview:true,paused:true});
    if(message.type==='error'&&!message.requestId)readyReject(Error(message.message));
    if(message.type==='loaded'){
      if(message.version!==world.build.id){readyReject(Error('RENDER_BUILD_MISMATCH'));return;}
      readyResolve(message);
    }
    const waiting=pending.get(message.requestId);
    if(waiting){clearTimeout(waiting.timer);pending.delete(message.requestId);message.type==='error'?waiting.reject(Error(message.message)):waiting.resolve(message);}
  };
  addEventListener('message',receive);
  try{
    frame.srcdoc=CRAFTMINE_GAME_DOCUMENT.replace('__CRAFTMINE_NONCE__',nonce).replace('__CRAFTMINE_INPUT_GUARD__',CRAFTMINE_INPUT_GUARD);
    const result=await loaded;
    const render={passed:true,version:result.version,renderer:result.renderer};
    if(mode==='application')return {render,player:result.snapshot.player};
    if(mode==='observe')return {render,observation:(await request('request-observe')).observation};
    if(mode==='acceptance'){
      const trace={baseline:input.baseline.observation,start:(await request('request-observe')).observation,
        player:world.snapshot.player,steps:[],errors:[]};
      for(const step of plan.steps){
        try{trace.steps.push((await request('request-step',{step})).observation);}
        catch(error){trace.errors.push(step.label+': '+error.message);break;}
      }
      trace.final=(await request('request-observe')).observation;
      const checked=evaluateAssertions(plan.assertions,trace);
      return {render,acceptance:{passed:checked.passed,assertions:checked.results,trace,baselineVersion:input.baseline.version,
        scope:'实际游戏副本中的对象、玩法事件与状态断言；外观美术与物理操作体验仍由玩家预览判断'}};
    }
    return {behaviors,render};
  }finally{
    removeEventListener('message',receive);
    for(const value of pending.values()){clearTimeout(value.timer);value.reject(Error('VERIFIER_CLOSED'));}pending.clear();
    // Keep the rendered frame until the native service captures and destroys it.
  }
};
