// Actual React publication/chooser fixtures. Ordinary handlers and forms only;
// independent headless Chromium, no OS input, model calls or native gameplay claims.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';
import{playwright,browserOptions}from'../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/player-library-ui-'));
const code=`import React from'react';import{createRoot}from'react-dom/client';import{LibraryPublishPanel}from'./src/components/craftmine/assets/LibraryPublishPanel';import{LocalWorldTemplates}from'./src/components/craftmine/LocalWorldTemplates';import'./src/components/craftmine/assets/asset-library.css';
const hash='a'.repeat(64),app=createRoot(document.getElementById('root'));
const f=window.fixture={calls:[],version:0,fail:false,statusFail:false,hold:false,receipt:null,created:[],saved:[]};
const ref={assetId:'player.world.garden',version:2,contentHash:hash},template={format:'craftmine.player-world-template/1',kind:'world',action:'create-new-world',initialState:'saved-progress',ref,displayName:'我的庭院',description:'可步行庭院',tags:['庭院']};
f.bridge={call:async(channel,args={})=>{f.calls.push({channel,args});
if(channel==='asset.search')return{items:[{assetId:'player.component.pet',version:1,contentHash:hash,displayName:'小白'}]};
if(channel==='godot.runtimeSave'){if(f.hold)await new Promise(resolve=>f.release=resolve);return{saved:true};}
if(channel==='worldTemplate.describe')return{expectedSource:{worldId:args.worldId,buildId:'b1',revision:3,snapshotHash:hash}};
if(channel==='worldTemplate.save'){if(f.lateCancel){await new Promise(resolve=>f.rejectLate=resolve);throw Error('OPERATION_CONFLICT');}f.receipt={...template,ref:{assetId:args.assetId,version:args.version,contentHash:hash},displayName:args.displayName};if(f.fail)throw Error('LOST_ACK');return f.receipt;}
if(channel==='worldTemplate.cancel')return{status:'cancelled'};
if(channel==='worldTemplate.status')return{status:'saved',result:f.receipt};
if(channel==='worldTemplate.list')return{items:[{...ref,displayName:template.displayName}],nextOffset:null};
if(channel==='worldTemplate.read')return template;
if(channel==='worldTemplate.import')return template;
if(channel==='worldTemplate.export')return{status:'completed',ref};
if(channel==='package.request'){
if(args.method==='sourceList')return{worldId:args.worldId,revision:7,manifestHash:hash,items:[{nodePath:'world/Pet',name:'小白',supported:true},{nodePath:'world',name:'整个世界',supported:false}]};
if(args.method==='publishSource'){f.receipt={status:'completed',assetRef:{assetId:args.params.assetId,version:args.params.version,contentHash:hash},worldId:args.worldId,operationId:args.params.operationId,previewStatus:'source-world-view'};if(f.fail)throw Error('LOST_ACK');return f.receipt;}
if(args.method==='publishSourceStatus'){if(f.statusFail)throw Error('TEMPORARILY_UNAVAILABLE');return f.receipt;}
if(args.method==='cancelPublishSource')return{...f.receipt,cancelled:false};
}throw Error('UNEXPECTED:'+channel);}};
f.render=(kind='component',worldId='w1')=>{app.render(<LibraryPublishPanel key={++f.version} bridge={f.bridge} worldId={worldId} worldName='测试世界' kind={kind} zh onSaved={ref=>f.saved.push(ref)}/>);};
f.templates=(locked=false)=>app.render(<LocalWorldTemplates key={++f.version} bridge={f.bridge} zh busy={false} locked={locked} onCreate={async(ref,title)=>{f.created.push({ref,title});}}/>);
f.change=(selector,value,checked=false)=>{const node=document.querySelector(selector),key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));node[key].onChange({target:checked?{checked:value}:{value}});};
f.activate=selector=>{const node=document.querySelector(selector),key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));node[key].onClick({preventDefault(){}});};
f.unmount=()=>app.render(<p data-unmounted>Closed</p>);f.render();`;
await require('esbuild').build({stdin:{contents:code,resolveDir:desktop,sourcefile:'player-library-fixture.tsx',loader:'tsx'},bundle:true,format:'esm',outfile:path.join(out,'fixture.js'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html><meta charset="utf-8"><style>:root{--ds-bg-primary:#171717;--ds-bg-secondary:#222;--ds-text-primary:#eee;--ds-text-secondary:#bbb;--ds-border-subtle:#444;--text-sm:14px;--space-2:8px;--space-3:12px;--space-4:16px}body{margin:20px;font:14px system-ui;background:#171717;color:#eee}#root{max-width:760px}button,input,select,textarea{font:inherit;color:inherit;background:#282828;padding:6px;border:1px solid #555}</style><link rel="stylesheet" href="./fixture.css"><div id="root"></div><script type="module" src="./fixture.js"></script></html>');
const browser=await playwright().chromium.launch({...browserOptions(),args:['--allow-file-access-from-files']}),page=await browser.newPage({viewport:{width:1000,height:900}}),report={out,checks:[],errors:[]};
page.on('pageerror',error=>report.errors.push(String(error)));
await page.addInitScript(()=>{window.violations=[];Element.prototype.requestPointerLock=function(){violations.push('pointerLock');throw Error('BLOCKED');};window.focus=()=>violations.push('focus');HTMLElement.prototype.focus=function(){};});
const check=(label,condition)=>{assert(condition,label);report.checks.push(label);},submit=selector=>page.evaluate(selector=>document.querySelector(selector).requestSubmit(),selector),change=(selector,value,checked=false)=>page.evaluate(args=>fixture.change(...args),[selector,value,checked]);
const ready=()=>page.waitForFunction(()=>{const field=document.querySelector('[data-library-publish-form] fieldset');return field&&!field.disabled;});
try{
await page.goto(pathToFileURL(path.join(out,'index.html')).href);await ready();
check('component selection is explicit and unsupported world root is disabled',await page.evaluate(()=>document.querySelector('[data-publication-object]').value===''&&document.querySelector('option[value="world"]').disabled));
await change('[data-publication-object]','world/Pet');await change('[data-publication-aliases]','毛球, 白色伙伴');await change('[data-publication-version-target]','player.component.pet');
await page.screenshot({path:path.join(out,'publish-component.png')});
await page.evaluate(()=>fixture.fail=true);await submit('[data-library-publish-form]');await page.waitForSelector('[data-publication-result]');
check('lost publication acknowledgement recovers the flat native durable receipt',await page.evaluate(()=>fixture.calls.filter(row=>row.args.method==='publishSource').length===1&&fixture.receipt.assetRef.version===2&&fixture.calls.find(row=>row.args.method==='publishSource').args.params.aliases.includes('毛球')));
await page.evaluate(()=>{fixture.render('component','retry-world');fixture.statusFail=true;});await ready();await change('[data-publication-object]','world/Pet');await submit('[data-library-publish-form]');await page.waitForSelector('[role=alert]');
const original=await page.evaluate(()=>fixture.calls.filter(row=>row.args.method==='publishSource').at(-1).args);
await page.evaluate(()=>{fixture.unmount();});await page.waitForSelector('[data-unmounted]');await page.evaluate(()=>{fixture.fail=false;fixture.statusFail=false;fixture.render('component','retry-world');});await page.waitForFunction(()=>document.body.textContent.includes('重试本次保存'));
await submit('[data-library-publish-form]');await page.waitForSelector('[data-publication-result]');
check('remount retry preserves exact operation, selected source, metadata and version',JSON.stringify(original)===JSON.stringify(await page.evaluate(()=>fixture.calls.filter(row=>row.args.method==='publishSource').at(-1).args)));
await page.evaluate(()=>fixture.render('world','checkpoint-world'));await ready();await submit('[data-library-publish-form]');await page.waitForSelector('[role=alert]');
check('world checkpoint starts unchecked and refusal performs no save or publication',await page.evaluate(()=>!fixture.calls.some(row=>row.channel==='godot.runtimeSave'||row.channel==='worldTemplate.save')));
await change('[data-publication-checkpoint]',true,true);await submit('[data-library-publish-form]');await page.waitForSelector('[data-publication-result]');
check('explicit checkpoint uses ordinary runtime save, formal source description, then template commit',await page.evaluate(()=>fixture.calls.filter(row=>['godot.runtimeSave','worldTemplate.describe','worldTemplate.save'].includes(row.channel)).map(row=>row.channel).join(',')==='godot.runtimeSave,worldTemplate.describe,worldTemplate.save'&&fixture.calls.find(row=>row.channel==='worldTemplate.save').args.expectedSource.worldId==='checkpoint-world'));
await page.evaluate(()=>{fixture.hold=true;fixture.render('world','closed-world');});await ready();await change('[data-publication-checkpoint]',true,true);await submit('[data-library-publish-form]');await page.waitForFunction(()=>fixture.release);await page.evaluate(()=>fixture.unmount());await page.waitForSelector('[data-unmounted]');await page.evaluate(()=>fixture.release());await page.waitForTimeout(50);
check('closing during save preflight cannot publish the old world later',await page.evaluate(()=>!fixture.calls.some(row=>row.channel==='worldTemplate.save'&&row.args.worldId==='closed-world')));
await page.evaluate(()=>{fixture.hold=false;fixture.lateCancel=true;fixture.render('world','cancelled-world');});await ready();await change('[data-publication-checkpoint]',true,true);await submit('[data-library-publish-form]');await page.waitForFunction(()=>fixture.rejectLate);
await page.evaluate(()=>{const node=[...document.querySelectorAll('button')].find(n=>n.textContent==='取消本次保存');node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onClick();});await page.waitForFunction(()=>document.body.textContent.includes('已取消保存'));await page.evaluate(()=>fixture.rejectLate());await ready();
check('confirmed cancellation suppresses a late pre-dispatch conflict without displaying success',await page.evaluate(()=>!document.querySelector('[role=alert]')&&!document.querySelector('[data-publication-result]')&&document.body.textContent.includes('准备已取消')));
await page.evaluate(()=>fixture.templates());await page.waitForSelector('[data-local-template]');await submit('[data-local-template]');await page.waitForSelector('[data-local-template-selected]');await change('[data-template-world-title]','庭院副本');await page.screenshot({path:path.join(out,'my-templates.png')});await submit('[data-local-template-create]');await page.waitForFunction(()=>fixture.created.length===1);
check('template creation retains exact immutable version and chosen title',await page.evaluate(()=>fixture.created[0].ref.assetId==='player.world.garden'&&fixture.created[0].ref.version===2&&fixture.created[0].title==='庭院副本'));
await submit('[data-template-export]');await page.waitForFunction(()=>document.body.textContent.includes('已导出'));await submit('[data-template-import]');await page.waitForFunction(()=>document.body.textContent.includes('模板已导入'));
check('import/export supply references and operation ids, never renderer filesystem paths',await page.evaluate(()=>fixture.calls.filter(row=>['worldTemplate.export','worldTemplate.import'].includes(row.channel)).every(row=>!JSON.stringify(row.args).includes('Path'))));
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'templates-narrow.png')});
check('no pointer lock, focus, or page errors',await page.evaluate(()=>violations.length===0)&&!report.errors.length);report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
