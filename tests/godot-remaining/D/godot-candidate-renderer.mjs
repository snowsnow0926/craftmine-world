// Real Electron + real Godot Web export candidate staging lifecycle.
// No Rust core, no model, no page input, no window activation, no pointer lock.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),dependencies=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const require=createRequire(path.join(dependencies,'vendor/pi-desktop/apps/desktop/package.json'));
const {build}=createRequire(path.join(dependencies,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const electron=process.env.CRAFTMINE_ELECTRON_BIN||require('electron');
const suppliedExport=process.env.CRAFTMINE_RENDERER_EXPORT;if(!suppliedExport||!path.isAbsolute(suppliedExport))throw Error('CRAFTMINE_RENDERER_EXPORT must name the fixed Web export');
const cycles=Number(process.env.CRAFTMINE_RENDERER_CYCLES||3);
fs.mkdirSync('test-results',{recursive:true});
const out=fs.mkdtempSync(path.resolve('test-results/godot-candidate-renderer-'));
const report={kind:'real-electron-godot-candidate-renderer-lifecycle',out,checks:[],limits:['Fixed repository-owned Web export; software offscreen rendering','Host class only: no Rust application transaction, no model, no player input or feel']};
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,...(detail===undefined?{}:{detail})});assert.ok(ok,name);console.log('PASS '+name);};
let child,completed=false;
try{
  const exportRoot=path.join(out,'export');fs.cpSync(suppliedExport,exportRoot,{recursive:true});
  const appDir=path.join(out,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));
  for(const [entry,destination] of [['tests/godot-remaining/D/godot-candidate-renderer/main.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,destination),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
  for(const f of ['panel.html','pointer-guard.cjs'])fs.copyFileSync('tests/godot-world-view/'+f,path.join(appDir,'main',f));
  fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({main:'main/index.cjs'}));
  const proc=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'electron-profile')],{cwd:out,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_RENDERER_OUT:out,CRAFTMINE_RENDERER_EXPORT:exportRoot}});
  const log=fs.createWriteStream(path.join(out,'electron.log'));proc.stdout.pipe(log,{end:false});proc.stderr.pipe(log,{end:false});
  const pending=new Map();let resolveReady,rejectReady;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});const readyTimer=setTimeout(()=>rejectReady(Error('Renderer harness startup timeout')),60000);
  const exit=new Promise(resolve=>{proc.once('exit',(code,signal)=>{clearTimeout(readyTimer);log.end();rejectReady(Error('Renderer harness exited'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Renderer harness exited'));}pending.clear();resolve({code,signal});});proc.once('error',error=>{clearTimeout(readyTimer);rejectReady(error);resolve({error:String(error)});});});
  proc.on('message',m=>{if(m?.kind==='ready'){clearTimeout(readyTimer);resolveReady();}if(m?.kind==='fatal')rejectReady(Error(m.error));if(m?.kind==='native'){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
  const call=(method,payload)=>new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error('Renderer RPC timeout: '+method));},180000);pending.set(id,{resolve,reject,timer});proc.send({kind:'native',id,method,payload});});
  child={call,ready,exit,async stop(){if(proc.exitCode!==null)return;let timer;try{await Promise.race([call('close').catch(()=>{}).then(()=>exit),new Promise(resolve=>timer=setTimeout(()=>{proc.kill();resolve();},8000))]);}finally{clearTimeout(timer);}},kill(){proc.kill();}};
  await child.ready;
  const opened=await child.call('open');
  check('Formal world runtime reaches ready',opened.state.state==='ready',opened.state);
  const formalInstance=opened.instance.instanceId;
  const formalBounds=await child.call('bounds');
  check('Formal game surface is inset by the panel chrome inside the measured bounds',
    formalBounds.views.length===1&&formalBounds.views[0].attached&&formalBounds.views[0].bounds.width===1200&&formalBounds.views[0].bounds.height===724&&formalBounds.views[0].bounds.y===76,formalBounds);
  for(let cycle=1;cycle<=cycles;cycle++){
    const staged=await child.call('stage');
    check(`Candidate ${cycle} stages an independent instance and reaches ready`,staged.state.state==='paused'&&!!staged.instance&&staged.instance.instanceId!==formalInstance,staged);
    const stagedBounds=await child.call('bounds');
    check(`Candidate ${cycle} keeps nonzero detached bounds and never covers the formal view`,
      stagedBounds.views.length===cycle+1&&stagedBounds.views[cycle].attached===false&&stagedBounds.views[cycle].bounds.width>0&&stagedBounds.views[cycle].bounds.height>0&&stagedBounds.children===1,stagedBounds);
    const discarded=await child.call('discard');
    check(`Candidate ${cycle} discard keeps the original formal instance`,discarded.instance.instanceId===formalInstance&&discarded.candidate===null,discarded);
  }
  const hidden=await child.call('surface',false);
  const shown=await child.call('surface',true);
  check('Hiding the creation surface detaches the native view and showing it reattaches',
    hidden.children===0&&shown.children===1,{hidden,shown});
  await child.call('stageBegin');
  const crashed=await child.call('stageCrash');
  const settled=await child.call('stageSettle');
  check('A real renderer crash during candidate startup fails fast with the renderer cause',
    crashed.crashed===true&&crashed.starting===true&&settled.ok===false&&/World renderer stopped/.test(settled.error)&&/fault=render-process-gone/.test(settled.error),{crashed,settled});
  const afterCrash=await child.call('identities');
  check('A crashed candidate leaves the original formal instance running',afterCrash.formal.instanceId===formalInstance&&afterCrash.candidate===null,afterCrash);
  const diagnostics=await child.call('diagnostics');
  const fatal=diagnostics.diagnostics.filter(entry=>['load-failed','renderer-gone'].includes(entry.kind));
  const webgl=diagnostics.diagnostics.filter(entry=>entry.kind==='renderer-console'&&/GL_INVALID_FRAMEBUFFER_OPERATION|Framebuffer is incomplete/.test(entry.message));
  report.webglWarnings=webgl.length;
  check('Renderer diagnostics name the crashed candidate instance',!!diagnostics.host&&diagnostics.host.instanceId===formalInstance,diagnostics.host);
  check('No pointer lock or window focus request was granted',Object.values(diagnostics.guardCounts).every(x=>x===0),diagnostics.guardCounts);
  report.rendererFaults=fatal;
  fs.writeFileSync(path.join(out,'diagnostics.json'),JSON.stringify(diagnostics,null,2));
  await child.stop();child=null;completed=true;
}catch(error){
  report.failure=String(error.stack||error);
  try{if(child)report.diagnostics=await child.call('diagnostics');}catch{}
  throw error;
}finally{
  if(child)await child.stop().catch(()=>child.kill());
  report.passed=completed;report.passedChecks=report.checks.filter(c=>c.passed).length;
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({out,passed:report.passedChecks,completed}));
}
