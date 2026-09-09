// Repository-authored managed bases, real Godot Web + Electron + Rust.
// Controlled runtime messages only: no OS input, focus, Pointer Lock or model claims.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const root=process.cwd(),dependencies=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const require=createRequire(path.join(dependencies,'vendor/pi-desktop/apps/desktop/package.json'));
const {build}=createRequire(path.join(dependencies,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const electron=process.env.CRAFTMINE_ELECTRON_BIN||require('electron');
const basesRoot=process.env.CRAFTMINE_MANAGED_BASE_ROOT||root;
const hostFile=path.join(process.env.CRAFTMINE_GODOT_HOST_ROOT||root,'vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts');
const hostPlugin={name:'explicit-native-host',setup(build){build.onResolve({filter:/godot-world-view-host$/},()=>({path:hostFile}));}};
const hashFile=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const {materializeBase}=await import(pathToFileURL(path.join(basesRoot,'desktop/godot/shared/materialize.mjs')));
const configs={'first-person':{template:'training-range'},'top-down':{template:'town'},'side-view':{template:'ruins'}};
const selection=process.argv.indexOf('--base');
const baseIds=selection<0?Object.keys(configs):[process.argv[selection+1]];
if(baseIds.some(id=>!Object.hasOwn(configs,id)))throw Error('Unknown --base');
fs.mkdirSync('test-results',{recursive:true});const runRoot=fs.mkdtempSync(path.resolve('test-results/godot-runtime-native-'));
const report={kind:'real-electron-managed-godot-rust-persistence',out:runRoot,checks:[],observations:{},limits:['Fixed repository-authored projects with test-only executor/application registration; no model or OS sandbox claim','Production main wiring is compile-checked separately; the fixture constructs the production host and adapter','Software offscreen rendering; no user input or player-feel acceptance']};
report.sources={host:{path:hostFile,sha256:hashFile(hostFile)},basesRoot,core:process.env.CRAFTMINE_CORE_BIN?{path:process.env.CRAFTMINE_CORE_BIN,sha256:hashFile(process.env.CRAFTMINE_CORE_BIN)}:null};
let child,completed=false,baseId='';
const check=(name,ok)=>{report.checks.push({baseId,name,passed:!!ok});assert.ok(ok,name);console.log('PASS ['+baseId+'] '+name);};
try{
 const env=await createGodotProbeEnvironment(runRoot,{web:true,threads:true});report.engineRuns=env.runs;
 for(baseId of baseIds){
 const config=configs[baseId],out=path.join(runRoot,baseId);fs.mkdirSync(out);
 const observations=report.observations[baseId]={commands:[]};
 const project=path.join(out,'project'),exportRoot=path.join(out,'export');fs.mkdirSync(exportRoot);
 materializeBase({baseId,worldId:'alpha',template:config.template,out:project});
 fs.copyFileSync('desktop/godot/web/shell.html',path.join(project,'shell.html'));
 fs.writeFileSync(path.join(project,'export_presets.cfg'),`[preset.0]\nname="Web"\nplatform="Web"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\n[preset.0.options]\ncustom_template/release=${JSON.stringify(env.webTemplate.replaceAll('\\','/'))}\nvariant/thread_support=true\nvariant/extensions_support=false\nhtml/custom_html_shell="res://shell.html"\nhtml/focus_canvas_on_start=false\nhtml/canvas_resize_policy=2\nprogressive_web_app/enabled=false\n`);
 await env.run(baseId+'-managed-import',['--path',project,'--editor','--import']);await env.run(baseId+'-managed-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});fs.copyFileSync('desktop/godot/web/bridge.js',path.join(exportRoot,'bridge.js'));
 const appDir=path.join(out,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));
 for(const [entry,destination] of [['tests/godot-world-view/persistent-main.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,destination),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],plugins:[hostPlugin],logLevel:'warning'});
 for(const f of ['panel.html','pointer-guard.cjs'])fs.copyFileSync('tests/godot-world-view/'+f,path.join(appDir,'main',f));fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({main:'main/index.cjs'}));
 function launch(label){
  const proc=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'electron-'+label)],{cwd:out,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_NATIVE_OUT:out,CRAFTMINE_NATIVE_BASE_ID:baseId,CRAFTMINE_NATIVE_EXPORT:exportRoot}});
  const log=fs.createWriteStream(path.join(out,label+'.log'));proc.stdout.pipe(log,{end:false});proc.stderr.pipe(log,{end:false});
  const pending=new Map();let resolveReady,rejectReady;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});const readyTimer=setTimeout(()=>rejectReady(Error('Native startup timeout')),30000);
  const exit=new Promise(resolve=>{proc.once('exit',(code,signal)=>{clearTimeout(readyTimer);log.end();rejectReady(Error('Native exited'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Native exited'));}pending.clear();resolve({code,signal});});proc.once('error',error=>{clearTimeout(readyTimer);rejectReady(error);resolve({error:String(error)});});});
  proc.on('message',m=>{if(m?.kind==='ready'){clearTimeout(readyTimer);resolveReady();}if(m?.kind==='fatal')rejectReady(Error(m.error));if(m?.kind==='native'){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
  const call=(method,payload)=>new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native RPC timeout: '+method));},120000);pending.set(id,{resolve,reject,timer});proc.send({kind:'native',id,method,payload});});
  return {ready,call,exit,async stop(){if(proc.exitCode!==null)return;await call('close').catch(()=>{});await exit;},kill(){proc.kill();}};
 }
 child=launch('first');await child.ready;
 const initial=await child.call('bootstrap');observations.initial=initial;
 check('Real Web initial state registers into actual Rust applied artifact',initial.format==='craftmine.godot-progress/1'&&initial.baseId===baseId);
 await child.call('open');
 const command=async(op,args={})=>{try{const value=await child.call('request',{op,args});observations.commands.push({op,args,result:value});return value;}catch(error){observations.commands.push({op,args,error:String(error)});throw error;}};
 const before=await child.call('snapshot');observations.before=before;
 if(baseId==='first-person'){
  await child.call('equip');const after=await child.call('snapshot');
  check('Actual equipment operation changes native state',before.state.body.equipment.active==='pistol'&&after.state.body.equipment.active==='practice_sword');
 }else if(baseId==='top-down'){
  await assert.rejects(command('gather',{zoneId:'zone-herb-patch'}),/out_of_range/);
  await assert.rejects(command('set-position',{x:96,y:248}),/Unsupported/);
  await command('move',{dx:0,dy:1,steps:55});
  const patch=await command('observe');
  check('Real walking reaches the herb patch without a position setter',patch.physical.overlaps['zone-herb-patch']===true);
  for(let i=0;i<3;i++)await command('gather',{zoneId:'zone-herb-patch'});
  await command('move',{dx:0,dy:-1,steps:55});await command('move',{dx:1,dy:0,steps:65});
  await command('deliver',{npcId:'npc-mira',questId:'herb-delivery'});
  await assert.rejects(command('deliver',{npcId:'npc-mira',questId:'herb-delivery'}),/already_rewarded/);
  const quest=await child.call('snapshot');
  check('Real gathering and delivery consume items and grant the quest reward once',quest.state.body.quests['herb-delivery'].rewarded&&quest.state.body.grantedRewards['herb-delivery#reward']&&quest.state.body.flags['zone.herb-patch.gathered']===3&&!quest.state.body.inventory.herb);
  await command('move',{dx:1,dy:0,steps:180});await command('move',{dx:0,dy:-1,steps:32});
  const entered=await child.call('snapshot');check('Real doorway overlap enters the shop scene',entered.state.body.player.sceneId==='shop-interior');
  await assert.rejects(command('buy',{shopId:'shop-general',itemId:'bread'}),/out_of_range/);
  await command('move',{dx:0,dy:-1,steps:38});await command('buy',{shopId:'shop-general',itemId:'bread'});await command('move',{dx:-1,dy:0,steps:8});
  const shopping=await child.call('snapshot');observations.played=shopping;
  check('Real shop purchase preserves price, stock, backpack, quest and non-entry facing',shopping.state.body.coins===64&&shopping.state.body.inventory.bread===1&&shopping.state.body.inventory.apple===1&&shopping.state.body.shops.general.stock.bread===2&&shopping.state.body.player.facing==='left'&&shopping.state.body.player.sceneId==='shop-interior');
 }else{
  const travel=[];for(let i=0;i<5;i++)travel.push({ticks:15,move:1,jump:true},{ticks:15,move:1});travel.push({ticks:150});
  await command('control',{segments:travel});const room=await command('observe');
  check('Real virtual controls cross the spike pit and enter ruins',room.roomId==='ruins');
  await command('control',{segments:[{ticks:10,move:1},{ticks:15,move:1,jump:true},{ticks:275,move:1},{ticks:120}]});
  const ability=await child.call('snapshot');check('Real jump and pickup unlock double jump',ability.state.body.abilities.double_jump===true);
  const observed=await command('observe');const desiredX=590;const moveTicks=Math.max(1,Math.round(Math.abs(observed.player.x-desiredX)/(260/60)));
  await command('control',{segments:[{ticks:moveTicks,move:observed.player.x>desiredX?-1:1},{ticks:35}]});
  await command('control',{segments:[{ticks:1,move:-1},{ticks:1,attack:true},{ticks:60}]});
  const hit=await command('observe'),state=await child.call('snapshot');observations.played=state;
  check('Real attack overlap damages the live target and native entity ledger',hit.targets.find(t=>t.id==='dummy_ruins')?.health===1&&state.state.body.entities.dummy_ruins.health===1&&state.state.body.counters.hits===1);
  await assert.rejects(command('control',{segments:[{ticks:601,move:1}]}),/600/);
 }
 await child.call('pause');const checkpoint=await child.call('snapshot');
 for(const mutate of [s=>s.worldId='foreign',s=>s.body.worldId='foreign',s=>s.stateVersion=99,s=>s.body.player='invalid']){
  const invalid=structuredClone(checkpoint.state);mutate(invalid);await assert.rejects(command('restore-state',{state:invalid}));assert.deepEqual((await child.call('snapshot')).state,checkpoint.state);
 }
 check('Foreign and malformed snapshots reject without partial changes',true);
 const save=await child.call('save');observations.saved=save;
 check('Real Godot receipt commits through real Rust',save.status==='persisted'&&save.receipt.format==='craftmine.godot-progress-receipt/1');
 const image=await child.call('inspect',{sampleColors:baseId==='side-view'?[[92,199,245]]:[]});observations.image=image;
 const diagnostics=image.consoleMessages.filter(x=>/SCRIPT ERROR|Parse Error|ERROR:/.test(x.message));check('Runtime rendered without Godot errors',diagnostics.length===0);
 check('Separate isolated Electron view has nonempty rendered pixels and zero input',image.isolation.isolated&&image.isolation.node==='undefined'&&image.isolation.statusHidden===true&&image.width>0&&image.height>0&&image.pixels.colors>=6&&image.pixels.nonDominant>100&&Object.values(image.guardCounts).every(x=>x===0));
 if(baseId==='side-view')check('The living player is actually visible in rendered pixels',image.pixels.colorCounts[0]>100);
 check('Checks surface detaches native sibling',await child.call('surface',false)===0);check('World surface reattaches native sibling',await child.call('surface',true)===1);
 await child.call('failSave',true);await assert.rejects(child.call('depart'),/TEST_STORAGE_FAILURE|durable storage/);const blocked=await child.call('quitCheck');
 check('Storage failure blocks world departure and quit',!blocked.ok);await child.call('failSave',false);await child.call('pause');
 assert.deepEqual((await child.call('snapshot')).state,checkpoint.state);check('Failed persistence retains the complete current state',true);
 const persisted=await child.call('save');await child.stop();child=launch('restart');await child.ready;await child.call('open');await child.call('pause');const restored=await child.call('snapshot');observations.restored=restored;
 assert.deepEqual(restored.state,persisted.snapshot);check('Every native state field survives complete Electron and Rust restart',true);
 const quit=await child.call('quitCheck');check('Confirmed durable checkpoint permits runtime exit',quit.ok);await child.stop();child=null;
 fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify(observations,null,2));
 }
 completed=true;
}catch(error){report.failure=String(error?.stack||error);throw error;
}finally{if(child)await child.stop().catch(()=>child.kill());report.passed=completed;fs.writeFileSync(path.join(runRoot,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out:runRoot,passed:report.checks.filter(c=>c.passed).length,completed}));}
