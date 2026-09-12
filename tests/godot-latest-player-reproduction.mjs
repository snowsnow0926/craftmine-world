// Reproduce the latest real player's retained PCK without executing a model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
import {playwright} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),pack=path.resolve(process.argv[2]),evidenceFile=path.resolve(process.argv[3]);
const evidenceBytes=fs.readFileSync(evidenceFile),evidence=JSON.parse(evidenceBytes),original='C:/Users/WINDOWS/AppData/Local/CraftmineWorld';
const worldId=evidence.world.id,sessionId=evidence.session.id;
const directory=fs.mkdtempSync(path.join(root,'test-results/desktop-native-latest-player-')),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacy);
const data='plugins/data/craftmine.world',from=path.join(original,data),to=path.join(profile,data);fs.mkdirSync(to,{recursive:true});
for(const name of ['settings.json','asset-catalog','content-history','godot-source','godot-builds'])if(fs.existsSync(path.join(from,name)))fs.cpSync(path.join(from,name),path.join(to,name),{recursive:true,filter:file=>!['LOCK','domain-writer.lock','.craftmine-operation.lock','cache'].includes(path.basename(file))});
fs.cpSync(path.join(original,'godot-worlds'),path.join(profile,'godot-worlds'),{recursive:true});
if(fs.existsSync(path.join(original,'desktop/Local Storage')))fs.cpSync(path.join(original,'desktop/Local Storage'),path.join(profile,'desktop/Local Storage'),{recursive:true,filter:file=>path.basename(file)!=='LOCK'});
for(const [source,target] of [[path.join(from,'tasks.sqlite'),path.join(to,'tasks.sqlite')],[path.join(original,'pi.sqlite'),path.join(profile,'pi.sqlite')]]){const db=new DatabaseSync(source,{readOnly:true});if(source.endsWith('/pi.sqlite')||source.endsWith('\\pi.sqlite'))assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scheduled_tasks').get().n,0,'No ambient scheduled tasks in the fixture');await backup(db,target);db.close();}
fs.mkdirSync(path.join(profile,'sessions'));fs.copyFileSync(path.join(original,'sessions',sessionId+'.jsonl'),path.join(profile,'sessions',sessionId+'.jsonl'));
const settingsPath=path.join(to,'settings.json'),settings=JSON.parse(fs.readFileSync(settingsPath));settings.activeWorldId=worldId;fs.writeFileSync(settingsPath,JSON.stringify(settings));
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const asar=loadPackageAsar(path.join(root,'vendor/pi-desktop/apps/desktop')),main=asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance'])assert.ok(main.includes(guard));assert.ok(main.includes('offscreen: isOffscreenAcceptance()')||main.includes('offscreen: !!headlessAcceptance'));
const report={format:'craftmine.latest-player-pck-reproduction/1',directory,profile,originalProfile:original,package:pack,worldId,sessionId,evidenceFile,evidenceSha256:createHash('sha256').update(evidenceBytes).digest('hex'),mainBundleSha256:createHash('sha256').update(main).digest('hex'),modelCallsAdded:0,sourceEdits:0,credentialsCopied:false,checks:[],status:'STARTING'};
const reportFile=path.join(directory,'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));save();console.log(JSON.stringify({directory,reportFile}));
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};for(const k of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_EVAL|CRAFTMINE_TEST_|CRAFTMINE_CREATION|PI_DESKTOP_CAPTURE)/.test(k))delete env[k];
let ready=false,ended=false,ws,browser;const pending=new Map();const child=spawn(path.join(pack,'Craftmine World.exe'),['--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
for(const key of ['stdout','stderr'])child[key].on('data',b=>{const value=b.toString().split(token).join('[redacted]');fs.appendFileSync(path.join(directory,key+'.log'),value);if(key==='stderr')ws??=value.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
child.on('message',m=>{if(m.type==='craftmine-headless-ready')ready=true;if(m.type==='craftmine-headless-exit')report.audit=m;const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{ended=true;report.exit={code,signal};resolve();}));
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{if(ended)return reject(Error('APP_EXITED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
const controller=new AbortController(),signal=controller.signal;for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort());const cancelFile=path.join(directory,'cancel'),watch=setInterval(()=>{if(fs.existsSync(cancelFile))controller.abort();},250);report.cancelFile=cancelFile;
const until=async(fn,predicate)=>{for(;;){if(signal.aborted)throw Error('CANCELLED');if(ended)throw Error('APP_EXITED');const v=await fn();if(predicate(v))return v;await delay(250,undefined,{signal});}};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);save();console.log('PASS '+name);};
async function capture(name){const before=await rpc('godotCaptureBoundState'),image=await rpc('godotCaptureBoundView',{payload:before.formal});assert.deepEqual(await rpc('godotCaptureBoundState'),before);const bytes=Buffer.from(image.pngBase64,'base64'),file=path.join(directory,name+'.png');fs.writeFileSync(file,bytes);return {...image,pngBase64:undefined,file};}
try{
 await until(async()=>ready&&ws,Boolean);browser=await playwright().chromium.connectOverCDP(ws,{noDefaults:true});
 const page=await until(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html')),Boolean);
 await until(()=>rpc('primaryMode'),m=>m.width>0);
 if((await rpc('primaryMode')).entry){await rpc('primaryMode',{payload:{action:'play'}});if((await rpc('primaryMode')).entry)await rpc('primaryMode',{payload:{action:'play'}});}
 report.before=await until(()=>rpc('godotObserve').catch(()=>null),r=>r?.worldId===worldId);
 check('loaded the actual player formal PCK',report.before.buildId===evidence.world.document.build.id);
 await rpc('primaryMode',{payload:{action:'closed'}});await until(()=>rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}}).catch(e=>{if(/WORLD_BUSY/.test(e.message))return null;throw e;}),state=>state?.state==='ready');
 report.beforeSnapshot=await rpc('godotSnapshot');report.beforeImage=await capture('before-interact');
 const identity=Object.fromEntries(['worldId','buildId','instanceId'].map(k=>[k,report.before[k]]));
 report.interaction=await rpc('godotExplore',{payload:{...identity,steps:[{op:'play-action',args:{action:'interact',frames:1},capture:false},{op:'wait',args:{frames:30},capture:false}]}});
 report.afterSnapshot=await rpc('godotSnapshot');report.afterImage=await capture('after-interact');
 const player=report.beforeSnapshot.state.body.player.position;report.pickupDistance=Math.hypot(player[0]-1.13,player[2]-14.67);
 check('original saved player is within actual pickup distance',report.pickupDistance<2.8);
 report.reproducedPickupFailure=!report.afterSnapshot.state.body.inventory.ak47;
 check('normal engine interact really dispatched',report.interaction.actions[0].result.dispatched===true||report.interaction.actions[0].result.result?.dispatched===true);
 await rpc('primaryMode',{payload:{action:'compact'}});
 report.conversation=await until(()=>page.evaluate(()=>({sessionId:document.querySelector('[data-session-pane][data-visible="true"]')?.dataset.sessionPane??null,restoring:!!document.querySelector('[data-world-conversation-restoring]'),results:[...document.querySelectorAll('.craftmine-creation-result')].map(e=>({phase:e.dataset.phase,worldId:e.dataset.worldId,sessionId:e.dataset.sessionId,buildId:e.dataset.buildId,text:e.textContent,visible:e.getClientRects().length>0&&!e.closest('[hidden],[inert],[aria-hidden="true"]')}))})),s=>s.sessionId===sessionId&&!s.restoring);
 await page.screenshot({path:path.join(directory,'latest-conversation.png')});
 report.saved=await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});report.status='REPRODUCED';save();
}catch(error){report.status='FAILED';report.error=String(error.stack??error);process.exitCode=1;}
finally{clearInterval(watch);if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(20000)]);if(!ended){child.kill();await exit;report.forcedShutdown=true;}}await browser?.close().catch(()=>{});for(const p of pending.values())clearTimeout(p.timer);save();console.log(JSON.stringify({reportFile,status:report.status,reproduced:report.reproducedPickupFailure,error:report.error}));}

