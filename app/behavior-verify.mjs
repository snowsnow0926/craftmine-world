import { playwright,browserOptions } from './browser-tools.mjs';

export async function verifyBehaviors(build,{origin,signal,deadline=Date.now()+30000,extensions=[],events=['start','tick','interact','interact','contact','attack','land','restore']}={}){
  if(!build.behaviors?.length)return {format:'craftmine.behavior-check/1',build:build.hash,passed:true,modules:[]};
  if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('缺少本机隔离检查地址');
  if(signal?.aborted)throw Error('代码检查已取消');
  const {viewport,...options}=browserOptions(),remaining=Math.max(1,Math.min(30000,deadline-Date.now()));let browser,timedOut=false,timer;
  const close=()=>browser?.close().catch(()=>{});
  try{
    timer=setTimeout(()=>{timedOut=true;close();},remaining);
    browser=await playwright().chromium.launch({...options,timeout:remaining});
    signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)throw Error('代码检查已取消');
    if(timedOut)throw Error('后台检查已达到时限');
    const context=await browser.newContext({viewport});
    await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>{throw Error('后台验证禁止鼠标锁定');};window.focus=()=>{};});
    const page=await context.newPage();await page.goto(origin+'/verify');
    const result=await page.frameLocator('iframe').locator('body').evaluate(async(_,{build,events,extensions})=>{
      const {verifyBehaviorsInBrowser}=await import('/app/behavior-check.mjs');
      return verifyBehaviorsInBrowser(build,{events,extensions});
    },{build,events,extensions});
    if(signal?.aborted)throw Error('代码检查已取消');
    return result;
  }catch(error){throw Error(signal?.aborted?'代码检查已取消':timedOut?'后台代码检查达到时限，原世界保留':'后台代码检查失败：'+error.message);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',close);await close();}
}
