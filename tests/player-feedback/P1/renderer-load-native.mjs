// Fresh authored exports and actual host: no model, player profile, or input.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createGodotProbeEnvironment} from '../../../desktop/godot/toolchain.mjs';
import {materializeBase} from '../../../desktop/godot/shared/materialize.mjs';
const root=process.cwd(),deps=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT;
if(!deps||!path.isAbsolute(deps))throw Error('Explicit dependency root required');
const require=createRequire(path.join(deps,'vendor/pi-desktop/apps/desktop/package.json'));
const {build}=createRequire(path.join(deps,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const electron=require('electron');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/p1-renderer-load-'));
const report={out,startedAt:new Date().toISOString(),sources:{host:hash(fs.readFileSync('vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts')),runtime:hash(fs.readFileSync('desktop/godot/web/runtime.mjs'))},dependencies:deps,limits:['Authored exports, actual host; no Core application transaction or product UI','Hidden owner and software rendering; native child versus offscreen child compared without focus or input'],cases:[]};
const bases=process.env.P1_BASES?.split(',')||['first-person'];
const modes=process.env.P1_MODES?.split(',')||['native','offscreen','unthrottled'];
if(bases.some(x=>!['first-person','top-down','side-view','mining-sandbox'].includes(x))||modes.some(x=>!['native','offscreen','unthrottled','attached','attached-unthrottled'].includes(x)))throw Error('Unknown fixed probe selection');
try{
 const reuse=process.env.P1_REUSE;
 if(reuse&&(!path.isAbsolute(reuse)||!path.resolve(reuse).startsWith(path.resolve(root,'test-results')+path.sep)))throw Error('Reuse must be an owned P1 export under this worktree');
 const env=reuse?null:await createGodotProbeEnvironment(out,{web:true,threads:true});report.engineRuns=env?.runs;report.reusedAuthoredExport=reuse||null;
 for(const baseId of bases){
  const project=path.join(reuse||out,baseId,'project'),exportRoot=path.join(reuse||out,baseId,'export');
  let manifest;
  if(reuse){manifest=JSON.parse(fs.readFileSync(path.join(project,'managed-base.json')));}else{
  fs.mkdirSync(exportRoot,{recursive:true});
  manifest=materializeBase({baseId,worldId:'alpha',template:'blank',out:project});
  fs.copyFileSync('desktop/godot/web/shell.html',path.join(project,'shell.html'));
  fs.writeFileSync(path.join(project,'export_presets.cfg'),`[preset.0]\nname="Web"\nplatform="Web"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\n[preset.0.options]\ncustom_template/release=${JSON.stringify(env.webTemplate.replaceAll('\\','/'))}\nvariant/thread_support=true\nvariant/extensions_support=false\nhtml/custom_html_shell="res://shell.html"\nhtml/focus_canvas_on_start=false\nhtml/canvas_resize_policy=2\nprogressive_web_app/enabled=false\n`);
  await env.run(baseId+'-import',['--path',project,'--editor','--import']);
  await env.run(baseId+'-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});
  fs.copyFileSync('desktop/godot/web/bridge.js',path.join(exportRoot,'bridge.js'));
  }
  const artifacts=fs.readdirSync(exportRoot).map(name=>{const bytes=fs.readFileSync(path.join(exportRoot,name));return {path:name,bytes:bytes.length,sha256:hash(bytes)};});
  const body=JSON.parse(fs.readFileSync(path.join(project,'craftmine_initial_state.json'))).initialProgress;
  const snapshot={format:'craftmine.godot-progress/1',stateVersion:1,baseId,baseVersion:manifest.baseVersion,worldId:'alpha',body};
  for(const mode of modes){
   const dir=path.join(out,baseId,mode),appDir=path.join(dir,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));
   const plugins=[{name:'fixed-headless-view-mode',setup(b){b.onResolve({filter:/\/craftmine-headless$/},()=>({path:'fixed-mode',namespace:'p1'}));b.onLoad({filter:/.*/,namespace:'p1'},()=>({contents:`export const isHeadlessAcceptance=()=>${mode==='offscreen'};`,loader:'js'}));}}];
   for(const [entry,file] of [['tests/player-feedback/P1/renderer-load-main.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,file),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],plugins,logLevel:'warning'});
   fs.copyFileSync('tests/godot-world-view/pointer-guard.cjs',path.join(appDir,'main/pointer-guard.cjs'));fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({main:'main/index.cjs'}));
   const result=path.join(dir,'result.json'),config=path.join(dir,'config.json');fs.writeFileSync(config,JSON.stringify({baseId,mode,exportRoot,artifacts,snapshot,result}));
   const log=fs.createWriteStream(path.join(dir,'electron.log'));
   const proc=spawn(electron,[appDir,'--user-data-dir='+path.join(dir,'profile')],{cwd:dir,windowsHide:true,env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',P1_CONFIG:config},stdio:['ignore','pipe','pipe']});proc.stdout.pipe(log,{end:false});proc.stderr.pipe(log,{end:false});
   const exit=await new Promise(resolve=>{const timer=setTimeout(()=>{proc.kill();},60000);proc.once('error',error=>{clearTimeout(timer);resolve({error:String(error)});});proc.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});
   await new Promise(resolve=>log.end(resolve));
   const actual=fs.existsSync(result)?JSON.parse(fs.readFileSync(result)):null;
   report.cases.push({baseId,mode,result,exit,passed:exit.code===0&&actual?.passed===true,error:actual?.error});
   console.log(JSON.stringify(report.cases.at(-1)));
  }
 }
}catch(error){report.error=String(error.stack||error);}
report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.cases.length===bases.length*modes.length&&report.cases.every(x=>x.passed);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));if(!report.passed)process.exitCode=1;
