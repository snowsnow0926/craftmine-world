// Real React forms in isolated headless Chromium. Mocked host responses verify UI
// ownership and recovery only; this is not a native gameplay or human acceptance test.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright, browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/direct-library-ui-'));
const code=`import React from 'react';import {createRoot} from 'react-dom/client';
import {AssetLibraryPanel} from './src/components/craftmine/assets/AssetLibraryPanel';
import {parseDirectOperation,currentDirectAttempts} from './src/components/craftmine/assets/direct-library-state';
const app=createRoot(document.getElementById('root')),hash='a'.repeat(64);
const state={indexed:true,previewable:false,baseChecked:null,appliedToSource:null};
const assets=['pet','raw','world','unsupported'].map((id,index)=>({assetId:id==='world'?'player.world.garden':id,version:2,contentHash:hash,displayName:['小白','原始模型','庭院','旧组件'][index],kind:id==='raw'?'raw':id==='world'?'world':'module',mediaKind:id==='raw'?'model':'package',bytes:50,fileCount:1,files:[],source:{origin:'local',author:'Player',license:'CC0',licenseStatus:'unverified'},state,tags:[],favorite:false,createdAt:1}));
const f=window.fixture={calls:[],ai:[],ops:new Map(window.savedHostOps??[]),world:'w1',counter:0,holdStart:false,holdInspect:false,failStart:false,failStatus:false};
f.bridge={call:async(channel,args)=>{f.calls.push({channel,args:structuredClone(args)});
if(channel==='asset.search')return{items:assets,total:assets.length,nextOffset:null,truncated:false};
if(channel==='asset.read')return{version_:assets.find(a=>a.assetId===args.assetId),state};
if(channel==='asset.versions')return{items:[{version_:assets.find(a=>a.assetId===args.assetId),state}],total:1,nextOffset:null};
if(channel==='asset.previewRead')return{records:[]};if(channel==='asset.usage')return{items:[],total:0};
if(channel==='library.direct'){
if(args.action==='inspect'){if(f.holdInspect)await new Promise(resolve=>f.releaseInspect=resolve);return{eligible:args.ref.assetId!=='unsupported',reason:args.ref.assetId==='unsupported'?'SOURCE_PACKAGE_UNSUPPORTED':undefined,compatibility:'unchecked',positionSupported:true};}
if(args.action==='start'){let op=f.ops.get(args.operationId);if(!op){op={operationId:args.operationId,worldId:args.worldId,ref:args.ref,position:args.position,status:'checking',stage:'native-check',instanceIds:['instance-'+args.operationId],draftRetained:true,modelCalls:0,createdAt:++f.counter,updatedAt:f.counter};f.ops.set(args.operationId,op);}const reply=structuredClone(op);if(f.holdStart)await new Promise(resolve=>f.releaseStart=resolve);if(f.failStart)throw Error('LOST_ACK');return reply;}
if(args.action==='status'&&f.failStatus)throw Error('TEMPORARILY_UNAVAILABLE');
const op=f.ops.get(args.operationId);if(!op)throw Error('DIRECT_LIBRARY_OPERATION_NOT_FOUND');
if(args.action==='cancel'){op.status='cancelled';op.updatedAt=++f.counter;}
if(args.action==='apply'){if(op.status!=='ready')throw Error('NOT_READY');op.status='applied';op.draftRetained=false;op.updatedAt=++f.counter;}
return structuredClone(op);}
throw Error('UNEXPECTED:'+channel);}};
f.render=(world='w1',lang='zh')=>{f.world=world;app.render(<AssetLibraryPanel key={world+lang} bridge={f.bridge} worldId={world} worldName='测试世界' lang={lang} onUseAsset={async(asset,modify)=>f.ai.push({asset,modify})}/>);};
f.unmount=()=>app.render(<p data-closed>Closed</p>);
f.change=(selector,value,checked=false)=>{const node=document.querySelector(selector);node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onChange({target:checked?{checked:value}:{value}});};
f.finish=(status='ready')=>{const op=[...f.ops.values()].at(-1);op.status=status;op.updatedAt=++f.counter;};
f.validateResponses=()=>{const attempt=currentDirectAttempts()[0],op=f.ops.get(attempt.request.operationId);return [{...op,worldId:'other'}, {...op,operationId:'other-operation'}, {...op,ref:{...op.ref,version:99}}, {...op,status:'success'}, {...op,modelCalls:1}].every(value=>{try{parseDirectOperation(value,attempt);return false;}catch{return true;}});};
f.render();`;
await require('esbuild').build({stdin:{contents:code,resolveDir:desktop,sourcefile:'direct-library-fixture.tsx',loader:'tsx'},bundle:true,format:'esm',outfile:path.join(out,'fixture.js'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html><meta charset="utf-8"><style>:root{--ds-bg-primary:#171717;--ds-bg-secondary:#242424;--ds-text-primary:#eee;--ds-text-secondary:#bbb;--ds-border-subtle:#555;--text-sm:14px;--radius-sm:6px}body{margin:20px;font:14px system-ui;background:#171717;color:#eee}button,input,select,textarea{font:inherit;color:inherit;background:#282828;padding:6px;border:1px solid #555}</style><link rel="stylesheet" href="./fixture.css"><div id="root"></div><script type="module" src="./fixture.js"></script></html>');
const browser=await playwright().chromium.launch({...browserOptions(),args:['--allow-file-access-from-files']}),page=await browser.newPage({viewport:{width:1280,height:1000}});
const report={out,checks:[],errors:[]},check=(label,condition)=>{assert(condition,label);report.checks.push(label);};
page.on('pageerror',error=>report.errors.push(String(error)));
await page.addInitScript(()=>{window.violations=[];Element.prototype.requestPointerLock=function(){violations.push('pointerLock');throw Error('BLOCKED');};window.focus=()=>violations.push('focus');HTMLElement.prototype.focus=function(){};});
const submit=selector=>page.evaluate(selector=>document.querySelector(selector).requestSubmit(),selector);
const select=async id=>{await page.evaluate(id=>document.querySelector('[data-asset-id="'+id+'"]').closest('form').requestSubmit(),id);await page.waitForSelector('[data-direct-use="'+id+'"]');};
const change=(selector,value,checked=false)=>page.evaluate(args=>fixture.change(...args),[selector,value,checked]);
try{
await page.goto(pathToFileURL(path.join(out,'index.html')).href);
await page.waitForSelector('[data-asset-id]');
await select('pet');await page.waitForSelector('[data-direct-start-form]');
check('eligibility is read-only and never invokes AI',await page.evaluate(()=>fixture.calls.filter(c=>c.channel==='library.direct').every(c=>c.args.action==='inspect')&&fixture.ai.length===0));
await change('[data-direct-custom-position]',true,true);await change('[data-direct-position-axis="x"]','4.5');await change('[data-direct-position-axis="z"]','-3');
await submit('[data-direct-start-form]');await page.waitForSelector('[data-direct-status="checking"]');
const first=await page.evaluate(()=>fixture.calls.find(c=>c.channel==='library.direct'&&c.args.action==='start').args);
check('native direct start has the exact reference, explicit coordinates, and no Composer call',first.ref.version===2&&first.ref.contentHash==='a'.repeat(64)&&first.position.x===4.5&&first.position.z===-3&&await page.evaluate(()=>fixture.ai.length===0));
await select('raw');check('raw resource has no direct prepare button while AI remains available',await page.evaluate(()=>!!document.querySelector('[data-direct-unavailable]')&&!document.querySelector('[data-direct-start-form]')&&!!document.querySelector('[data-asset-use="modify"]')&&!!document.querySelector('[data-direct-status="checking"]')));
await page.evaluate(()=>fixture.unmount());await page.waitForSelector('[data-closed]');await page.evaluate(()=>{fixture.finish();fixture.render();});await page.waitForSelector('[data-direct-status="ready"]');
check('closing and returning recovers the checked operation without restarting it',await page.evaluate(()=>fixture.calls.filter(c=>c.args.action==='start').length===1));
await page.screenshot({path:path.join(out,'ready-zh.png')});
await submit('[data-direct-action="apply"]');await page.waitForSelector('[data-direct-status="applied"]');
check('addition is explicit only after ready and uses the original operation ID',await page.evaluate(id=>fixture.calls.find(c=>c.args.action==='apply').args.operationId===id,first.operationId));
await select('pet');await page.waitForSelector('[data-direct-start-form]');await page.evaluate(()=>{fixture.failStart=true;fixture.failStatus=true;});await submit('[data-direct-start-form]');await page.waitForSelector('[data-direct-status="unknown"] [role="alert"]');
const uncertain=await page.evaluate(()=>fixture.calls.filter(c=>c.args.action==='start').at(-1).args);
check('a second explicit addition receives a different operation identity',uncertain.operationId!==first.operationId);
await page.evaluate(()=>fixture.unmount());await page.waitForSelector('[data-closed]');await page.evaluate(()=>fixture.render('w2'));await page.waitForSelector('[data-asset-id]');
check('switching worlds does not expose or apply another world operation',await page.evaluate(()=>!document.querySelector('[data-direct-activity]')));
await page.evaluate(()=>{fixture.render('w1');});await page.waitForSelector('[data-direct-status="unknown"]');await submit('[data-direct-action="retry"]');await page.waitForFunction(()=>fixture.calls.filter(c=>c.args.action==='start').length===3);
check('uncertain acknowledgement retry keeps the original immutable request across remount and world switch',JSON.stringify(uncertain)===JSON.stringify(await page.evaluate(()=>fixture.calls.filter(c=>c.args.action==='start').at(-1).args)));
await page.evaluate(()=>{fixture.failStart=false;fixture.failStatus=false;});await submit('[data-direct-status="unknown"] [data-direct-action="cancel"]');await page.waitForSelector('[data-direct-status="cancelled"]');
await select('pet');await page.waitForSelector('[data-direct-start-form]');await page.evaluate(()=>fixture.holdStart=true);await submit('[data-direct-start-form]');await page.waitForFunction(()=>fixture.releaseStart);
await submit('[data-direct-status="unknown"] [data-direct-action="cancel"]');await page.waitForFunction(()=>document.querySelectorAll('[data-direct-status="cancelled"]').length===2);await page.evaluate(()=>fixture.releaseStart());
check('confirmed cancellation cannot be replaced by a late prepare acknowledgement',await page.evaluate(()=>!document.querySelector('[data-direct-status="checking"]')&&!document.querySelector('[data-direct-status="ready"]')));
await select('unsupported');await page.waitForSelector('[data-direct-unavailable]');check('host unsupported refusal preserves AI modification',await page.evaluate(()=>!!document.querySelector('[data-asset-use="modify"]')&&!document.querySelector('[data-direct-start-form]')));
await page.evaluate(()=>document.querySelector('[data-asset-use="modify"]').closest('form').requestSubmit());await page.waitForFunction(()=>fixture.ai.length===1);
check('AI modification retains its original callback and selected immutable version',await page.evaluate(()=>fixture.ai[0].modify===true&&fixture.ai[0].asset.assetId==='unsupported'&&fixture.ai[0].asset.version===2));
await select('player.world.garden');check('world template keeps independent-world creation and no object preparation',await page.evaluate(()=>!!document.querySelector('[data-asset-world-template]')&&!document.querySelector('[data-direct-start-form]')));
await page.evaluate(()=>fixture.render('w1','en'));await page.waitForSelector('[data-direct-status="cancelled"]');await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'activity-en-narrow.png')});
check('English operation copy is visible without horizontal page overflow',await page.evaluate(()=>document.body.textContent.includes('Cancelled')&&document.documentElement.scrollWidth<=window.innerWidth));
check('foreign world/reference/operation receipts and nonzero model calls are rejected',await page.evaluate(()=>fixture.validateResponses()));
await page.evaluate(()=>{fixture.holdStart=false;fixture.render('inspection-world');});await page.waitForSelector('[data-asset-id]');await page.evaluate(()=>fixture.holdInspect=true);await select('pet');await page.waitForFunction(()=>fixture.releaseInspect);await select('raw');await page.evaluate(()=>fixture.releaseInspect());
check('late eligibility from a prior asset cannot enable raw-resource placement',await page.evaluate(()=>!!document.querySelector('[data-direct-use="raw"]')&&!document.querySelector('[data-direct-start-form]')));
await page.evaluate(()=>{fixture.holdInspect=false;fixture.render('reload-world');});await page.waitForSelector('[data-asset-id]');await select('pet');await page.waitForSelector('[data-direct-start-form]');await submit('[data-direct-start-form]');await page.waitForSelector('[data-direct-status="checking"]');
const beforeReload=await page.evaluate(()=>({host:[...fixture.ops],id:[...fixture.ops.keys()].at(-1)}));await page.addInitScript(value=>window.savedHostOps=value,beforeReload.host);await page.reload();await page.waitForSelector('[data-asset-id]');await page.evaluate(()=>fixture.render('reload-world'));await page.waitForSelector('[data-direct-status="checking"]');
check('renderer reload recovers the saved operation with status only, without replaying preparation',await page.evaluate(id=>fixture.calls.some(c=>c.args.action==='status'&&c.args.operationId===id)&&!fixture.calls.some(c=>c.args.action==='start'),beforeReload.id));
check('no pointer lock, focus, or page errors',await page.evaluate(()=>violations.length===0)&&report.errors.length===0);report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
