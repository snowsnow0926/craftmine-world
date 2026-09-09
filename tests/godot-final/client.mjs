// Actual Electron entry, real plugin/core, isolated profile, no input events.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const root=path.resolve(import.meta.dirname,'../..');
const desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const mainSource=fs.readFileSync(path.join(desktop,'electron/main/index.ts'),'utf8');
assert.match(mainSource,/configureHeadlessAcceptance\(\)/);
assert.match(fs.readFileSync(path.join(desktop,'electron/main/craftmine-headless.ts'),'utf8'),/Headless window was not created offscreen/);
const packaged=process.env.CRAFTMINE_PACKAGED_ROOT;
const exe=packaged?path.join(packaged,'Craftmine World.exe'):require('electron');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-godot-final-'));
const profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const resources=packaged?path.join(packaged,'resources'):null;
const report={format:'craftmine.final-client-acceptance/1',out,packaged:packaged??null,startedAt:new Date().toISOString(),steps:[],calls:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,
  CRAFTMINE_CORE_BIN:resources?path.join(resources,'bin/craftmine-core.exe'):path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe'),
  PI_DESKTOP_HOST_BIN:resources?path.join(resources,'bin/pi-desktop-host-core.exe'):path.join(root,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe')};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,packaged?[]:[desktop],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let ready=false,ended=false;
const pending=new Map();
child.stdout.on('data',data=>fs.appendFileSync(path.join(out,'stdout.log'),data));
child.stderr.on('data',data=>fs.appendFileSync(path.join(out,'stderr.log'),data));
child.on('error',error=>{report.spawnError=String(error);ended=true;save();});
child.on('message',message=>{
  if(message?.type==='craftmine-headless-ready')ready=true;
  if(message?.type==='craftmine-headless-exit')report.exitAudit=message;
  if(message?.type!=='craftmine-headless')return;
  const task=pending.get(message.id);if(!task)return;
  clearTimeout(task.timer);pending.delete(message.id);
  message.error?task.reject(Error(message.error)):task.resolve(message.result);
});
const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{ended=true;report.exit={code,signal};resolve();for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Electron exited'));}pending.clear();}));
const rpc=(method,payload={},timeout=20000)=>new Promise((resolve,reject)=>{
  const id=randomUUID();if(ended||!child.connected)return reject(Error('Electron exited'));
  const record={method,payload,at:new Date().toISOString()};report.calls.push(record);
  const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timed out: ${method}`));},timeout);
  pending.set(id,{timer,resolve:value=>{record.result=value;save();resolve(value);},reject:error=>{record.error=String(error);save();reject(error);}});
  child.send({type:'craftmine-headless',id,method,...payload});
});
const until=async(fn,predicate,label,timeout=60000)=>{
  const deadline=Date.now()+timeout;let last,error;
  while(Date.now()<deadline){if(ended)throw Error('Electron exited during '+label);try{last=await fn();if(predicate(last))return last;}catch(e){if(e.fatal)throw e;error=String(e);}await delay(500);}
  throw Error(`${label}: ${JSON.stringify(last)} ${error??''}`);
};
const step=async(name,fn)=>{const began=Date.now();try{const value=await fn();report.steps.push({name,passed:true,ms:Date.now()-began,result:value});console.log('PASS '+name);save();return value;}catch(error){report.steps.push({name,passed:false,ms:Date.now()-began,error:String(error)});save();throw error;}};
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload},30000);
try{
  await step('hidden client starts',async()=>{await until(()=>ready,Boolean,'controller');const status=await rpc('status');assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));assert.equal(status.violations.length,0);return status;});
  const options=await step('production world catalog loads',()=>until(()=>nav('world.createOptions'),value=>value.bases?.some(base=>base.id==='first-person'),'catalog'));
  report.catalog=options;
  const bases=process.env.CRAFTMINE_TEST_BASES?.split(',')??['first-person','top-down','side-view'];
  for(const baseId of bases){
    const world=await step(`create ${baseId}`,()=>nav('world.create',{title:`Acceptance ${baseId}`,baseId,starterId:'blank',operationId:randomUUID()}));
    await step(`build, check and first-load ${baseId}`,()=>until(async()=>{
      const list=await nav('world.list');const row=list.worlds?.find(item=>item.id===world.id);
      if(row?.state==='failed')throw Object.assign(Error(JSON.stringify(row.creation)),{fatal:true});
      return row;
    },row=>row?.state==='ready','initialization '+baseId,900000));
    await step(`render ${baseId}`,()=>rpc('captureWorld',{name:`world-${baseId}`}));
  }
  await step('input policy remains intact',async()=>{const status=await rpc('status');assert.equal(status.violations.length,0);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));return status;});
}catch(error){report.fatal=String(error?.stack??error);process.exitCode=1;console.error(report.fatal);}
finally{
  if(!ended){try{await rpc('quit',{},5000);}catch{}await Promise.race([exit,delay(8000)]);if(!ended)child.kill();await exit;}
  report.finishedAt=new Date().toISOString();save();console.log('Evidence: '+out);
}
