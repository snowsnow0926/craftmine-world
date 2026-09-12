// Execute the real before-quit preparation branch with finite dependencies.
// No Electron window or real confirmation dialog is created by this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../vendor/pi-desktop/apps/desktop/electron/main/index.ts',import.meta.url),'utf8');
const begin=source.indexOf('app.on("before-quit", (event) => {');
const end=source.indexOf('\n  quitting = true;',begin);
assert.ok(begin>=0&&end>begin,'actual quit preparation boundary exists');
const code=stripTypeScriptTypes(source.slice(begin,end)+'\n});',{mode:'transform'});
function fixture(){
  const calls=[];let handler,confirm=true,saved=true;
  const context={app:{on:(event,callback)=>{assert.equal(event,'before-quit');handler=callback;},quit:()=>calls.push('quit')},
    hasSingleInstanceLock:true,shutdownComplete:false,shutdownPromise:null,headlessAcceptance:false,
    process:{env:{}},quitConfirmed:false,craftmineQuitPrepared:false,craftmineQuitPreparation:null,
    confirmQuitDialog:async()=>{calls.push('confirm');return confirm;},godotCopies:{busy:false},godotExportBusy:false,
    groundMaintenanceScheduler:{suspend:()=>calls.push('ground-suspend'),resume:()=>calls.push('ground-resume')},
    creationAutoQueue:{suspend:async()=>calls.push('auto-suspend'),continue:async()=>calls.push('auto-resume')},
    groundMaintenance:{stopAll:async()=>calls.push('ground-stop')},godotCandidates:{closeForDeparture:async()=>calls.push('candidate-close')},
    godotVerifier:{cancelAll:()=>calls.push('verifier-cancel')},pluginViews:{prepareCraftmineForQuit:async()=>calls.push('plugin-save')},
    godotWorld:{prepareForQuit:async()=>{calls.push('godot-save');return {ok:saved,error:saved?undefined:'DISK_WRITE_FAILED'};}},
    logger:{app:()=>calls.push('log-error')},sendToRenderer:(_channel,payload)=>calls.push(payload.message),IPC:{event:{toast:'toast'}},updaterLocale:'zh-CN'};
  vm.createContext(context);vm.runInContext(code,context);
  return {context,calls,set confirm(value){confirm=value;},set saved(value){saved=value;},
    async quit(){handler({preventDefault:()=>calls.push('prevent')});for(let i=0;i<30;i++)await Promise.resolve();}};
}
test('ordinary interactive quit cancellation never starts save/stop or rewrites confirmation policy',async()=>{
  const f=fixture();f.confirm=false;await f.quit();assert.deepEqual(f.calls,['prevent','confirm']);assert.equal(f.context.quitConfirmed,false);assert.equal(f.context.craftmineQuitPrepared,false);
});
test('ordinary accepted quit drains automatic work and checkpoints before allowing final shutdown',async()=>{
  const f=fixture();await f.quit();assert.deepEqual(f.calls,['prevent','confirm','quit']);await f.quit();
  assert.deepEqual(f.calls.slice(3),['prevent','ground-suspend','auto-suspend','ground-stop','candidate-close','verifier-cancel','plugin-save','godot-save','quit']);
  assert.equal(f.context.craftmineQuitPrepared,true);assert.equal(f.context.craftmineQuitPreparation,null);
});
test('save failure keeps the app alive, restores automatic schedulers and allows a later successful retry',async()=>{
  const f=fixture();f.context.quitConfirmed=true;f.saved=false;await f.quit();assert.equal(f.calls.includes('quit'),false);
  assert.equal(f.context.craftmineQuitPrepared,false);assert.equal(f.context.quitConfirmed,false);assert.equal(f.context.craftmineQuitPreparation,null);
  assert.ok(f.calls.includes('ground-resume'));assert.ok(f.calls.includes('auto-resume'));assert.ok(f.calls.some(value=>value.includes('世界尚未保存')));
  f.saved=true;await f.quit();await f.quit();assert.equal(f.context.craftmineQuitPrepared,true);assert.equal(f.calls.filter(value=>value==='godot-save').length,2);
});
test('a second instance without the profile lock never runs owner shutdown writes',async()=>{
  const f=fixture();f.context.hasSingleInstanceLock=false;await f.quit();assert.deepEqual(f.calls,[]);
});
