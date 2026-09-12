// Continue only post-generation verification; never dispatch another model turn.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {createHash,randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';import {loadPackageAsar} from '../desktop/package-asar.mjs';import {loadLocalConfig} from '../app/local-config.mjs';
const root=path.resolve(import.meta.dirname,'..'),sourceFile=path.resolve(process.argv[2]??'');
assert.ok(process.argv[2]&&path.isAbsolute(process.argv[2]),'Absolute original ordinary-player report required');
const sourceBytes=fs.readFileSync(sourceFile),source=JSON.parse(sourceBytes),hash=value=>createHash('sha256').update(value).digest('hex');
assert.equal(source.format,'craftmine.fb02-ordinary-player/1');assert.equal(source.latest?.application?.phase,'applied');assert.equal(source.latest?.metrics?.status,'completed');
assert.ok(source.checks.includes('ordinary model result was formally applied without permission acceptance or manual adopt'));assert.equal(source.permissionDecisions,0);assert.equal(source.manualAdoptions,0);
assert.equal(source.launches.at(-1).exit.code,0);assert.deepEqual(source.launches.at(-1).exitAudit.violations,[]);
const pack=path.resolve(process.argv[3]??source.package),profile=path.resolve(source.profile),profileRoot=path.resolve(source.directory),worldId=source.worldId,sessionId=source.sessionId,buildId=source.after.formal.world.build.id;
assert.equal(profile,path.join(profileRoot,'profile'));assert.ok(profileRoot.startsWith(path.join(root,'test-results')+path.sep));
const marker=fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'),token=JSON.parse(marker).token;
const development=fs.existsSync(path.join(pack,'package.json')),asar=loadPackageAsar(path.join(root,'vendor/pi-desktop/apps/desktop'));
const main=development?fs.readFileSync(path.join(pack,'out/main/index.js')):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js'));
for(const guard of ['configureHeadlessAcceptance()','HEADLESS_BOUND_CAPTURE_DENIED','godotCaptureBoundView'])assert.ok(main.includes(guard),'Bound protected capture support required');
const mainBundleSha256=hash(main),changed=mainBundleSha256!==source.mainBundleSha256;
if(changed)assert.ok(process.argv.includes('--allow-diagnostic-product-change'),'Explicit changed diagnostic product flag required');
const directory=fs.mkdtempSync(path.join(profileRoot,'continuation-')),reportFile=path.join(directory,'report.json');
const report={format:'craftmine.fb02-ordinary-player-continuation/1',continuedFrom:sourceFile,originalReport:{path:sourceFile,sha256:hash(sourceBytes),status:source.status,mainBundleSha256:source.mainBundleSha256},
  package:pack,development,mainBundleSha256,changedDiagnosticProduct:changed,directory,profile,worldId,sessionId,buildId,config:source.config,sourceModelMetrics:source.latest.metrics,modelCallsAdded:0,
  status:'VERIFYING_REOPENS',checks:[],reopens:[],captures:[],captureMethod:'GodotWorldViewHost.captureView; unchanged identity, layout, window and attached world bounds'};
