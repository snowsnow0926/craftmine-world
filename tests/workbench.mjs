import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { playwright,browserOptions } from './browser-tools.mjs';

export async function workbench(name,{preload,env={}}={}){
  fs.mkdirSync('test-results',{recursive:true});const dir=path.resolve(fs.mkdtempSync('test-results/'+name+'-'));
  const checks=[],errors=[];let server,browser,page;
  const port=await new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
  const report=()=>fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({date:new Date().toISOString(),checks,errors},null,2));
  const check=(name,value,detail)=>{checks.push({name,passed:!!value,detail});report();assert.ok(value,name);console.log('PASS '+name);};
  async function start(){
    server=spawn(process.execPath,[...(preload?['--import',preload]:[]),'app/server.mjs'],{env:{...process.env,...env,CRAFTMINE_PORT:String(port),CRAFTMINE_DATA_DIR:path.join(dir,'project')},windowsHide:true,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),15000);server.stdout.on('data',chunk=>{if(chunk.toString().includes('http://')){clearTimeout(timer);resolve();}});server.stderr.on('data',chunk=>errors.push(chunk.toString()));server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
    browser=await playwright().chromium.launchPersistentContext(path.join(dir,'profile'),browserOptions());
    await browser.addInitScript(()=>{Element.prototype.requestPointerLock=function(){throw Error('Pointer lock is disabled in background verification');};window.focus=()=>{};});
    page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`);await page.locator('#loading').waitFor({state:'hidden'});
  }
  async function close(){if(browser){await browser.close();browser=null;}if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});report();}
  async function api(route,body){return page.evaluate(async({route,body})=>{
    const r=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Craftmine-Token':document.querySelector('meta[name="craftmine-token"]').content,'X-Craftmine-Client':sessionStorage.getItem('craftmine-client')},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await r.json();if(!r.ok)throw Error(result.error);return result;
  },{route,body});}
  async function snapshot(){return page.evaluate(()=>new Promise((resolve,reject)=>{
    const f=document.querySelector('iframe:not(.staging)'),nonce=new URL(f.src).hash.slice(1),requestId=crypto.randomUUID(),timer=setTimeout(()=>reject(Error('snapshot timeout')),5000);
    const receive=e=>{if(e.source===f.contentWindow&&e.data.requestId===requestId){clearTimeout(timer);removeEventListener('message',receive);resolve(e.data.snapshot);}};addEventListener('message',receive);f.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'snapshot',requestId},'*');
  }));}
  async function domClick(selector){await page.evaluate(selector=>document.querySelector(selector).click(),selector);}
  async function apply(){await page.locator('#candidate').waitFor({state:'visible',timeout:10000});await domClick('#apply');await page.locator('#candidate').waitFor({state:'hidden',timeout:30000});await page.locator('#loading').waitFor({state:'hidden'});}
  async function load(scene,snapshot){await api('/api/import',{format:'craftmine.save/1',scene,snapshot});await apply();}
  async function request(prompt){await page.evaluate(prompt=>{document.getElementById('prompt').value=prompt;document.getElementById('composer').requestSubmit();},prompt);const start=Date.now();let last='';while(Date.now()-start<250000){const state=await api('/api/state'),t=state.tasks.at(-1);if(t&&t.status!==last){console.log('LLM '+t.status);last=t.status;}if(t?.status==='ready')return state;if(t&&['failed','cancelled','discussed','interrupted','unchanged'].includes(t.status))throw Error(t.error||'Unexpected task status '+t.status);await page.waitForTimeout(1000);}throw Error('LLM timeout');}
  const saveScreenshot=async name=>{await page.screenshot({path:path.join(dir,name+'.png')});};
  await start();
  return {dir,checks,errors,check,api,snapshot,apply,load,request,domClick,saveScreenshot,start,close,get page(){return page;},game:()=>page.frameLocator('iframe:not(.staging)'),report};
}
