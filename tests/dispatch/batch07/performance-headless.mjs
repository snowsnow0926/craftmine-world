// Local reference measurements, never a clean-OS or visible-desktop acceptance.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {playwright,browserOptions} from '../../../app/browser-tools.mjs';
import {compileScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';
import {tree,flower,grass} from '../../../examples/dispatch-d/content.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const bundled=await require('esbuild').build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-telemetry.ts')],platform:'node',format:'esm',bundle:true,write:false});
const {CRAFTMINE_FRAME_SAMPLE_SCRIPT}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const out=fs.mkdtempSync(path.join(root,'desktop/build/batch07/benchmark-'));
const report={format:'craftmine.local-performance/1',status:'running',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),time:new Date().toISOString(),environment:{platform:os.platform(),release:os.release(),arch:os.arch(),node:process.version,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,totalMemoryBytes:os.totalmem()},configuration:{viewport:{width:1200,height:800},warmupMs:1000,windowsPerLoad:3,maxSamplesPerWindow:120,maxWindowMs:3000,headless:true},references:{loadMs:10000,frameP95Ms:50,minimumSamples:90,purpose:'Local investigation references chosen before measurement, not a shipping performance SLA.'},workloads:[],errors:[],limits:['Headless browser on this shared development host; not visible Electron composition or a clean OS.','Animation callback intervals include scheduling and rendering contention; not GPU duration or input latency.','No frame-rate portability claim; CPU/GPU/browser/viewport and concurrent work affect results.','Renderer JS heap is not whole-browser memory. Node RSS is only this benchmark controller.','No real model, input, pointer lock, foregrounding, installer or user profile.']};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const sum=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,...(sorted.length?{minMs:sorted[0],p50Ms:sorted[Math.floor((sorted.length-1)*.5)],p95Ms:sorted[Math.floor((sorted.length-1)*.95)],maxMs:sorted.at(-1),meanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length}:{})};};
const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  if(route==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><body style="margin:0"><iframe style="width:1200px;height:800px;border:0" title="Independent benchmark"></iframe></body>');}
  const file=route==='/game'?path.join(root,'app/game.html'):route==='/runtime.js'?path.join(root,'world-workshop-3d/src/voxel-runtime.js'):path.resolve(root,'.'+decodeURIComponent(route));
  if(!file.startsWith(root)||(!route.startsWith('/app/')&&!['/game','/runtime.js'].includes(route))){res.writeHead(404);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const placed=(make,count)=>Array.from({length:count},(_,i)=>{const value=make();return {...value,id:value.id+'-'+i,position:{x:-36+(i%16)*4.5,y:6,z:-20+Math.floor(i/16)*5}};});
const scenes=[{id:'empty',objects:[]},{id:'flora-48',objects:[...placed(flower,24),...placed(grass,24).map(o=>({...o,position:{...o.position,z:o.position.z+12}}))]},{id:'trees-128',objects:placed(tree,128)}];
let context;
try{
  fs.writeFileSync(path.join(out,'.craftmine-test-profile'),'Independent batch07 headless benchmark.');
  context=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),viewport:report.configuration.viewport});
  await context.addInitScript(()=>{globalThis.__inputAudit={pointerLock:0,focus:0};Element.prototype.requestPointerLock=function(){__inputAudit.pointerLock++;throw Error('INPUT_DISABLED');};window.focus=()=>{__inputAudit.focus++;};HTMLElement.prototype.focus=function(){__inputAudit.focus++;};});
  report.environment.browser=context.browser()?.version();
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  for(const scene of scenes){
    const compiled=compileScene({format:'craftmine.scene/2',title:scene.id,night:false,objects:scene.objects,systems:[]});const build={...compiled,id:'v-'+compiled.hash.slice(0,20)};
    await page.goto(origin);const began=performance.now();
    const loaded=await page.evaluate(({build,snapshot})=>new Promise((resolve,reject)=>{
      const frame=document.querySelector('iframe'),nonce=crypto.randomUUID(),timer=setTimeout(()=>reject(Error('WORLD_LOAD_TIMEOUT')),15000);
      addEventListener('message',event=>{const m=event.data;if(event.source!==frame.contentWindow||m?.nonce!==nonce||m.channel!=='craftmine-game/1')return;if(m.type==='ready')frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'load',build,snapshot,worldId:'benchmark',preview:false},location.origin);if(m.type==='loaded'){clearTimeout(timer);resolve({renderer:m.renderer,version:m.version});}if(m.type==='error'){clearTimeout(timer);reject(Error(m.message));}});
      frame.src='/game#'+nonce;
    }),{build,snapshot:INITIAL_SNAPSHOT});
    const loadMs=performance.now()-began,frame=page.frames().find(frame=>frame.url().includes('/game#'));
    await frame.evaluate(ms=>new Promise(resolve=>setTimeout(resolve,ms)),report.configuration.warmupMs);
    const windows=[];for(let i=0;i<3;i++)windows.push(await frame.evaluate(CRAFTMINE_FRAME_SAMPLE_SCRIPT));
    const measured=sum(windows.flatMap(window=>window.intervals));
    const renderer=await frame.evaluate(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl')||canvas.getContext('webgl2');const extension=gl?.getExtension('WEBGL_debug_renderer_info');return {gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null,jsHeapUsedBytes:performance.memory?.usedJSHeapSize??null,documentHidden:document.hidden,inputAudit:globalThis.__inputAudit};});
    const item={id:scene.id,objects:scene.objects.length,parts:scene.objects.reduce((n,o)=>n+o.parts.length,0),voxels:build.voxels.length,primitives:build.primitives.length,buildHash:build.hash,loadMs,renderer:loaded.renderer,...renderer,frame:measured,windowElapsedMs:windows.map(w=>w.elapsedMs),referenceChecks:{loadWithin:loadMs<=report.references.loadMs,frameP95Within:measured.p95Ms===undefined?null:measured.p95Ms<=report.references.frameP95Ms,sufficientSamples:measured.samples>=report.references.minimumSamples},nodeControllerRssBytes:process.memoryUsage().rss};
    report.workloads.push(item);save();if(renderer.inputAudit.pointerLock||renderer.inputAudit.focus)throw Error('INPUT_GUARD_VIOLATION');console.log(JSON.stringify({load:scene.id,loadMs,frame:measured,referenceChecks:item.referenceChecks}));
  }
  if(report.errors.length)throw Error('PAGE_ERRORS');report.status='measured';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;}
finally{await context?.close();await new Promise(resolve=>server.close(resolve));report.elapsedMs=performance.now();report.sourceHashes=Object.fromEntries(['app/game.js','world-workshop-3d/src/voxel-runtime.js','vendor/pi-desktop/apps/desktop/electron/main/craftmine-telemetry.ts'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));save();console.log('Performance report: '+path.join(out,'report.json'));}
