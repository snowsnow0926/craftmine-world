// Real result component, status observer, preview controls and retained plugin
// controller. A finite domain fixture makes failures reproducible; native/core
// commit and persistence evidence is collected separately from the final ZIP.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=fs.mkdtempSync(path.resolve('test-results/fb02-result-'));
const report={checks:[],errors:[],scope:'actual React and retained product view; finite host, no native/Rust persistence claim'};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {CraftmineCreationResult} from ${JSON.stringify(path.join(desktop,'src/components/CraftmineCreationResult.tsx'))};
import {CraftminePreviewControls} from ${JSON.stringify(path.join(desktop,'src/components/CraftminePreviewControls.tsx'))};
globalThis.fixture={sessionId:'session-one',running:false};
globalThis.__craftmineWorldBridge={invoke:(_plugin,method,args)=>productInvoke(method,args),onChanged:()=>()=>{}};
function Root(){const [version,setVersion]=useState(0);fixture.refresh=()=>setVersion(x=>x+1);return <div key={version}><CraftmineCreationResult/><CraftminePreviewControls autoOpen={false}/></div>}
createRoot(document.getElementById('root')).render(<Root/>);`;
await require('esbuild').build({stdin:{contents:entry,loader:'tsx',resolveDir:desktop},outfile:path.join(out,'result.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'finite-main-host',setup(b){
  b.onResolve({filter:/^(react|react-dom)(\/.*)?$/},args=>({path:require.resolve(args.path)}));
  b.onResolve({filter:/(^|\/)api$/},()=>({path:'api',namespace:'fixture'}));
  b.onResolve({filter:/stores\/app-store$/},()=>({path:'store',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path:kind})=>({loader:'js',contents:kind==='api'?`export const api={pluginPanelInvoke:(_plugin,method,args)=>productInvoke(method,args)};`:`export const useAppStore=selector=>selector({activeSessionId:fixture.sessionId,isRunning:fixture.running});useAppStore.getState=()=>({workPanelTabs:[]});`}));
}}]});
await require('esbuild').build({entryPoints:['plugins/craftmine-world/view.mjs'],outfile:path.join(out,'view.js'),bundle:true,platform:'browser',format:'iife',define:{CRAFTMINE_BOOT_WORLD:'{}',CRAFTMINE_GAME_DOCUMENT:'""',CRAFTMINE_INPUT_GUARD:'""'}});
fs.copyFileSync('plugins/craftmine-world/world.html',path.join(out,'world.html'));
fs.writeFileSync(path.join(out,'result.html'),'<html><meta charset="utf-8"><link rel="stylesheet" href="result.css"><div id="root"></div><script src="result.js"></script></html>');
const server=http.createServer((req,res)=>{const filename=path.basename(req.url||'result.html');if(!fs.existsSync(path.join(out,filename))){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(out,filename)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true,args:['--disable-gpu'],viewport:{width:1200,height:760}});
  await browser.addInitScript(()=>{globalThis.inputViolations=[];window.focus=()=>inputViolations.push('focus');Element.prototype.requestPointerLock=()=>{inputViolations.push('pointer');throw Error('disabled');};});
  const product=await browser.newPage();product.on('pageerror',e=>report.errors.push(String(e)));
  await product.addInitScript(()=>{
    const record={id:'world-one',title:'第一个世界',revision:1,world:{build:{id:'build-old',engine:{kind:'godot-web'}},snapshot:{coins:12}}};
    const identity={worldId:'world-one',sessionId:'session-one',jobId:'job-one',candidateId:'candidate-one',buildId:'build-new'};
    globalThis.domain={record,identity,status:'ready',preview:false,calls:[],failApply:false,selectedWorldId:'world-one',saveCount:0};
    globalThis.pluginBridge={on(){},invoke:async(method,args)=>{
      domain.calls.push({method,args});
      if(method==='world.list')return {worlds:[record],activeWorldId:domain.selectedWorldId};
      if(method==='world.open'||method==='world.read')return record;
      if(method==='godot.runtimeState')return {worldId:record.id,buildId:record.world.build.id,instanceId:'fixture-instance',state:'ready'};
      if(method==='godot.runtimeSave'){domain.saveCount++;return {worldId:record.id,buildId:record.world.build.id,revision:record.revision};}
      if(method==='godot.candidateList')return {items:[{...identity,sourceRevision:2,status:domain.status==='applied'?'applied':'ready'}],nextOffset:null};
      if(method==='godot.candidatePreview'){if(args.candidateId!==identity.candidateId)throw Error('CANDIDATE_NOT_FOUND');domain.preview=true;return {status:'preview',...identity};}
      if(method==='godot.candidateClose'){domain.preview=false;return {status:'none'};}
      if(method==='godot.candidateApply'){
        if(domain.failApply)throw Error('SAVE_TEMPORARILY_UNAVAILABLE');
        if(!domain.preview)throw Error('PREVIEW_REQUIRED');domain.preview=false;domain.status='applied';record.revision++;record.world.build.id=identity.buildId;
        return {status:'applied',record};
      }
      if(method==='godot.candidateState')return {status:domain.preview?'preview':'closed',...identity};
      return {};
    }};
  });
  await product.goto(url+'/world.html');await product.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  const main=await browser.newPage();main.on('pageerror',e=>report.errors.push(String(e)));
  await main.exposeFunction('productInvoke',async(method,args)=>{
    if(method==='godot.creationTaskStatus')return product.evaluate(sessionId=>({...domain.identity,sessionId,worldTitle:domain.record.title,selectedWorldId:domain.selectedWorldId,phase:sessionId===domain.identity.sessionId?domain.status:'idle',requirementStatus:'not-requested'}),args.sessionId);
    if(method==='world.previewControl')return product.evaluate(args=>craftmineView.previewControl(args),args);
    if(method==='world.switch')return product.evaluate(args=>{domain.selectedWorldId=args.id;return {ok:true};},args);
    throw Error('UNEXPECTED '+method);
  });
  await main.goto(url+'/result.html');await main.waitForSelector('[data-phase="ready"]');
  const reactAction=label=>main.evaluate(label=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent===label);if(!button||button.disabled)throw Error('ACTION_UNAVAILABLE '+label);return button[Object.keys(button).find(k=>k.startsWith('__reactProps$'))].onClick();},label);
  const refresh=()=>main.evaluate(()=>window.dispatchEvent(new Event('craftmine-creation-edit-status')));
  check('a passed job shows a real result card before any preview was opened',await main.locator('[data-candidate-id="candidate-one"]').isVisible()&&!await main.locator('[data-preview-id]').count());
  check('result identity binds world session job candidate and build',await main.locator('[data-session-id="session-one"][data-world-id="world-one"][data-job-id="job-one"][data-build-id="build-new"]').count()===1);
  await main.screenshot({path:path.join(out,'result-ready.png')});
  // Start with the original feedback button in the real checks list.
  await product.evaluate(()=>craftmineView.showChecks());await product.waitForSelector('.check-row button');
  await product.evaluate(()=>document.querySelector('.check-row button').onclick());
  await product.waitForFunction(()=>document.body.dataset.previewLoaded==='true');await main.waitForSelector('[data-preview-id]');
  check('original checks-list preview button opens the exact candidate',await product.evaluate(()=>domain.calls.some(x=>x.method==='godot.candidatePreview'&&x.args.candidateId==='candidate-one')));
  await reactAction('返回原世界');await main.waitForFunction(()=>!document.querySelector('[data-preview-id]'));
  check('return from preview leaves formal build and player progress unchanged',await product.evaluate(()=>domain.record.world.build.id==='build-old'&&domain.record.world.snapshot.coins===12));
  // Exercise the new direct result action without visiting the records again.
  await product.evaluate(()=>{domain.failApply=true;});await reactAction('应用到世界');await main.waitForSelector('[role="alert"]');
  check('failed direct adoption has a readable cause and retains raw diagnostics',await main.locator('[role="alert"]').first().textContent().then(x=>x.includes('保存未完成'))
    &&await main.locator('details pre').first().textContent().then(x=>x.includes('SAVE_TEMPORARILY')));
  await product.evaluate(()=>{domain.failApply=false;});
  // The failed request retains a real preview; repeat through its guarded nonce.
  await main.waitForSelector('[data-preview-id]');
  await main.evaluate(()=>{const section=document.querySelector('[data-preview-id]');const b=section.querySelector('button');return b[Object.keys(b).find(k=>k.startsWith('__reactProps$'))].onClick();});
  await product.waitForFunction(()=>domain.status==='applied');await refresh();await main.waitForSelector('[data-phase="applied"]');
  check('adoption confirms actual formal build and retains snapshot',await product.evaluate(()=>domain.record.world.build.id==='build-new'&&domain.record.world.snapshot.coins===12));
  await main.reload();await main.waitForSelector('[data-phase="applied"]');
  check('reopened result reads persisted host facts instead of relying on component state',await main.locator('[data-phase="applied"]').isVisible());
  await product.evaluate(()=>{domain.selectedWorldId='other-world';});await refresh();await main.waitForFunction(()=>document.body.textContent.includes('切换到目标世界'));
  await reactAction('切换到目标世界');await main.waitForFunction(()=>!document.body.textContent.includes('切换到目标世界'));
  check('result can return to its exact target world',await product.evaluate(()=>domain.selectedWorldId==='world-one'));
  await main.evaluate(()=>{fixture.sessionId='unrelated-session';fixture.refresh();});await main.waitForFunction(()=>!document.querySelector('[data-candidate-id]'));
  check('changing sessions never exposes another session candidate actions',!await main.locator('[data-candidate-id]').count());
  check('no input ownership changes or renderer failures',await main.evaluate(()=>!inputViolations.length)&&await product.evaluate(()=>!inputViolations.length)&&!report.errors.length);
  report.passed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);}
