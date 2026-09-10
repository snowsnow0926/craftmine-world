// Actual unmodified parameter/workbench UI snapshot; deterministic transport, not core/native/model evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const sourceRoot=path.resolve(arg('--source-root')||root),ref=arg('--ui-ref');
const sourceCommit=execFileSync('git',['rev-parse',ref?`${ref}^{commit}`:'HEAD'],{cwd:sourceRoot,encoding:'utf8',windowsHide:true}).trim();
const sourceDirty=ref?null:execFileSync('git',['status','--short'],{cwd:sourceRoot,encoding:'utf8',windowsHide:true});
const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});
const out=await fs.mkdtemp(path.join(results,'target-ui-')),snapshot=path.join(out,'source');await fs.mkdir(snapshot);
const hash=value=>createHash('sha256').update(value).digest('hex');
const readSource=name=>ref?Promise.resolve(execFileSync('git',['show',`${sourceCommit}:plugins/craftmine-world/${name}`],{cwd:sourceRoot,windowsHide:true})):fs.readFile(path.join(sourceRoot,'plugins/craftmine-world',name));
const queue=['workbench-ui.mjs','target-feedback-ui.mjs'],hashes={},seen=new Set();
while(queue.length){const name=queue.shift();if(seen.has(name))continue;seen.add(name);if(!/^[a-z0-9-]+\.mjs$/.test(name))throw Error('Invalid dependency');const source=await readSource(name);hashes[name]=hash(source);await fs.writeFile(path.join(snapshot,name),source);for(const match of source.toString().matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))queue.push(match[1]);}
for(const [name,expected]of Object.entries(hashes))assert.equal(hash(await readSource(name)),expected,'Source changed during capture; repeat with a stable snapshot');
const deps=process.env.CRAFTMINE_DEPS_ROOT||path.join(root,'vendor/pi-desktop/packages/agent-runtime');const{build}=createRequire(path.join(deps,'package.json'))('esbuild');
for(const name of ['workbench-ui','target-feedback-ui'])await build({entryPoints:[path.join(snapshot,name+'.mjs')],outfile:path.join(out,name+'.mjs'),bundle:true,platform:'browser',format:'esm'});
const report={format:'craftmine.target-feedback-ui-test/1',type:'browser-dom-fixed-transport',native:false,sourceCommit,sourceDirty,sourceHashes:hashes,startedAt:new Date().toISOString(),checks:[],completed:false,passed:false};
const server=http.createServer(async(req,res)=>{const name={'/workbench.mjs':'workbench-ui.mjs','/target.mjs':'target-feedback-ui.mjs'}[req.url];if(name){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(out,name)));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><meta charset="utf-8"><title>Parameter UI fixture</title><aside id="selection"></aside><main id="ui"></main></html>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
const violations=[],pageErrors=[];async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS',name);}catch(error){report.checks.push({name,passed:false,error:String(error.stack||error)});console.error('FAIL',name,error.message);process.exitCode=1;}}
async function fixture(standalone=false){
 const page=await browser.newPage();page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(origin);
 await page.evaluate(async standalone=>{
  window.guard={pointerLock:0,focus:0,input:0};Element.prototype.requestPointerLock=()=>{guard.pointerLock++;throw Error('Forbidden');};window.focus=()=>{guard.focus++;throw Error('Forbidden');};HTMLElement.prototype.focus=()=>{guard.focus++;throw Error('Forbidden');};for(const type of ['keydown','mousedown'])addEventListener(type,e=>{if(e.isTrusted)guard.input++;});
  window.world={id:'alpha',world:{build:{id:'build-alpha',engine:{kind:'godot-web'},scene:{objects:[]}}}};
  window.calls=[];window.journal=[];window.mutations=0;window.nextStatus='queued';window.describeValue=120;window.lastAction=Promise.resolve();window.pollStatuses=[];window.holds=[];window.loseReply=false;
  window.defaultValue=250;window.noDefaults=false;window.defaultFor=value=>noDefaults?undefined:{format:'craftmine.target-feedback-default/1',values:{hitFlashMilliseconds:value},source:{kind:'balance-profile',path:'data/balance/training_range.tres',sha256:'f'.repeat(64)}};
  window.targets=()=>({worldId:world.id,targets:[{targetId:'target_a',label:'A',defaults:defaultFor(defaultValue),values:{hitFlashMilliseconds:describeValue},sourceBinding:{revision:1,manifestHash:'a'.repeat(64)}},{targetId:'target_b',label:'B',defaults:defaultFor(350),values:{hitFlashMilliseconds:400},sourceBinding:{revision:1,manifestHash:'b'.repeat(64)}}]});
  window.request=async(channel,input)=>{
   calls.push({channel,input:structuredClone(input)});let result;
   if(channel==='workbench.capabilities')result={channels:['package.request','targetFeedback.describe','targetFeedback.status','workbench.prepare','workbench.execute','workbench.operations','workbench.acknowledge']};
   else if(channel==='package.request')result={items:[],revision:1,manifestHash:'a'.repeat(64)};
   else if(channel==='workbench.operations')result={items:structuredClone(journal.filter(item=>item.worldId===input.worldId))};
   else if(channel==='workbench.prepare'){const operationId=crypto.randomUUID();journal.push({operationId,worldId:input.worldId,channel:input.channel,payload:structuredClone(input.payload),state:'pending'});result={operationId};}
   else if(channel==='workbench.execute'){
    const item=journal.find(item=>item.operationId===input.operationId);if(!item)throw Error('Unknown operation');
    if(!item.result){mutations++;item.state='completed';item.result={worldId:item.worldId,operationId:item.operationId,status:nextStatus,...(nextStatus==='rejected'?{reason:'TARGET_FEEDBACK_STALE_BINDING'}:{job:{id:'job-'+item.operationId,status:nextStatus}})};}
    result=structuredClone(item.result);if(loseReply){loseReply=false;throw Error('LOST_REPLY');}
   }
   else if(channel==='workbench.acknowledge'){journal=journal.filter(item=>item.operationId!==input.operationId);result={ok:true};}
   else if(channel==='targetFeedback.describe')result=targets();
   else if(channel==='targetFeedback.status'){const item=journal.find(item=>item.operationId===input.operationId);result={...structuredClone(item.result),status:pollStatuses.shift()||'queued'};result.job.status=result.status;}
   else throw Error('Unexpected channel '+channel);
   const hold=holds.find(hold=>hold.channel===channel&&!hold.used);if(hold){hold.used=true;hold.input=input;hold.result=structuredClone(result);return new Promise((resolve,reject)=>{hold.resolve=()=>resolve(hold.result);hold.reject=reject;});}
   return result;
  };
  const action=async fn=>{lastAction=Promise.resolve().then(fn);await lastAction;};
  if(standalone){const{createTargetFeedbackUI}=await import('/target.mjs');window.module=createTargetFeedbackUI({element:document.querySelector('#ui'),request,getWorldId:()=>world.id,action,durableCall:async(channel,payload)=>{calls.push({channel,input:payload});return{worldId:world.id,status:'unchanged'};}});window.mountPromise=module.show();}
  else{const{createWorkbench}=await import('/workbench.mjs');window.module=createWorkbench({element:document.querySelector('#ui'),selectionElement:document.querySelector('#selection'),request,getWorld:()=>world,run:action});await module.setWorld();window.mountPromise=module.show('library');}
  window.submit=label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label&&!b.closest('[hidden]'));if(!button||button.disabled)throw Error('Unavailable '+label);button.form.requestSubmit();};
 },standalone);await page.evaluate(()=>mountPromise);return page;
}
const idle=page=>page.waitForFunction(()=>!module.busy);
const submit=async(page,label)=>{await page.evaluate(label=>submit(label),label);await idle(page);};
const finish=async page=>{const g=await page.evaluate(()=>guard);assert.deepEqual(g,{pointerLock:0,focus:0,input:0});await page.close();};
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),browserOptions());
 await browser.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){violations.push(route.request().url());return route.abort();}return route.continue();});
 await check('workbench mount, 1..1000 integer validation and exact selected target durability',async()=>{
  const p=await fixture();assert.equal(await p.locator('[data-target-feedback]').count(),1);
  for(const value of ['',0,-1,1001,1.5,'NaN']){await p.evaluate(value=>{const i=document.querySelector('[data-target-feedback-value]');i.value=String(value);i.form.noValidate=true;submit('生成调整草稿并检查');},value);await idle(p);}
  assert.equal(await p.evaluate(()=>calls.filter(x=>x.channel==='workbench.prepare').length),0);
  await p.evaluate(()=>{const area=document.querySelector('[data-target-feedback]'),select=area.querySelector('select');select.value='target_b';select.dispatchEvent(new Event('change'));const input=area.querySelector('input');input.value='1000';input.form.requestSubmit();input.form.requestSubmit();});await idle(p);
  const result=await p.evaluate(()=>({calls,mutations}));const prepares=result.calls.filter(x=>x.channel==='workbench.prepare');assert.equal(prepares.length,1);assert.deepEqual(prepares[0].input.payload,{targetId:'target_b',sourceBinding:{revision:1,manifestHash:'b'.repeat(64)},values:{hitFlashMilliseconds:1000}});assert.equal(result.mutations,1);await finish(p);
 });
 await check('verified defaults only fill the selected input until original durable submit',async()=>{
  const p=await fixture();const before=await p.evaluate(()=>calls.length);await submit(p,'使用底座默认值');assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'250');assert.equal(await p.evaluate(()=>calls.length),before);assert.equal(await p.evaluate(()=>mutations),0);
  assert.match(await p.locator('[data-target-feedback-default-source]').textContent(),/250.*当前平衡配置/);assert.match(await p.locator('[data-target-feedback]').textContent(),/尚未提交.*不会恢复动态继承/);
  await p.evaluate(()=>{const select=document.querySelector('[data-target-feedback] select');select.value='target_b';select.dispatchEvent(new Event('change'));});await submit(p,'使用底座默认值');assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'350');await submit(p,'生成调整草稿并检查');
  assert.equal(await p.evaluate(()=>mutations),1);assert.deepEqual(await p.evaluate(()=>calls.find(c=>c.channel==='workbench.prepare').input.payload),{targetId:'target_b',sourceBinding:{revision:1,manifestHash:'b'.repeat(64)},values:{hitFlashMilliseconds:350}});assert.equal(await p.locator('[data-target-feedback-default]').isDisabled(),true);await finish(p);
 });
 await check('detached old-world default form cannot fill the newly mounted world',async()=>{
  const p=await fixture(true);await p.evaluate(async()=>{window.oldDefault=document.querySelector('[data-target-feedback-default]').form;world={...world,id:'beta'};describeValue=777;defaultValue=333;await module.show();oldDefault.requestSubmit();await lastAction;});assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'777');await submit(p,'使用底座默认值');assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'333');assert.equal(await p.evaluate(()=>calls.filter(c=>c.channel==='targetFeedback.submit').length),0);await finish(p);
 });
 await check('missing default never falls back to contract120 after reread',async()=>{
  const p=await fixture(true);await p.evaluate(()=>{noDefaults=true;});await submit(p,'重新读取参数');assert.equal(await p.locator('[data-target-feedback-default]').isDisabled(),true);assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'120');assert.equal(await p.evaluate(()=>calls.filter(c=>c.channel==='targetFeedback.submit').length),0);await finish(p);
 });
 await check('background status polling never repeats modification; passed does not claim adoption',async()=>{
  const p=await fixture();await p.evaluate(()=>{document.querySelector('[data-target-feedback-value]').value='1';pollStatuses=['queued','passed'];});await submit(p,'生成调整草稿并检查');
  await p.waitForFunction(()=>document.querySelector('[data-target-feedback]').textContent.includes('正式世界尚未改变'),null,{timeout:6000});
  assert.equal(await p.evaluate(()=>mutations),1);assert.equal(await p.evaluate(()=>calls.filter(x=>x.channel==='workbench.prepare').length),1);assert.equal(await p.evaluate(()=>calls.filter(x=>x.channel==='targetFeedback.status').length),2);await finish(p);
 });
 await check('lost reply recovers only through the pending original operation',async()=>{
  const p=await fixture();await p.evaluate(()=>{loseReply=true;document.querySelector('[data-target-feedback-value]').value='300';});await submit(p,'生成调整草稿并检查');
  assert.ok((await p.locator('[data-target-feedback]').textContent()).includes('待确认操作'));assert.equal(await p.locator('[data-target-feedback-value]').isDisabled(),true);assert.equal(await p.locator('[data-target-feedback-default]').isDisabled(),true);
  await submit(p,'查询并继续原调整');assert.equal(await p.evaluate(()=>mutations),1);const c=await p.evaluate(()=>calls);assert.equal(c.filter(x=>x.channel==='workbench.prepare').length,1);assert.equal(new Set(c.filter(x=>x.channel==='workbench.execute').map(x=>x.input.operationId)).size,1);await finish(p);
 });
 await check('rejected result allows reread and a corrected value',async()=>{
  const p=await fixture();await p.evaluate(()=>{nextStatus='rejected';document.querySelector('[data-target-feedback-value]').value='900';});await submit(p,'生成调整草稿并检查');
  assert.equal(await p.locator('[data-target-feedback-value]').isDisabled(),false);await p.evaluate(()=>{describeValue=222;nextStatus='queued';});await submit(p,'重新读取参数');assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'222');
  await p.evaluate(()=>{document.querySelector('[data-target-feedback-value]').value='223';});await submit(p,'生成调整草稿并检查');assert.equal(await p.evaluate(()=>calls.filter(x=>x.channel==='workbench.prepare').length),2);await finish(p);
 });
 await check('late submission across world switch cannot populate or unlock the new world',async()=>{
  const p=await fixture();await p.evaluate(()=>{holds.push({channel:'workbench.execute'});document.querySelector('[data-target-feedback-value]').value='350';submit('生成调整草稿并检查');});await p.waitForFunction(()=>holds[0].used);
  await p.evaluate(async()=>{world={...world,id:'beta'};await module.setWorld();holds[0].resolve();});await idle(p);
  assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'120');assert.equal(await p.locator('[data-target-feedback-value]').isDisabled(),false);assert.equal((await p.locator('[data-target-feedback]').textContent()).includes('正在检查'),false);await finish(p);
 });
 await check('late status after changing tab cannot reopen or poll the hidden parameter page',async()=>{
  const p=await fixture();await p.evaluate(()=>{holds.push({channel:'targetFeedback.status'});document.querySelector('[data-target-feedback-value]').value='500';});await submit(p,'生成调整草稿并检查');await p.waitForFunction(()=>holds[0].used,null,{timeout:4000});
  await p.evaluate(async()=>{await module.show('backup');holds[0].result.status='passed';holds[0].resolve();});await idle(p);assert.equal(await p.evaluate(()=>module.tab),'backup');assert.equal(await p.locator('[data-workbench-page="library"]').isHidden(),true);
  const statusCount=await p.evaluate(()=>calls.filter(call=>call.channel==='targetFeedback.status').length);
  // Observe longer than the production one-second polling interval after hiding.
  await p.waitForTimeout(1200);assert.equal(await p.evaluate(()=>calls.filter(call=>call.channel==='targetFeedback.status').length),statusCount);await finish(p);
 });
 await check('a late initial read cannot overwrite a newer read of the same component',async()=>{
  const p=await fixture(true);await p.evaluate(()=>{holds.push({channel:'targetFeedback.describe'});window.oldRead=module.show();});await p.waitForFunction(()=>holds[0].used);
  await p.evaluate(async()=>{describeValue=777;defaultValue=444;submit('重新读取参数');await lastAction;});assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'777');
  await p.evaluate(async()=>{holds[0].resolve();await oldRead;});assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'777');await submit(p,'使用底座默认值');assert.equal(await p.locator('[data-target-feedback-value]').inputValue(),'444');await finish(p);
 });
 assert.deepEqual(violations,[]);assert.deepEqual(pageErrors,[]);report.passed=report.checks.every(check=>check.passed);
}catch(error){report.failure=String(error.stack||error);process.exitCode=1;}
finally{report.completed=true;report.finishedAt=new Date().toISOString();report.externalRequests=violations;report.pageErrors=pageErrors;await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,passed:report.passed,checks:report.checks.length}));}
