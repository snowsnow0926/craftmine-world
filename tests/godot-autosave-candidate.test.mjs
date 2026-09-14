import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const {build}=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const out=await fs.mkdtemp(path.join(root,'test-results/autosave-candidate-'));
const modulePath=path.join(out,'godot-panel.mjs');
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-panel-coordinator.ts')],bundle:true,platform:'node',format:'esm',outfile:modulePath});
const {createGodotPanelCoordinator}=await import(pathToFileURL(modulePath).href);
const source=await fs.readFile(path.join(root,'plugins/craftmine-world/view.mjs'),'utf8');
const block=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);};
const code=[block('function send(','function showError('),block('function showError(','function controls('),
  block('function action(','function snapshot('),block('async function save(','function cancelClose(')].join('\n');
assert(source.includes("setInterval(()=>{void autosave();},10000)"));
assert(source.includes("action(saveManually,{resumeOnError:false})"));

function fixture(){
  const state={candidateBusy:true,saves:0,fail:null,race:false};
  const receipt={revision:2,contentHash:'saved-hash',buildId:'formal'};
  const host={instance:{worldId:'world',buildId:'formal',instanceId:'instance'},async save(){
    state.saves++;if(state.race){state.candidateBusy=true;return{status:'failed',error:'GODOT_CANDIDATE_ACTIVE'};}
    return state.fail?{status:'failed',error:state.fail}:{status:'persisted',receipt};
  }};
  const panel=createGodotPanelCoordinator({host,adapter:{},selection:async()=> 'world',candidateBusy:()=>state.candidateBusy,invoke:async()=>{throw Error('unexpected channel');}});
  const calls=[],loading=[];
  const view={godot:true,loaded:true,current:{id:'world',revision:1,world:{build:{id:'formal'}}},busy:false,closing:false,preview:null,backupFrozen:false,
    applicationAttempt:null,openingWorldId:null,errorGeneration:0,presentationError:null,errorBox:{textContent:'',hidden:true},status:{textContent:'已保存',dataset:{}},controls(){},renderWorldLoading:x=>loading.push(x),
    bridge:{invoke:async(channel,args)=>{calls.push(channel);return panel.invoke(channel,args);}}};
  vm.createContext(view);vm.runInContext(code,view);
  return{state,view,host,panel,calls,loading};
}

test('periodic autosave defers under a host-owned candidate without an error, resume or save write',async()=>{
  const f=fixture(),result=await f.view.autosave();
  assert.equal(result.status,'deferred');assert.equal(f.state.saves,0);
  assert.deepEqual(f.calls,['godot.runtimeAutosave']);assert.equal(f.view.errorBox.hidden,true);
  assert.equal(f.view.loaded,true);assert.equal(f.view.current.revision,1);assert.equal(f.loading.length,0);
});

test('candidate completion permits the next periodic save and retains a prior real error',async()=>{
  const f=fixture();f.view.errorBox={hidden:false,textContent:'Earlier real build failure'};
  f.view.status={textContent:'Earlier error',dataset:{error:'true'}};
  await f.view.autosave();assert.equal(f.view.errorBox.textContent,'Earlier real build failure');assert.equal(f.view.status.textContent,'Earlier error');
  f.state.candidateBusy=false;await f.view.autosave();assert.equal(f.state.saves,1);assert.equal(f.view.current.revision,2);
  assert.equal(f.view.errorBox.hidden,false);assert.equal(f.view.errorBox.textContent,'Earlier real build failure');
  assert.equal(f.view.status.textContent,'Earlier error');assert(!f.calls.includes('godot.runtimeResume'));
});

test('ordinary successful autosave reports saved only after a persisted receipt',async()=>{
  const f=fixture();f.state.candidateBusy=false;f.view.status.textContent='Unsaved';await f.view.autosave();
  assert.equal(f.state.saves,1);assert.equal(f.view.status.textContent,'已保存');assert.equal(f.view.current.contentHash,'saved-hash');
});

test('real save failures including a candidate-like code without current host ownership remain visible',async()=>{
  for(const fail of ['DISK_WRITE_FAILED','GODOT_CANDIDATE_ACTIVE','WORLD_BUSY']){
    const f=fixture();f.state.candidateBusy=false;f.state.fail=fail;await f.view.autosave();
    assert.equal(f.view.errorBox.hidden,false);assert.equal(f.view.errorBox.textContent,fail);
    assert.equal(f.view.current.revision,1);assert.equal(f.view.loaded,true);assert(!f.calls.includes('godot.runtimeResume'));
  }
});

test('native pre-save candidate refusal can defer only while the coordinator confirms candidate ownership',async()=>{
  const f=fixture();f.state.candidateBusy=false;f.state.race=true;
  assert.equal((await f.view.autosave()).status,'deferred');assert.equal(f.state.saves,1);
  assert.equal(f.view.current.revision,1);assert.equal(f.view.errorBox.hidden,true);
  await assert.rejects(f.panel.invoke('godot.runtimeAutosave',{worldId:'foreign'}),/GODOT_WORLD_CHANGED/);
  await assert.rejects(f.panel.invoke('godot.runtimeAutosave',{worldId:'world',freeze:true}),/INVALID_GODOT_PANEL_ACTION/);
});

test('explicit save remains an error with useful feedback and never requests a second resume',async()=>{
  const f=fixture();f.view.bridge.invoke=async channel=>{f.calls.push(channel);throw Error("Error invoking remote method 'pi-plugin-panel-invoke': Error: GODOT_CANDIDATE_ACTIVE");};
  await f.view.action(f.view.saveManually,{resumeOnError:false});
  assert.deepEqual(f.calls,['godot.runtimeSave']);assert.equal(f.view.errorBox.hidden,false);
  assert.match(f.view.errorBox.textContent,/请完成后再保存/);assert.equal(f.view.loaded,true);assert.equal(f.loading.length,0);
});

test('autosave skips local preview, close and active page operations without changing prior UI state',async()=>{
  for(const field of ['busy','closing','preview','backupFrozen']){
    const f=fixture();f.view[field]=true;f.view.errorBox={hidden:false,textContent:'keep'};
    await f.view.autosave();assert.equal(f.calls.length,0);assert.equal(f.view.errorBox.textContent,'keep');
  }
});
