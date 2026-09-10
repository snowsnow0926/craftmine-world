import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';

const out=await fs.mkdtemp(path.join(os.tmpdir(),'craftmine-creation-guide-'));
const source=await fs.readFile(new URL('../../plugins/craftmine-world/creation-guide-ui.mjs',import.meta.url));
const moduleUrl='data:text/javascript;base64,'+source.toString('base64');
const {headless,executablePath}=browserOptions();
let context;
const checks=[];
try {
  context=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{headless,executablePath,viewport:{width:900,height:720}});
  let networkRequests=0;
  await context.route('**/*',route=>{networkRequests++;return route.abort();});
  await context.addInitScript(()=>{
    globalThis.guards={pointerLock:0,focus:0,fetch:0,storage:0};
    Element.prototype.requestPointerLock=()=>{guards.pointerLock++;throw Error('Forbidden');};
    window.focus=HTMLElement.prototype.focus=()=>{guards.focus++;throw Error('Forbidden');};
    window.fetch=()=>{guards.fetch++;throw Error('Forbidden');};
    Storage.prototype.setItem=()=>{guards.storage++;throw Error('Forbidden');};
  });
  const page=await context.newPage();
  await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><main id="guide"></main></body></html>');
  await page.evaluate(async url=>{
    window.factory=(await import(url)).createCreationGuideUI;
    window.calls=[];window.mode='ok';window.release=null;
    window.ui=factory({element:document.querySelector('#guide'),navigate:tab=>{
      calls.push(tab);
      if(mode==='fail')throw Error('PRIVATE_RAW_ERROR_MUST_NOT_RENDER');
      if(mode==='pending')return new Promise((resolve,reject)=>{window.release={resolve,reject};});
    }});
    ui.show();ui.show();
  },moduleUrl);
  const initial=await page.evaluate(()=>({count:document.querySelectorAll('details').length,open:document.querySelector('details').open,steps:[...document.querySelectorAll('li strong')].map(x=>x.textContent),text:document.body.textContent,calls}));
  assert.equal(initial.count,1);assert.equal(initial.open,false);assert.equal(initial.steps.length,6);
  assert.match(initial.text,/检查通过不等于已经采用修改/);assert.match(initial.text,/预览中的游玩不会写入正式世界/);
  assert.match(initial.text,/应用到世界/);assert.deepEqual(initial.calls,[]);
  checks.push('six honest lifecycle explanations; default collapsed; mounting is idempotent');
  await page.evaluate(()=>{const d=document.querySelector('details');d.open=true;ui.show();if(!d.open)throw Error('show reset expansion');d.open=false;d.open=true;});
  assert.deepEqual(await page.evaluate(()=>calls),[]);
  const submit=async index=>page.evaluate(index=>document.querySelectorAll('#guide form')[index].requestSubmit(),index);
  await submit(0);await submit(1);
  assert.deepEqual(await page.evaluate(()=>calls),['checks','library']);
  checks.push('skip/reopen have no actions; navigation only emits the two fixed destinations');
  await page.evaluate(()=>{mode='fail';});await submit(0);
  assert.match(await page.locator('[role=status]').textContent(),/稍后重试/);
  assert.equal(await page.locator('body').textContent().then(x=>x.includes('PRIVATE_RAW_ERROR')),false);
  assert.equal(await page.locator('button:disabled').count(),0);
  await page.evaluate(()=>{mode='ok';});await submit(0);
  assert.equal(await page.locator('[role=status]').evaluate(x=>x.hidden),true);
  checks.push('navigation errors are generic and retryable without leaking the raw error');
  await page.evaluate(()=>{mode='pending';});await submit(0);
  const before=await page.evaluate(()=>calls.length);
  await submit(1);assert.equal(await page.evaluate(()=>calls.length),before);
  await page.evaluate(()=>{
    window.oldForm=document.querySelector('form');ui.clear();ui.show();
    oldForm.requestSubmit();release.reject(Error('OLD_WORLD_ERROR'));
  });
  assert.equal(await page.evaluate(()=>calls.length),before);
  assert.equal(await page.locator('[role=status]').evaluate(x=>x.hidden),true);
  assert.equal(await page.locator('button:disabled').count(),0);
  await page.evaluate(()=>{ui.dispose();ui.show();});assert.equal(await page.locator('#guide').evaluate(x=>x.childElementCount),0);
  checks.push('pending navigation cannot duplicate; detached listeners and late replies cannot affect a new mount; dispose is final');
  await page.evaluate(()=>{window.ui=factory({element:document.querySelector('#guide')});ui.show();document.querySelector('details').open=true;});
  assert.equal(await page.locator('form').count(),0);
  assert.deepEqual(await page.evaluate(()=>guards),{pointerLock:0,focus:0,fetch:0,storage:0});
  assert.equal(networkRequests,0);
  checks.push('read-only mode has no action controls, network, storage, focus or Pointer Lock');
  await page.screenshot({path:path.join(out,'guide.png')});
  const report={passed:true,checks,networkRequests,guards:await page.evaluate(()=>guards)};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,out}));
} finally {await context?.close();}
