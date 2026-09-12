// Exercise the shipped application with a read-only copy of a retained player
// world. Never launch against the source profile or emulate OS input/focus.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';
import {loadPackageAsar} from '../desktop/package-asar.mjs';

assert.ok(process.argv[2] && process.argv[3] && process.argv[4],
  'Usage: node tests/fb02-packaged-retained-world.mjs APP_DIRECTORY SOURCE_PROFILE WORLD_ID');
const repo=path.resolve(import.meta.dirname,'..'),pack=path.resolve(process.argv[2]);
const original=path.resolve(process.argv[3]),worldId=process.argv[4];
assert.match(worldId,/^[a-zA-Z0-9._-]{1,128}$/);
const directory=fs.mkdtempSync(path.join(repo,'test-results/desktop-native-fb02-'));
const profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacy);
const data='plugins/data/craftmine.world',from=path.join(original,data),to=path.join(profile,data);
fs.mkdirSync(to,{recursive:true});
for(const name of ['settings.json','asset-catalog','content-history','godot-source','godot-builds']) {
  fs.cpSync(path.join(from,name),path.join(to,name),{recursive:true,
    filter:file=>!['LOCK','domain-writer.lock','.craftmine-operation.lock','cache'].includes(path.basename(file))});
}
fs.cpSync(path.join(original,'godot-worlds'),path.join(profile,'godot-worlds'),{recursive:true});
fs.cpSync(path.join(original,'desktop/Local Storage'),path.join(profile,'desktop/Local Storage'),
  {recursive:true,filter:file=>path.basename(file)!=='LOCK'});
