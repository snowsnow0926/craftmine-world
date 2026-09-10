// Actual browser DOM and production UI, fixture transport. No input simulation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const root=path.resolve('.'),out=path.resolve('test-results/issue-ui');await fs.mkdir(out,{recursive:true});
const source=await fs.readFile(path.join(root,'plugins/craftmine-world/issue-ui.mjs'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/ui.mjs'?'text/javascript':'text/html');res.end(req.url==='/ui.mjs'?source:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Local issue UI fixture</title><style>body{font:15px sans-serif;background:#191919;color:#eee;margin:32px;max-width:750px}textarea{width:100%;display:block}button{padding:8px;margin:4px}form{display:inline-block}p{overflow-wrap:anywhere}.issue-description{white-space:pre-wrap}article{border:1px solid #777;padding:12px;margin-top:10px}</style><main id="ui"></main></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const report={fixture:true,passed:false,checks:[]};
const check=name=>report.checks.push(name);
try{
 browser=await playwright().chromium.launch(browserOptions());const context=await browser.newContext();
 await context.addInitScript(()=>{window.guard={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>{guard.pointerLock++;throw Error('forbidden');};window.focus=()=>{guard.focus++;throw Error('forbidden');};});
 const page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error)));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {createIssueUI}=await import('/ui.mjs');window.world='alpha';window.calls=[];window.items=[];window.failCreate=false;window.failContext=false;window.pending=[];window.holdList=false;
  window.request=async(channel,input)=>{
   calls.push({channel,input});
   if(channel==='issue.list'){const value={items:items.filter(x=>x.context.worldId===input.worldId).map(x=>({...x,descriptionPreview:x.description})),total:items.filter(x=>x.context.worldId===input.worldId).length,nextOffset:null};if(holdList){holdList=false;return new Promise(resolve=>pending.push(()=>resolve(value)));}return value;}
   if(channel==='issue.create'){
    if(failContext){failContext=false;throw Error('ISSUE_CONTEXT_NOT_READY');}
    let record=items.find(x=>x.id===input.operationId);if(!record){record={id:input.operationId,description:input.description,createdAt:'2026-09-10T00:00:00.000Z',client:{version:'0.14.3'},context:{worldId:input.worldId,buildId:'build-real-fixture',baseId:'first-person',baseVersion:'0.1.0',instanceId:'fixture-instance'}};items.push(record);}
    if(failCreate){failCreate=false;throw Error('LOST_REPLY');}return{status:'completed',issue:record};
   }
   if(channel==='issue.read')return{issue:items.find(x=>x.id===input.issueId)};
   if(channel==='issue.delete'){items=items.filter(x=>x.id!==input.issueId);return{status:'completed',deleted:true};}
   throw Error('Unexpected channel');
  };
  window.ui=createIssueUI({element:document.querySelector('#ui'),request,getWorldId:()=>world,action:async fn=>{window.lastAction=fn();await lastAction;}});await ui.show();
  window.submit=async label=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent===label);if(!b||b.disabled)throw Error('Unavailable '+label);b.form.requestSubmit();await lastAction;};
 });
 await page.evaluate(async()=>{document.querySelector('textarea').value='  花草问题\n<script>window.injected=true</script>  ';failCreate=true;await submit('记录问题');});
 assert.equal(await page.evaluate(()=>document.querySelector('textarea').readOnly),true);
 await page.evaluate(()=>submit('记录问题'));
 const saved=await page.evaluate(()=>({items,calls,text:document.body.textContent,injected:window.injected}));assert.equal(saved.items.length,1);assert.equal(saved.items[0].description,'  花草问题\n<script>window.injected=true</script>  ');assert.equal(saved.injected,undefined);assert.equal(saved.calls.filter(x=>x.channel==='issue.create')[0].input.operationId,saved.calls.filter(x=>x.channel==='issue.create')[1].input.operationId);check('lost response retries exact operation and original text; markup stays inert');
 await page.screenshot({path:path.join(out,'notebook.png'),fullPage:true});
 await page.evaluate(async()=>{await submit('删除这条记录');await submit('保留记录');});assert.equal(await page.evaluate(()=>items.length),1);
 await page.evaluate(async()=>{await submit('删除这条记录');await submit('确认删除记录');});assert.equal(await page.evaluate(()=>items.length),0);check('deletion requires explicit confirmation and refreshes list');
 await page.evaluate(async()=>{failContext=true;document.querySelector('textarea').value='not ready';await submit('记录问题');});assert.equal(await page.evaluate(()=>document.querySelector('textarea').readOnly),false);check('known pre-write failure releases description for correction');
 await page.evaluate(async()=>{holdList=true;window.oldShow=ui.show();await Promise.resolve();document.querySelector('textarea').value='new after old list';await submit('记录问题');});
 assert.ok((await page.textContent('body')).includes('此世界 1 条记录'));
 await page.evaluate(async()=>{pending.shift()();await oldShow;});assert.ok((await page.textContent('body')).includes('此世界 1 条记录'));check('old initial list cannot overwrite a newer create result');
 await page.evaluate(async()=>{holdList=true;window.oldShow=ui.show();await Promise.resolve();world='beta';ui.clear();await ui.show();pending.shift()();await oldShow;});
 assert.equal(await page.evaluate(()=>document.querySelector('[data-issue-id]')),null);assert.ok((await page.textContent('body')).includes('此世界 0 条记录'));check('world switching discards late results and old description');
 assert.deepEqual(await page.evaluate(()=>guard),{pointerLock:0,focus:0});assert.deepEqual(pageErrors,[]);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));}
