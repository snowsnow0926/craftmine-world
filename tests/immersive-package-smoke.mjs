// Actual packaged client, fresh profile, guarded offscreen windows; no input/model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
const root=process.cwd(), out=fs.mkdtempSync(path.join(root,'test-results/immersive-package-'));
const profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const client=resolveCreationNativeLaunch({root,requiredGuards:['primaryMode']});
assert.ok(client.packaged,'This smoke test requires the actual package');
const child=spawn(client.executable,client.args,{cwd:client.cwd,env:client.environment({out,profile,token}),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let ended=false,ready=false,exitReport=null;
const pending=new Map(),checks=[];
for(const stream of ['stdout','stderr'])child[stream].on('data',data=>fs.appendFileSync(path.join(out,stream+'.log'),data));
const exited=new Promise(resolve=>child.on('exit',(code,signal)=>{ended=true;resolve({code,signal});}));
child.on('message',message=>{
  if(message.type==='craftmine-headless-ready')ready=true;
  if(message.type==='craftmine-headless-exit')exitReport=message;
  const call=pending.get(message.id);if(call){pending.delete(message.id);clearTimeout(call.timer);message.error?call.reject(Error(message.error)):call.resolve(message.result);}
});
const rpc=(method,payload)=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...(payload?{payload}:{})});});
async function until(read,accept,label){for(let i=0;i<180;i++){if(ended)throw Error('Client exited: '+label);try{const result=await read();if(accept(result))return result;}catch(error){if(i===179)throw error;}await delay(500);}throw Error('Not ready: '+label);}
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
let failure;
try {
  await until(async()=>ready,Boolean,'headless ready');
  await until(()=>rpc('primaryMode'),s=>s.entry,'primary entry');check('packaged application opens on mode chooser',true);
  await rpc('primaryMode',{action:'create'});
  const world=await until(()=>rpc('worldState'),s=>s.loaded,'packaged world plugin and Web world');check('bundled world plugin loads a playable world',!!world.id);
  await rpc('primaryMode',{action:'entry'});await until(()=>rpc('primaryMode'),s=>s.entry,'return entry');
  await rpc('primaryMode',{action:'play'});await until(()=>rpc('primaryMode'),s=>s.play&&!s.entry,'immersive mode');
  for(const action of ['closed','compact','full','closed']){
    await rpc('primaryMode',{action});
    const state=await until(()=>rpc('primaryMode'),s=>s.world&&s.world.x===0&&s.world.y===0&&s.world.width===s.width&&s.world.height===s.height&&(action==='closed'?!s.dialog:!!s.dialog),'full world '+action);
    check(action+' keeps the world full-client',!!state.world);
    if(state.dialog)check(action+' floats over the unchanged world',state.dialog.x>0&&state.dialog.y>0);
  }
  const status=await rpc('status');check('no shown, focused or focusable window',status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  check('no forbidden input or renderer errors',status.violations.length===0&&status.pageErrors.length===0);
  await rpc('quit');const result=await exited;check('clean package shutdown',result.code===0&&exitReport?.violations?.length===0&&exitReport?.shutdownFailures?.length===0);
} catch(error){failure=error;process.exitCode=1;console.error(error);}
finally {
  if(!ended){try{await rpc('quit');}catch{}await Promise.race([exited,delay(10000)]);if(!ended)child.kill();}
  for(const item of pending.values())clearTimeout(item.timer);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:!failure,checks,error:failure?.stack,exitReport,packageIdentity:client.identity},null,2));
  console.log('Report: '+out);
}
