// Actual React panel + existing core stdio API, with fixed local image fixtures.
// No Electron/Godot/model, real input, focus, pointer lock or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),args={};
for(let i=2;i<process.argv.length;i+=2){assert(['--deps-app','--core'].includes(process.argv[i]));assert(path.isAbsolute(process.argv[i+1]));args[process.argv[i]]=process.argv[i+1];}
assert(args['--deps-app']&&args['--core']);
const require=createRequire(path.join(args['--deps-app'],'package.json')),{build}=require('esbuild');
const {CoreClient}=createRequire(import.meta.url)('../../plugins/craftmine-world/core-client.cjs');
const out=fs.mkdtempSync(path.join(root,'test-results/asset-annotations-'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={kind:'actual-react-and-core-asset-annotations',passed:false,out,core:args['--core'],coreSha256:sha(fs.readFileSync(args['--core'])),steps:[],calls:[],errors:[],limits:['Fixed local image fixtures; no full Electron client or Godot execution.','Lost/late transport responses are injected only after the actual core transaction.']};
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const core=new CoreClient(args['--core'],path.join(out,'core'));let browser,mode=null,release=null;
const step=async(name,fn)=>{try{await fn();report.steps.push({name,passed:true});persist();}catch(error){report.steps.push({name,passed:false,error:String(error)});persist();throw error;}};
const sourceDir=path.join(out,'input');fs.mkdirSync(sourceDir);
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');
const sourcePath=path.join(sourceDir,'image.png');fs.writeFileSync(sourcePath,bytes);
const assets=path.join(root,'vendor/pi-desktop/apps/desktop/src/components/craftmine/assets');
report.sourceBaseCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
report.uiSourceFiles=['AssetLibraryPanel.tsx','AssetAnnotationEditor.tsx','use-asset-library.ts','asset-library-model.ts'].map(file=>({path:path.relative(root,path.join(assets,file)).replaceAll('\\','/'),sha256:sha(fs.readFileSync(path.join(assets,file)))}));
fs.writeFileSync(path.join(out,'entry.jsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{AssetLibraryPanel}from${JSON.stringify(path.join(assets,'AssetLibraryPanel.tsx'))};const bridge={call:(m,p)=>window.assetCall(m,p)};createRoot(document.getElementById('root')).render(<AssetLibraryPanel bridge={bridge} lang="zh"/>);`);
await build({entryPoints:[path.join(out,'entry.jsx')],outfile:path.join(out,'bundle.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',alias:{react:require.resolve('react'),'react-dom/client':require.resolve('react-dom/client'),'react/jsx-runtime':require.resolve('react/jsx-runtime')},loader:{'.css':'css'}});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"><style>body{font:14px system-ui;margin:20px;background:#222;color:#eee}button,input,select{font:inherit}input,select{color:#111} .asset-library-annotations form{margin:8px 0}button{padding:5px}</style><div id="root"></div><script src="bundle.js"></script>');
try{
 await core.start();
 for(const id of ['asset-a','asset-b'])await core.call('asset.import',{operationId:'import-'+id,sourceRoot:sourceDir,sourcePath,assetId:id,version:1,kind:'raw',mediaKind:'image',path:'image.png',mediaType:'image/png',displayName:id,source:{origin:'fixed-fixture',author:'test',license:'unknown',licenseStatus:'unverified'},tags:[]});
 const before={worlds:await core.call('world.list'),a:await core.call('asset.read',{assetId:'asset-a',version:1}),versions:await core.call('asset.versions',{assetId:'asset-a',offset:0,limit:20})};report.before=before;
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser'),{...browserOptions(),viewport:{width:1200,height:900}});
 await browser.addInitScript(()=>{window.audit={focus:0,lock:0};window.focus=()=>{window.audit.focus++;};HTMLElement.prototype.focus=()=>{window.audit.focus++;};Element.prototype.requestPointerLock=()=>{window.audit.lock++;throw Error('POINTER_LOCK_DENIED');};});
 const page=await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(String(error)));
 await page.route(/^https?:/,route=>route.abort());
 const allowed=new Set(['asset.search','asset.read','asset.versions','asset.previewRead','asset.usage','asset.annotate']);
 await page.exposeFunction('assetCall',async(method,payload)=>{
  assert(allowed.has(method));const call={method,payload:structuredClone(payload)};report.calls.push(call);
  try{assert.equal(payload.ownerWorldId,null);const {ownerWorldId,...args}=payload;const result=await core.call(method,args);call.result=result;
   if(method==='asset.annotate'&&mode==='drop'){mode=null;call.transport='reply-dropped-after-commit';throw Error('FIXED_REPLY_LOST');}
   if(method==='asset.annotate'&&mode==='hold'){mode=null;call.transport='held-after-commit';await new Promise(resolve=>{release=resolve;});}
   return result;
  }catch(error){call.error=String(error);throw error;}
 });
 await page.goto(pathToFileURL(path.join(out,'index.html')).href);
 const select=async id=>{await page.waitForFunction(id=>!!document.querySelector(`[data-asset-id="${id}"]`),id);await page.evaluate(id=>document.querySelector(`[data-asset-id="${id}"]`).form.requestSubmit(),id);await page.waitForFunction(id=>!!document.querySelector(`[data-annotation-asset="${id}"]`),id);};
 const submit=kind=>page.evaluate(kind=>document.querySelector(`[data-annotation-form="${kind}"]`).requestSubmit(),kind);
 const settled=()=>page.waitForFunction(()=>{const b=document.querySelector('[data-annotation-form="favorite"] button');return b&&!b.disabled;});
 const tags=async text=>{await page.evaluate(value=>{const input=document.querySelector('[data-annotation-tags]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));},text);await submit('tags');};
 await step('real detail exposes favorite and tag edits',async()=>{await select('asset-a');assert(await page.locator('[data-annotation-form="tags"]').count());});
 await step('two favorite toggles use distinct operations and persist',async()=>{await submit('favorite');await settled();assert.equal(await page.locator('[data-annotation-form="favorite"] button').getAttribute('aria-pressed'),'true');await submit('favorite');await settled();const calls=report.calls.filter(x=>x.method==='asset.annotate');assert.equal(calls.length,2);assert.notEqual(calls[0].payload.operationId,calls[1].payload.operationId);assert.equal(calls[1].result.metadata.favorite,false);});
 await step('Chinese tags save through the real core',async()=>{await tags('建筑, 常用');await settled();assert.deepEqual(report.calls.filter(x=>x.method==='asset.annotate').at(-1).result.metadata.tags,['常用','建筑']);});
 await step('lost committed reply is retried with the original request after switching away and back',async()=>{mode='drop';await tags('已提交');await page.waitForFunction(()=>!!document.querySelector('[data-annotation-form="retry"]'));const first=report.calls.filter(x=>x.method==='asset.annotate').at(-1);await select('asset-b');assert.equal(await page.locator('[data-annotation-form="retry"]').count(),0);await select('asset-a');await submit('retry');await settled();const retry=report.calls.filter(x=>x.method==='asset.annotate').at(-1);assert.deepEqual(retry.payload,first.payload);assert.equal(retry.result.replayed,true);});
 await step('late successful reply cannot replace another selected detail',async()=>{mode='hold';await submit('favorite');const deadline=Date.now()+5000;while(!release){assert(Date.now()<deadline,'HELD_REPLY_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,10));}await select('asset-b');release();release=null;await page.waitForFunction(()=>!document.querySelector('[data-annotation-form="favorite"] button').disabled);assert.equal(await page.locator('[data-annotation-asset]').getAttribute('data-annotation-asset'),'asset-b');assert.equal(await page.locator('[data-annotation-form="favorite"] button').getAttribute('aria-pressed'),'false');});
 await step('UTF-8 tag limits reject locally without an annotation write',async()=>{await select('asset-a');await settled();const count=report.calls.filter(x=>x.method==='asset.annotate').length;await tags('界'.repeat(14));await page.waitForFunction(()=>document.querySelector('[data-annotation-asset]')?.textContent.includes('最多 32 个标签'));assert.equal(report.calls.filter(x=>x.method==='asset.annotate').length,count);});
 await step('empty tags clear metadata without changing source, license, version or worlds',async()=>{await tags('');await settled();assert.deepEqual(report.calls.filter(x=>x.method==='asset.annotate').at(-1).result.metadata.tags,[]);assert.deepEqual(await core.call('asset.read',{assetId:'asset-a',version:1}),before.a);assert.deepEqual(await core.call('asset.versions',{assetId:'asset-a',offset:0,limit:20}),before.versions);assert.deepEqual(await core.call('world.list'),before.worlds);assert.equal(sha(fs.readFileSync(sourcePath)),sha(bytes));});
 report.audit=await page.evaluate(()=>window.audit);assert.deepEqual(report.audit,{focus:0,lock:0});assert.deepEqual(report.errors,[]);
 await page.screenshot({path:path.join(out,'annotations.png')});await browser.close();browser=null;await core.stop();await core.start();
 await step('metadata survives actual core restart',async()=>{const found=await core.call('asset.search',{scope:'local-library',query:'',tags:[],favoritesOnly:true,latestOnly:true,offset:0,limit:20});const row=found.items.find(x=>x.assetId==='asset-a');assert.equal(row.favorite,true);assert.deepEqual(row.tags,[]);assert.equal(row.contentHash,before.a.version_.contentHash);report.after=found;});
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{if(release)release();await browser?.close();await core.stop();report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
