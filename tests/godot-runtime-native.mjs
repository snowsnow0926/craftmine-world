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
const electron=require('electron');
const basesRoot=process.env.CRAFTMINE_MANAGED_BASE_ROOT||root;
const {materializeBase}=await import(pathToFileURL(path.join(basesRoot,'desktop/godot/shared/materialize.mjs')));
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/godot-runtime-native-'));
const report={kind:'real-electron-managed-godot-rust-persistence',out,checks:[],limits:['Repository-authored base and test-only executor/application registration; no model or OS sandbox claim','Production index.ts wiring is compile-checked separately; this harness constructs the same classes','Software offscreen rendering; no player input or feel acceptance']};
const check=(name,ok)=>{report.checks.push({name,passed:!!ok});assert.ok(ok,name);console.log('PASS '+name);};
let child,completed=false;
try{
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});
 const project=path.join(out,'project'),exportRoot=path.join(out,'export');fs.mkdirSync(exportRoot);
 materializeBase({baseId:'first-person',worldId:'alpha',template:'training-range',out:project});
 fs.copyFileSync('desktop/godot/web/shell.html',path.join(project,'shell.html'));
 fs.writeFileSync(path.join(project,'export_presets.cfg'),`[preset.0]\nname="Web"\nplatform="Web"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\n[preset.0.options]\ncustom_template/release=${JSON.stringify(env.webTemplate.replaceAll('\\','/'))}\nvariant/thread_support=true\nvariant/extensions_support=false\nhtml/custom_html_shell="res://shell.html"\nhtml/focus_canvas_on_start=false\nhtml/canvas_resize_policy=2\nprogressive_web_app/enabled=false\n`);
 await env.run('managed-import',['--path',project,'--editor','--import']);await env.run('managed-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});fs.copyFileSync('desktop/godot/web/bridge.js',path.join(exportRoot,'bridge.js'));
 const appDir=path.join(out,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));
 for(const [entry,destination] of [['tests/godot-world-view/persistent-main.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,destination),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
 for(const f of ['panel.html','pointer-guard.cjs'])fs.copyFileSync('tests/godot-world-view/'+f,path.join(appDir,'main',f));fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({main:'main/index.cjs'}));
 function launch(label){
  const proc=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'electron-'+label)],{cwd:out,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_NATIVE_OUT:out,CRAFTMINE_NATIVE_EXPORT:exportRoot}});
  const log=fs.createWriteStream(path.join(out,label+'.log'));proc.stdout.pipe(log,{end:false});proc.stderr.pipe(log,{end:false});
  const pending=new Map();let resolveReady,rejectReady;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});const readyTimer=setTimeout(()=>rejectReady(Error('Native startup timeout')),30000);
  const exit=new Promise(resolve=>{proc.once('exit',(code,signal)=>{clearTimeout(readyTimer);log.end();rejectReady(Error('Native exited'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Native exited'));}pending.clear();resolve({code,signal});});proc.once('error',error=>{clearTimeout(readyTimer);rejectReady(error);resolve({error:String(error)});});});
  proc.on('message',m=>{if(m?.kind==='ready'){clearTimeout(readyTimer);resolveReady();}if(m?.kind==='fatal')rejectReady(Error(m.error));if(m?.kind==='native'){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
  const call=(method,payload)=>new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native RPC timeout: '+method));},120000);pending.set(id,{resolve,reject,timer});proc.send({kind:'native',id,method,payload});});
  return {ready,call,exit,async stop(){if(proc.exitCode!==null)return;await call('close').catch(()=>{});await exit;},kill(){proc.kill();}};
 }
 child=launch('first');await child.ready;const initial=await child.call('bootstrap');check('Real Web runtime initial state registered into actual Rust applied artifact',initial.format==='craftmine.godot-progress/1');await child.call('open');
 const before=await child.call('snapshot');await child.call('equip');const after=await child.call('snapshot');check('Native base operation changes complete equipment state',JSON.stringify(before.state)!==JSON.stringify(after.state));
 const save=await child.call('save');check('Real Godot receipt commits through real Rust',save.status==='persisted'&&save.receipt.format==='craftmine.godot-progress-receipt/1');
 const image=await child.call('inspect');check('Separate isolated Electron view renders without Node or input',image.isolation.isolated&&image.isolation.node==='undefined'&&image.width>0&&Object.values(image.guardCounts).every(x=>x===0));
 check('Checks surface detaches native sibling',await child.call('surface',false)===0);check('World surface reattaches native sibling',await child.call('surface',true)===1);
 await child.call('failSave',true);await assert.rejects(child.call('depart'),/TEST_STORAGE_FAILURE|durable storage/);const blocked=await child.call('quitCheck');check('Storage failure blocks world departure and quit',!blocked.ok);await child.call('failSave',false);
 const persisted=await child.call('save');await child.stop();child=launch('restart');await child.ready;await child.call('open');const restored=await child.call('snapshot');assert.deepEqual(restored.state,persisted.snapshot);check('Full equipment/world state survives real Electron and Rust restart',true);
 const quit=await child.call('quitCheck');check('Confirmed durable checkpoint permits runtime exit',quit.ok);await child.stop();child=null;completed=true;
}catch(error){report.failure=String(error?.stack||error);throw error;
}finally{if(child)await child.stop().catch(()=>child.kill());report.passed=completed;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.checks.filter(c=>c.passed).length,completed}));}
