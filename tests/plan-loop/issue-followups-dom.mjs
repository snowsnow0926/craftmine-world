// Production DOM UI and durable notebook, with a declared host-context fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'../..'),deps=process.env.CRAFTMINE_DEPS_ROOT||path.join(root,'vendor/pi-desktop/packages/agent-runtime');
const {build}=createRequire(path.join(deps,'package.json'))('esbuild');
await fs.mkdir(path.join(root,'test-results'),{recursive:true});const out=await fs.mkdtemp(path.join(root,'test-results/issue-followups-dom-'));
const compiled=path.join(out,'service.mjs');await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-service.ts')],outfile:compiled,bundle:true,platform:'node',format:'esm'});
const {createCraftmineIssueService}=await import(pathToFileURL(compiled));
let captured={phase:'formal',status:'ready',worldId:'alpha',buildId:'build-a',baseId:'first-person',baseVersion:'0.1.0',instanceId:'instance-a',runtimeTarget:'godot-web',artifactManifestHash:'b'.repeat(64)};
let loseReply=false,holdPrepare=false,releasePrepare;
const options={directory:path.join(out,'notebook'),client:{version:'0.14.3'},captureContext:async()=>captured,fault:point=>{if(point==='afterRename'&&loseReply){loseReply=false;throw Error('lost reply');}}};
let service=createCraftmineIssueService(options);const calls=[];
const source=await fs.readFile(path.join(root,'plugins/craftmine-world/issue-ui.mjs'));
const server=http.createServer(async(req,res)=>{
 if(req.url==='/invoke'){
  try{let bytes='';for await(const chunk of req)bytes+=chunk;const {channel,input}=JSON.parse(bytes);calls.push({channel,input});let result=await service.request(channel,input);if(channel==='issue.followupPrepare'&&holdPrepare){holdPrepare=false;await new Promise(resolve=>{releasePrepare=resolve;});}res.end(JSON.stringify({result}));}catch(error){res.end(JSON.stringify({error:error.code||error.message}));}return;
 }
 res.setHeader('content-type',req.url==='/ui.mjs'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/ui.mjs'?source:'<html lang="zh-CN"><meta charset="utf-8"><style>body{background:#191919;color:#eee;font:15px sans-serif;margin:24px;max-width:850px}textarea{width:100%;display:block}p{overflow-wrap:anywhere}.issue-description{white-space:pre-wrap}article{border:1px solid #777;padding:10px}button{margin:6px}</style><main id="ui"></main></html>');
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const report={kind:'headless-dom-real-local-ledger',checks:[],errors:[],limits:['Host runtime context is a fixture; full Electron/Godot client validation is queued after the release.','No model, upload, OS input or visible windows.']};const check=(name,passed)=>{report.checks.push({name,passed:!!passed});assert.ok(passed,name);console.log('PASS '+name);};
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser'),browserOptions());
 await browser.addInitScript(()=>{window.guards={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>guards.pointerLock++;window.focus=()=>guards.focus++;HTMLElement.prototype.focus=()=>guards.focus++;});
 const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(async()=>{const{createIssueUI}=await import('/ui.mjs');window.world='alpha';window.ui=createIssueUI({element:document.querySelector('#ui'),getWorldId:()=>world,request:async(channel,input)=>{const result=await(await fetch('/invoke',{method:'POST',body:JSON.stringify({channel,input})})).json();if(result.error)throw Error(result.error);return result.result;},action:async fn=>{window.lastAction=fn();await lastAction;}});window.submit=async label=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent===label);if(!button||button.disabled)throw Error('Unavailable '+label);button.form.requestSubmit();await lastAction;};await ui.show();});
 await page.evaluate(async()=>{document.querySelector('[data-issue-description]').value='  Original problem 🌍\n<script>window.xss=1</script>  ';await submit('记录问题');});
 const initial=JSON.parse(await fs.readFile(path.join(out,'notebook/issues.json'))).records[0];
 captured={...captured,buildId:'build-b',instanceId:'instance-b'};
 await page.evaluate(()=>submit('查看记录'));
 loseReply=true;
 await page.evaluate(async()=>{document.querySelector('[data-issue-followup-text]').value='  Additional detail <img src=x onerror="window.xss=1">  ';await submit('保存补充与复测');});
 check('uncertain commit keeps original operation and text locked for retry',await page.evaluate(()=>document.querySelector('[data-issue-followup-text]').readOnly));
 captured={...captured,buildId:'build-c',instanceId:'instance-c'};
 await page.evaluate(()=>submit('重试原补充'));
 const attempts=calls.filter(x=>x.channel==='issue.followup');
 check('lost response retry uses same operation and records only one old-context entry',attempts.length===2&&JSON.stringify(attempts[0].input)===JSON.stringify(attempts[1].input)&&(JSON.parse(await fs.readFile(path.join(out,'notebook/issues.json')))).followups.length===1);
 for(const kind of ['still-present','player-resolved','reopened'])await page.evaluate(async kind=>{document.querySelector('[data-issue-followup-kind]').value=kind;document.querySelector('[data-issue-followup-text]').value='';await submit('保存补充与复测');},kind);
 let stored=JSON.parse(await fs.readFile(path.join(out,'notebook/issues.json')));
 check('three player retest states render without rewriting original scene',JSON.stringify(stored.records[0])===JSON.stringify(initial)&&stored.followups.length===4&&await page.evaluate(()=>document.body.textContent.includes('玩家重新打开')&&document.body.textContent.includes('不代表自动诊断')));
 check('original and subsequent contexts remain distinct and markup inert',stored.records[0].context.buildId==='build-a'&&stored.followups[0].context.buildId==='build-b'&&stored.followups[1].context.buildId==='build-c'&&await page.evaluate(()=>!window.xss&&!document.querySelector('img')));
 captured={...captured,buildId:'build-d'};
 await page.evaluate(async()=>{document.querySelector('[data-issue-followup-text]').value='stale context';await submit('保存补充与复测');});
 check('version change after opening detail refuses stale submit without appending',JSON.parse(await fs.readFile(path.join(out,'notebook/issues.json'))).followups.length===4&&await page.evaluate(()=>document.querySelector('.workbench-notice').dataset.error==='true'));
 service=createCraftmineIssueService(options);await page.evaluate(async()=>{await ui.show();await submit('查看记录');});
 check('new service factory and refreshed DOM retain all prior entries',await page.locator('[data-issue-followup-id]').count()===4);
 await page.screenshot({path:path.join(out,'followups.png'),fullPage:true});
 holdPrepare=true;await page.evaluate(()=>{window.oldRead=submit('查看记录');});
 for(let i=0;i<200&&!releasePrepare;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(releasePrepare);
 captured={...captured,worldId:'beta'};await page.evaluate(async()=>{world='beta';ui.clear();await ui.show();});releasePrepare();await page.evaluate(()=>oldRead);
 check('world switch discards a delayed prepared editor and old issue details',await page.locator('[data-issue-followup-text]').count()===0&&await page.evaluate(()=>!document.body.textContent.includes('Original problem')));
 check('zero focus, pointer lock and browser script failures',await page.evaluate(()=>guards.focus===0&&guards.pointerLock===0)&&report.errors.length===0);
}catch(error){report.errors.push(String(error.stack));process.exitCode=1;}
finally{releasePrepare?.();await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(out,'calls.json'),JSON.stringify(calls,null,2));console.log(JSON.stringify({out,checks:report.checks.length,errors:report.errors}));}