const db=new DatabaseSync(path.join(from,'tasks.sqlite'),{readOnly:true});
await backup(db,path.join(to,'tasks.sqlite'));db.close();
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const asar=loadPackageAsar(path.join(repo,'vendor/pi-desktop/apps/desktop'));
const development=fs.existsSync(path.join(pack,'package.json'));
const main=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):
  asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance']) {
  assert.ok(main.includes(guard),'UNSAFE_PACKAGE:'+guard);
}
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,
  CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_CREATION|CRAFTMINE_TEST_|PI_DESKTOP_(CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
const child=spawn(development?createRequire(path.join(pack,'package.json'))('electron'):path.join(pack,'Craftmine World.exe'),
  [...(development?[pack]:[]),'--remote-debugging-port=0'],
  {cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
let websocket,ready=false,exited=false,browser;
const pending=new Map(),report={package:pack,sourceProfile:original,profile,directory,worldId,
  startedAt:new Date().toISOString(),snapshots:[],limits:['No physical keyboard/mouse or visible OS window activation']};
const log=fs.createWriteStream(path.join(directory,'electron.log'));
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.stderr.on('data',bytes=>{websocket??=bytes.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
child.on('message',message=>{
  if(message.type==='craftmine-headless-ready')ready=true;
  if(message.type==='craftmine-headless-exit')report.exitAudit=message;
  const item=pending.get(message.id);
  if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error)):item.resolve(message.result);}
});
const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;report.exit={code,signal};resolve();}));
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{
  const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},30000);
  pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});
});
const write=()=>fs.writeFileSync(path.join(directory,'retained-world-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({directory,package:pack}));
try {
  for(let i=0;i<200&&(!ready||!websocket)&&!exited;i++)await delay(100);
  assert.ok(ready,'headless startup ready');
  assert.ok(websocket,'isolated application debugger endpoint ready');
  // Default Playwright CDP attachment emulates document focus on hidden
  // verifier pages. Preserve all application defaults and focus guards.
  browser=await playwright().chromium.connectOverCDP(websocket,{noDefaults:true});
  for(let i=0;i<160;i++){
    const state=await rpc('primaryMode').catch(()=>null);
    if(state?.width>0){if(state.entry)report.enter=await rpc('primaryMode',{payload:{action:'play'}});break;}
    await delay(150);
  }
  const started=Date.now();
  for(let i=0;i<240&&!exited;i++){
    const sample={atMs:Date.now()-started,status:await rpc('status'),mode:await rpc('primaryMode'),pages:[]};
    if(browser)for(const page of browser.contexts().flatMap(c=>c.pages())){
      if(!page.url().includes('/views/world.html')&&!page.url().includes('/out/renderer/index.html'))continue;
      const state=await page.evaluate(()=>{
        const loading=document.getElementById('godot-loading'),progress=document.getElementById('godot-loading-progress');
        const inspect=element=>{
          if(!element)return null;
          const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
          let ancestorsVisible=true;
          for(let parent=element;parent;parent=parent.parentElement){
            const parentStyle=getComputedStyle(parent);
            if(parentStyle.display==='none'||parentStyle.visibility!=='visible'||Number(parentStyle.opacity)===0){ancestorsVisible=false;break;}
          }
          return {rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},display:style.display,visibility:style.visibility,opacity:style.opacity,
            visible:ancestorsVisible&&rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight};
        };
        const card=inspect(loading),bar=inspect(progress),ariaHidden=loading?.getAttribute('aria-hidden');
        return {url:location.href,body:document.body?.innerText.slice(0,1800),
          dataset:{...document.body?.dataset},viewport:[innerWidth,innerHeight],loading:loading?.outerHTML,
          loadingVisibility:{ariaHidden,card,progress:bar,visible:ariaHidden==='false'&&card?.visible===true&&bar?.visible===true},
          guard:globalThis.__craftmineHeadless};
      });
      sample.pages.push(state);
      if(i===0)await page.screenshot({path:path.join(directory,'startup-'+sample.pages.length+'.png')});
      if(!report.loadingCapture&&state.url.includes('/views/world.html')&&state.loadingVisibility.visible){
        const screenshot=path.join(directory,'world-loading.png');
        await page.screenshot({path:screenshot});
        report.loadingCapture={screenshot,atMs:Date.now()-started,visibility:state.loadingVisibility,url:state.url};
      }
    }
    report.snapshots.push(sample);
    const file=path.join(profile,'logs/app/plugin.log');
    report.maintenance=fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n')
      .filter(line=>line.includes('stock ground maintenance')).map(line=>JSON.parse(line)):[];
    write();
    const last=report.maintenance.at(-1)?.data;
    if(['applied','failed','cancelled','skipped'].includes(last?.status))break;
    await delay(500);
  }
  assert.equal(report.maintenance.at(-1)?.data.status,'applied','retained stock world check and adoption succeeds');
  report.world=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});
  report.snapshot=await rpc('godotSnapshot');
  report.guards=await rpc('guards');
  assert.ok(report.loadingCapture?.visibility.visible&&fs.existsSync(report.loadingCapture.screenshot),
    'actual retained-world plugin has a visible loading card and progress bar, with captured pixels');
  if(browser){
    const game=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:'));
    assert.ok(game,'native Godot page exists after adoption');
    await delay(1000);await game.screenshot({path:path.join(directory,'adopted-world.png')});
    report.finalPage=await game.evaluate(()=>({viewport:[innerWidth,innerHeight],focus:document.hasFocus(),guard:globalThis.__craftmineHeadless}));
    assert.equal(report.finalPage.focus,false,'audit connection never emulates input focus');
  }
  report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack??error);process.exitCode=1;console.error(report.error);}
finally {
  try{await rpc('quit');}catch{}
  await Promise.race([exit,delay(15000)]);
  if(!exited){child.kill();await exit;report.passed=false;process.exitCode=1;}
  await browser?.close().catch(()=>{});log.end();
  if(report.passed){
    try{assert.equal(report.exit.code,0);assert.deepEqual(report.exitAudit?.violations,[]);
      assert.deepEqual(report.exitAudit?.pageErrors,[]);assert.deepEqual(report.exitAudit?.shutdownFailures,[]);}
    catch(error){report.passed=false;report.error=String(error);process.exitCode=1;}
  }
  write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error,world:report.world}));
}
