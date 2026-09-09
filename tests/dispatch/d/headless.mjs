import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {playwright,browserOptions} from '../../../app/browser-tools.mjs';
import {compileScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';
import {GameplaySession} from '../../../app/gameplay.mjs';
import {materializeCreation} from '../../../app/creation.mjs';
import {runSelfTests} from '../../../app/harness/extension-loader.mjs';
import {sandboxRunner} from '../../../app/harness/extension-sandbox-browser.mjs';
import {packages} from '../../../examples/dispatch-d/build-packages.mjs';
import {trainingScene,drainExtension,part} from '../../../examples/dispatch-d/content.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/dispatch-d-'));
const report={kind:'headless-actual-game-and-workers',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceFiles:{},profile:path.join(out,'profile'),checks:[],errors:[],traces:[]};
for(const file of ['app/game.js','app/world-runtime.mjs','app/gameplay.mjs','app/behavior-session.mjs','app/behavior-state.mjs','app/behavior-binding.mjs','app/extension-runtime.mjs','app/preview-probe.mjs','app/request-plan.mjs','app/harness/extension-loader.mjs'])report.sourceFiles[file]=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(name,value,detail=null)=>{report.checks.push({name,passed:!!value,detail});save();assert.ok(value,name);console.log('PASS '+name);};
const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  if(route==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><body style="margin:0"><script>window.results=[];</script></body></html>');}
  let file=route==='/game'?path.join(root,'app/game.html'):route==='/runtime.js'?path.join(root,'world-workshop-3d/src/voxel-runtime.js'):path.resolve(root,'.'+decodeURIComponent(route));
  if(!file.startsWith(root)||(!route.startsWith('/app/')&&!['/game','/runtime.js'].includes(route))){res.writeHead(404);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let context,page;
const built=scene=>{const build=compileScene(scene,{extensions:new Set(['ext:training-drain@1'])});return {...build,id:'build-'+build.hash.slice(0,20)};};
const extensions=[drainExtension()];
async function load(build,snapshot=INITIAL_SNAPSHOT,{preview=true,worldId='dispatch-d-world'}={}){
  return page.evaluate(async input=>{
    if(window.receive)removeEventListener('message',window.receive);document.querySelector('iframe')?.remove();
    const frame=document.createElement('iframe');frame.style='border:0;width:1200px;height:800px';frame.title='Isolated game acceptance';document.body.append(frame);
    const nonce=crypto.randomUUID();window.frame=frame;window.nonce=nonce;window.pending=new Map();window.selections=[];
    const loaded=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('load timed out')),12000);
      window.receive=event=>{
        const m=event.data;if(event.source!==frame.contentWindow||m?.nonce!==nonce||m?.channel!=='craftmine-game/1')return;
        if(m.type==='ready')frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'load',...input,paused:true},location.origin);
        if(m.type==='loaded'){clearTimeout(timer);resolve(m);}
        if(m.type==='selection')window.selections.push(m);
        if(m.type==='error'&&!m.requestId){clearTimeout(timer);reject(Error(m.message));}
        const pending=window.pending.get(m.requestId);if(pending){clearTimeout(pending.timer);window.pending.delete(m.requestId);m.type==='error'?pending.reject(Error(m.message)):pending.resolve(m);}
      };addEventListener('message',window.receive);
    });
    frame.src='/game#'+nonce;return loaded;
  },{build,snapshot,extensions,preview,worldId});
}
async function request(type,payload={}){return page.evaluate(({type,payload})=>new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID(),timer=setTimeout(()=>reject(Error('request timed out')),10000);window.pending.set(requestId,{resolve,reject,timer});
  window.frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce:window.nonce,type,requestId,...payload},location.origin);
}),{type,payload});}
async function step(label,event,dt=0,player){const result=await request('request-step',{step:{label,event,dt,...(player?{player}:{})}});report.traces.push(result.observation);save();return result.observation;}
try{
  fs.writeFileSync(path.join(out,'.craftmine-test-profile'),'dispatch-d headless; no personal data');
  context=await playwright().chromium.launchPersistentContext(report.profile,{...browserOptions(),viewport:{width:1200,height:800}});
  await context.addInitScript(()=>{
    window.__audit={pointerLock:0,focus:0};Element.prototype.requestPointerLock=function(){window.__audit.pointerLock++;throw Error('Input lock disabled');};
    window.focus=()=>{window.__audit.focus++;};HTMLElement.prototype.focus=function(){window.__audit.focus++;};
  });
  page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(origin);
  const scene=trainingScene(),build=built(scene);
  const loaded=await load(build);check('real worker startup creates exactly one inventory reward',loaded.snapshot.behaviors.inventory['training-token']===1);
  const flora=build.primitives.filter(p=>['wild-flower','thin-grass'].includes(p.id));
  check('flower and grass have thin geometry at y=6 with no collision',flora.every(p=>!p.solid&&p.min.y>=6)&&flora.some(p=>p.shape==='blade')&&flora.filter(p=>p.id==='wild-flower').some(p=>Math.abs(p.max.x-p.min.x-.05)<.001));
  await page.locator('iframe').evaluate(frame=>{frame.style.height='800px';});
  await page.screenshot({path:path.join(out,'garden.png')});
  let trace=await step('ranged-hit',{type:'attack'},0,{x:.35,y:6,z:9,yaw:0,pitch:0});
  check('actual raycast hit deals damage and consumes ammo',trace.after.objects.find(o=>o.id==='training-target').health===40&&trace.after.gameplay.systems['ranged-system'].ammo===2);
  trace=await step('cooldown-denied',{type:'attack'});check('cooldown stops repeated attack',trace.after.objects.find(o=>o.id==='training-target').health===40&&trace.after.gameplay.systems['ranged-system'].ammo===2);
  trace=await step('miss',{type:'attack'},.2,{x:3,y:6,z:9,yaw:0,pitch:0});check('ray miss consumes ammo without damage',trace.after.objects.find(o=>o.id==='training-target').health===40&&trace.after.gameplay.systems['ranged-system'].ammo===1);
  await step('second-hit',{type:'attack'},.2,{x:.35,y:6,z:9,yaw:0,pitch:0});
  trace=await step('empty-magazine',{type:'attack'},.2);check('empty magazine cannot damage',trace.after.objects.find(o=>o.id==='training-target').health===20&&trace.after.gameplay.systems['ranged-system'].ammo===0);
  trace=await step('reload',{type:'reload'});check('reload really starts',trace.after.gameplay.systems['ranged-system'].reloadRemaining===.4);
  const midway=(await request('snapshot',{freeze:true})).snapshot;await load(build,midway);
  trace=await step('reload-survives',{type:'attack'});check('restart preserves reload and does not repeat startup reward',trace.after.gameplay.systems['ranged-system'].ammo===0&&trace.after.inventory['training-token']===1);
  trace=await step('reload-complete-and-kill',{type:'attack'},.4);
  check('reload completes, actual kill removes mesh and grants reward once',trace.after.objects.find(o=>o.id==='training-target').health===0&&!trace.after.objects.find(o=>o.id==='training-target').mesh&&trace.after.inventory['training-token']===2);
  const killed=(await request('snapshot',{freeze:true})).snapshot;await load(build,killed);
  trace=await step('no-repeat-reward',{type:'tick'},.1);check('death inventory and reward survive restart',trace.after.inventory['training-token']===2&&trace.after.objects.find(o=>o.id==='training-target').health===0);
  await load(build);await step('equip-melee',{type:'equip',weapon:'melee'});
  trace=await step('melee-out-of-range',{type:'attack'},0,{x:.35,y:6,z:10,yaw:0,pitch:0});check('melee out of range does not hit',trace.after.objects.find(o=>o.id==='training-target').health===60);
  trace=await step('melee-hit',{type:'attack'},.3,{x:.35,y:6,z:8,yaw:0,pitch:0});check('melee in range deals actual damage',trace.after.objects.find(o=>o.id==='training-target').health===35);
  const meleeSaved=(await request('snapshot',{freeze:true})).snapshot;await load(build,meleeSaved);trace=await step('melee-restart-cooldown',{type:'attack'});check('restart does not erase weapon cooldown',trace.after.objects.find(o=>o.id==='training-target').health===35);
  const play=new GameplaySession(scene.systems,scene.objects);play.hurt(50);
  await load(build,{format:'craftmine.progress/2',player:INITIAL_SNAPSHOT.player,gameplay:play.snapshot()});
  trace=await step('actual-worker-extension',{type:'key',code:'KeyG'});check('actual restricted extension worker damages and heals',trace.after.playerHealth===60&&trace.after.objects.find(o=>o.id==='training-target').health===50);
  const drainSaved=(await request('snapshot',{freeze:true})).snapshot;await load(build,drainSaved);await step('extension-restored',{type:'key',code:'KeyG'});
  const twice=(await request('snapshot',{freeze:true})).snapshot;check('actual extension state persists across worker recreation',twice.behaviors.modules['training-drain-key'].extensions['training-drain'].state.calls===2&&twice.gameplay.systems['health-system'].health===70);
  const module=packages().modules.find(m=>m.kind==='creation'),installed=materializeCreation(module.payload,{id:module.id,version:module.version},{x:5,y:6,z:10},'installed-garden');
  const installedBuild=built(installed);await load(installedBuild);trace=await step('installed-ext-call',{type:'key',code:'KeyG'});
  check('same fixed extension executes inside remapped creation instance',trace.after.objects.find(o=>o.id==='installed-garden-o3').health===50);
  const installedSaved=(await request('snapshot',{freeze:true})).snapshot;await load(installedBuild,installedSaved);await step('installed-ext-restart',{type:'key',code:'KeyG'});
  check('installed instance lifecycle and extension state survive restart',(await request('snapshot',{freeze:true})).snapshot.behaviors.modules['installed-garden-b1'].extensions['training-drain'].state.calls===2);
  const verified=await page.evaluate(async({build,extensions})=>{const {verifyBehaviorsInBrowser}=await import('/app/behavior-check.mjs');return verifyBehaviorsInBrowser(build,{extensions});},{build:installedBuild,extensions});
  report.behaviorVerification=verified;check('production behavior verifier accepts remapped extension dependencies',verified.passed,verified.modules.map(m=>m.error));
  const missing=await page.evaluate(async build=>{const {verifyBehaviorsInBrowser}=await import('/app/behavior-check.mjs');return verifyBehaviorsInBrowser(build);},installedBuild);
  check('production verifier rejects missing fixed extension',!missing.passed);
  const blockedScene=trainingScene();blockedScene.objects.push({id:'cover-wall',name:'遮挡墙',position:{x:0,y:6,z:8},source:null,components:{health:0,contactDamage:0},parts:[part([0,0,0],[1,2,.4],'#887766','box',true)]});
  await load(built(blockedScene));trace=await step('occluded-target',{type:'attack'},0,{x:.35,y:6,z:11,yaw:0,pitch:0});
  check('real raycast cannot damage a target behind solid cover',trace.after.objects.find(o=>o.id==='training-target').health===60&&trace.after.gameplay.systems['ranged-system'].ammo===2);
  const deadPlay=new GameplaySession(scene.systems,scene.objects);deadPlay.hurt(100);await load(build,{format:'craftmine.progress/2',player:INITIAL_SNAPSHOT.player,gameplay:deadPlay.snapshot()});
  trace=await step('dead-player-attack',{type:'attack'});check('persisted player death rejects actual weapon fire',trace.after.playerHealth===0&&trace.after.gameplay.systems['ranged-system'].ammo===3);
  // Actual sandbox rejection cases execute through the production Worker class.
  const selfTests=await runSelfTests(drainExtension(),{createRunner:sandboxRunner(page)});
  const sandbox=await page.evaluate(async extension=>{
    const {ExtensionRunner}=await import('/app/extension-runner.mjs');
    const failed=[];
    for(const code of ['export function apply(){while(true){} }','export function apply(){return {state:{},effects:[{type:"inventory.add",item:"forged",count:1}]};}']){
      const runner=new ExtensionRunner({...extension,code},{applyTimeoutMs:80});try{await runner.ready;await runner.apply({command:{type:'training.drain',targetId:'training-target',amount:10},world:{objects:[{id:'training-target',position:{x:0,y:6,z:6},health:60,visible:true,solid:true}]},state:{}});failed.push(false);}catch(error){failed.push(error.message);}finally{runner.dispose();}
    }return {failed};
  },drainExtension());sandbox.real=selfTests;report.sandbox=sandbox;save();
  check('actual extension self-test is green and actual noop is red',sandbox.real.passed&&sandbox.real.results.every(r=>r.noop.passed===false));
  check('worker timeout and unauthorized effects reject without host death',sandbox.failed.every(value=>typeof value==='string'));
  await load(build,INITIAL_SNAPSHOT,{preview:false});
  await page.evaluate(()=>window.frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce:window.nonce,type:'resume'},location.origin));
  await page.waitForFunction(()=>window.selections.length>0,{},{timeout:3000});
  const selections=await page.evaluate(()=>window.selections);report.selections=selections;
  check('selection comes from actual raycast with bound world and build',selections[0].objectId==='training-target'&&selections[0].worldId==='dispatch-d-world'&&selections[0].build.hash===build.hash&&selections[0].selectionRevision===1);
  await request('snapshot',{freeze:true});
  await assert.rejects(()=>request('request-step',{step:{label:'forbidden',event:{type:'attack'}}}),/独立预览/);
  check('formal world rejects acceptance events',true);
  const audits=await Promise.all(page.frames().map(frame=>frame.evaluate(()=>window.__audit||{})));report.inputAudit=audits;
  check('zero pointer lock and focus requests',audits.every(a=>a.pointerLock===0&&a.focus===0));
  check('no page errors or host failure',report.errors.length===0,report.errors);
}catch(error){report.errors.push(error.stack);process.exitCode=1;console.error(error.message);}
finally{await context?.close();await new Promise(resolve=>server.close(resolve));save();console.log('Evidence: '+out);}
