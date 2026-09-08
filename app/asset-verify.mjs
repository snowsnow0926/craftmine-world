import { randomUUID } from 'node:crypto';
import { playwright,browserOptions } from './browser-tools.mjs';
export async function verifyAsset(asset,{origin}={}){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('缺少素材后台检查地址');let browser,timedOut=false;const timer=setTimeout(()=>{timedOut=true;browser?.close().catch(()=>{});},20000);
  try{
    const {viewport,...options}=browserOptions();browser=await playwright().chromium.launch({...options,timeout:20000});if(timedOut)throw Error('素材检查超过时限');const context=await browser.newContext({viewport:{width:640,height:480}});await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>{throw Error('后台验证禁止鼠标锁定');};window.focus=()=>{};});const page=await context.newPage();await page.goto(origin+'/verify');
    const result=await page.evaluate(({asset,nonce})=>new Promise((resolve,reject)=>{
      const frame=document.querySelector('iframe');frame.width='640';frame.height='480';const timeout=setTimeout(()=>{removeEventListener('message',receive);reject(Error('素材预览超过时限'));},15000);
      const receive=e=>{const m=e.data;if(e.source!==frame.contentWindow||e.origin!=='null'||m?.nonce!==nonce||m.channel!=='craftmine-asset/1')return;if(m.type==='ready')frame.contentWindow.postMessage({channel:'craftmine-asset-host/1',nonce,type:'load',asset},'*');if(m.type==='loaded'||m.type==='error'){clearTimeout(timeout);removeEventListener('message',receive);m.type==='loaded'?resolve(m):reject(Error(m.message));}};addEventListener('message',receive);frame.src='/asset-viewer#'+nonce;
    }),{asset,nonce:randomUUID()});
    return {format:'craftmine.asset-check/1',hash:asset.hash,passed:true,metrics:result.metrics,pixels:result.pixels,warnings:result.warnings,time:Date.now()};
  }catch(error){throw Error(timedOut?'素材后台检查达到时限':'素材后台检查失败：'+error.message);}finally{clearTimeout(timer);await browser?.close().catch(()=>{});}
}
