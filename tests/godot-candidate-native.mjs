// Fixed repository-authored managed base only. No model-authored build execution.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const root=process.cwd(),dependencies=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const require=createRequire(path.join(dependencies,'vendor/pi-desktop/apps/desktop/package.json'));
const {build}=createRequire(path.join(dependencies,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const electron=process.env.CRAFTMINE_ELECTRON_BIN||require('electron');
const suppliedExport=process.env.CRAFTMINE_CANDIDATE_EXPORT;if(!suppliedExport||!path.isAbsolute(suppliedExport))throw Error('CRAFTMINE_CANDIDATE_EXPORT must name this-cycle fixed E export');
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/godot-candidate-native-'));
const report={kind:'real-electron-godot-candidate-coordination',out,checks:[],limits:['Repository-authored base and test-only executor/application registration; no model or OS sandbox claim','Production index.ts wiring is compile-checked separately; this harness constructs the same classes','Software offscreen rendering; no player input or feel acceptance']};
const check=(name,ok)=>{report.checks.push({name,passed:!!ok});assert.ok(ok,name);console.log('PASS '+name);};
let child,completed=false;
try{
 const exportRoot=path.join(out,'export');fs.cpSync(suppliedExport,exportRoot,{recursive:true});
 const appDir=path.join(out,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));
 for(const [entry,destination] of [['tests/godot-candidate-native/main.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,destination),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
 for(const f of ['panel.html','pointer-guard.cjs'])fs.copyFileSync('tests/godot-world-view/'+f,path.join(appDir,'main',f));fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({main:'main/index.cjs'}));
 function launch(label){
  const proc=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'electron-'+label)],{cwd:out,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_NATIVE_OUT:out,CRAFTMINE_NATIVE_EXPORT:exportRoot}});
  const log=fs.createWriteStream(path.join(out,label+'.log'));proc.stdout.pipe(log,{end:false});proc.stderr.pipe(log,{end:false});
  const pending=new Map();let resolveReady,rejectReady;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});const readyTimer=setTimeout(()=>rejectReady(Error('Native startup timeout')),30000);
  const exit=new Promise(resolve=>{proc.once('exit',(code,signal)=>{clearTimeout(readyTimer);log.end();rejectReady(Error('Native exited'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Native exited'));}pending.clear();resolve({code,signal});});proc.once('error',error=>{clearTimeout(readyTimer);rejectReady(error);resolve({error:String(error)});});});
  proc.on('message',m=>{if(m?.kind==='ready'){clearTimeout(readyTimer);resolveReady();}if(m?.kind==='fatal')rejectReady(Error(m.error));if(m?.kind==='native'){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
  const call=(method,payload)=>new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native RPC timeout: '+method));},120000);pending.set(id,{resolve,reject,timer});proc.send({kind:'native',id,method,payload});});
  return {ready,call,exit,async stop(){if(proc.exitCode!==null)return;let timer;try{await Promise.race([call('close').catch(()=>{}).then(()=>exit),new Promise(resolve=>timer=setTimeout(()=>{proc.kill();resolve();},5000))]);}finally{clearTimeout(timer);}},kill(){proc.kill();}};
 }
 child=launch('first');await child.ready;await child.call('bootstrap');await child.call('open');
 const original=await child.call('identities'),durableBefore=await child.call('formal');
 await child.call('preview');await child.call('candidateEquip');const preview=await child.call('candidateSnapshot');const stillFormal=await child.call('formal');assert.deepEqual(stillFormal,durableBefore);
 check('Real candidate preview mutation never changes formal Rust progress',preview.state.body!==undefined);
 const shown=await child.call('inspect');check('Candidate isolated view renders without input or Node',shown.isolation.isolated&&shown.isolation.node==='undefined'&&Object.values(shown.guardCounts).every(x=>x===0));
 await child.call('cancelPreview');const cancelled=await child.call('identities');check('Cancel keeps exact original native instance',cancelled.formal.instanceId===original.formal.instanceId&&cancelled.candidate===null);
 await child.call('equip');const latest=await child.call('snapshot');await child.call('preview');await child.call('failSave',true);await assert.rejects(child.call('apply'),/durable storage failure/);check('Storage failure keeps original native instance',(await child.call('identities')).formal.instanceId===original.formal.instanceId);await child.call('failSave',false);
 await child.call('preview');await child.call('loseCommit');const applied=await child.call('apply');assert.deepEqual(applied.record.world.snapshot,latest.state);
 const identities=await child.call('identities');check('Real application preserves latest formal state using a fresh candidate instance',applied.status==='applied'&&identities.formal.instanceId!==original.formal.instanceId&&identities.candidate===null);
 check('Actual committed reply loss reconciles without replay',identities.commitCalls===1);
 const buildId=applied.record.world.build.id;await child.stop();child=launch('restart');await child.ready;await child.call('open');const restarted=await child.call('snapshot'),formal=await child.call('formal');assert.deepEqual(restarted.state,latest.state);check('New formal build and complete progress survive Electron and Rust restart',formal.world.build.id===buildId);
 await child.stop();child=null;completed=true;
}catch(error){report.failure=String(error.stack||error);throw error;}finally{if(child)await child.stop().catch(()=>child.kill());report.passed=completed;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.checks.filter(c=>c.passed).length,completed}));}