const secrets={};loadLocalConfig(path.join(root,'.craftmine/secrets.json'),secrets);const secret=secrets.CRAFTMINE_DEEPSEEK_API_KEY??secrets.DEEPSEEK_API_KEY??secrets.CRAFTMINE_EVAL_KEY;
const clean=value=>{let text=typeof value==='string'?value:JSON.stringify(value,null,2);for(const sensitive of [token,secret].filter(Boolean))text=text.split(sensitive).join('[redacted]');return text;};
const save=()=>fs.writeFileSync(reportFile,clean(report)),check=(name,value)=>{assert.ok(value,name);report.checks.push(name);save();console.log('PASS '+name);};
let stopped=false;for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>stopped=true);
const cancelFile=path.join(directory,'cancel');report.cancelFile=cancelFile;
const until=async(read,accept)=>{for(;;){if(stopped||fs.existsSync(cancelFile))throw Error('CONTINUATION_CANCELLED');const result=await read();if(accept(result))return result;await delay(300);}};
save();console.log(JSON.stringify({directory,reportFile,cancelFile}));
async function launch(label){
 const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:profileRoot,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
 for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_CREATION|CRAFTMINE_EVAL|CRAFTMINE_TEST_|CRAFTMINE_P8_|PI_DESKTOP_(CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
 const executable=development?createRequire(path.join(pack,'package.json'))('electron'):path.join(pack,'Craftmine World.exe');
 const child=spawn(executable,[...(development?[pack]:[]),'--remote-debugging-port=0'],{cwd:profileRoot,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
 const record={label};report.reopens.push(record);const pending=new Map();let ready=false,exited=false,chromeWs,browser;
 const log=fs.createWriteStream(path.join(directory,label+'.log'));child.stdout.on('data',bytes=>log.write(clean(bytes.toString())));child.stderr.on('data',bytes=>{const text=bytes.toString();log.write(clean(text));chromeWs??=text.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];});
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')record.exitAudit=message;const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(Error(message.error)):waiter.resolve(message.result);}});
 const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;record.exit={code,signal};for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('APP_EXITED'));}pending.clear();resolve();}));
 const rpc=(method,fields={})=>new Promise((resolve,reject)=>{if(exited)return reject(Error('APP_EXITED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
 const stop=async()=>{if(!exited)await rpc('quit').catch(()=>{});await Promise.race([exit,delay(20000,undefined,{ref:false})]);if(!exited){child.kill();await exit;record.forced=true;}await browser?.close().catch(()=>{});log.end();save();};
 try{
   await until(async()=>{if(exited)throw Error('APP_STARTUP_EXITED');return ready&&chromeWs;},Boolean);
   browser=await playwright().chromium.connectOverCDP(chromeWs,{noDefaults:true});
   const page=await until(async()=>browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('/out/renderer/index.html')),Boolean);
   await until(()=>page.evaluate(()=>!!window.piDesktop&&!!document.querySelector('#root')?.children.length),Boolean);
   const api=(channel,...args)=>page.evaluate(async({channel,args})=>{const result=await piDesktop.invoke(channel,...args);if(!result?.ok)throw Error(result?.error?.message??'DESKTOP_REQUEST_FAILED');return result.data;},{channel,args});
   record.metricsBefore=await api('pi-desktop/session/turnMetrics',{sessionId});
   check(label+' starts with no new model calls',record.metricsBefore.calls.observed===source.latest.metrics.calls.observed&&record.metricsBefore.status==='completed');
   await until(()=>rpc('godotCaptureBoundState'),state=>state.formal?.worldId===worldId&&state.formal.buildId===buildId&&['ready','paused','saved'].includes(state.state?.state));
   record.frozen=await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});
   record.boundBefore=await rpc('godotCaptureBoundState');record.snapshot=await rpc('godotSnapshot');record.observation=await rpc('godotObserve');record.isolation=await rpc('status');
   check(label+' exact generated build is loaded in isolated native world',record.boundBefore.formal.buildId===buildId&&record.isolation.windows.every(window=>!window.visible&&!window.focusable&&window.offscreen));
   assert.deepEqual(record.snapshot.state,source.after.snapshot.state);check(label+' persisted full gameplay state matches the completed model world',true);
   const before=await rpc('godotCaptureBoundState');let frame;
   try{frame=await rpc('godotCaptureBoundView',{payload:before.formal});}
   catch(error){record.captureFailure={error:String(error),before,after:await rpc('godotCaptureBoundState')};save();throw error;}
   const after=await rpc('godotCaptureBoundState');assert.deepEqual(after,before,'Bound capture cannot resize or mutate owner/world state');
   for(const key of ['worldId','buildId','instanceId'])assert.equal(frame[key],before.formal[key]);
   assert.equal(frame.format,'craftmine.godot-view-capture/1');assert.equal(frame.scope,'formal');
   const png=Buffer.from(frame.pngBase64,'base64');assert.equal(hash(png),frame.sha256);assert.equal(png.readUInt32BE(16),frame.width);assert.equal(png.readUInt32BE(20),frame.height);
   const imageFile=path.join(directory,label+'.png');fs.writeFileSync(imageFile,png);report.captures.push({...frame,pngBase64:undefined,imageFile,before,after});
   check(label+' bound screenshot preserves every native bound and runtime state',true);
   record.metricsAfter=await api('pi-desktop/session/turnMetrics',{sessionId});check(label+' verification added no model calls',record.metricsAfter.calls.observed===source.latest.metrics.calls.observed);
   record.session=await api('pi-desktop/session/get',{id:sessionId});report.latest={record:record.session,metrics:record.metricsAfter};
   return {record,stop};
 }catch(error){await stop().catch(()=>{});throw error;}
}
let active;
try{
 for(const label of ['reopen-one','reopen-two']){active=await launch(label);await active.stop();check(label+' normal saved exit preserves all isolation guards',active.record.exit.code===0&&!active.record.forced&&['violations','pageErrors','shutdownFailures'].every(key=>active.record.exitAudit[key].length===0));active=null;}
 assert.equal(hash(fs.readFileSync(sourceFile)),report.originalReport.sha256);assert.equal(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'),marker);
 report.status='PASSED_PRODUCT_FLOW';report.completedAt=new Date().toISOString();report.modelCallsAdded=report.latest.metrics.calls.observed-source.latest.metrics.calls.observed;
}catch(error){report.status='FAILED';report.error=clean(String(error.stack??error));process.exitCode=1;console.log(report.error);}
finally{await active?.stop().catch(()=>{});save();console.log(reportFile);}
