import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const deps=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const {build}=createRequire(path.join(deps,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/version-diff-service-'));
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-history-panel-service.ts')],outfile:path.join(out,'service.mjs'),bundle:true,platform:'node',format:'esm'});
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-navigation-host.ts')],outfile:path.join(out,'navigation.mjs'),bundle:true,platform:'node',format:'esm'});
const {createGodotHistoryPanelService}=await import(pathToFileURL(path.join(out,'service.mjs')));
const {invokeCraftmineNavigation}=await import(pathToFileURL(path.join(out,'navigation.mjs')));
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
function fixture(){
  const state={selected:'world-a',repoId:'repo-a',head:B,applied:A,changes:[{status:'M',path:'world.gd'}],hook:null,calls:[]};
  const service=createGodotHistoryPanelService({selection:async()=>state.selected,domain:async(method,args)=>{
    state.calls.push({method,args});
    if(state.hook)await state.hook(method,args);
    if(method==='content.status')return {backend:'git',repoId:state.repoId,appliedOid:state.applied,branches:[{name:'refs/heads/main',oid:state.head}]};
    if(method==='godotProject.sourceContext')return {context:{projectId:'existing',sessionId:'existing',turnId:'ended'}};
    if(method==='godotProject.index')return {revision:1,manifestHash:'d'.repeat(64),files:[],nextOffset:null};
    if(method==='godotProject.read')return {path:args.path,text:'source'};
    if(method==='content.history')return {records:[{oid:B,subject:'current'},{oid:A,subject:'formal'}]};
    if(method==='content.changes')return {changes:state.changes};
    if(method==='content.diff')return {kind:'text',path:args.path,added:1,removed:1,patch:'-old\n+new\n'};
    throw Error('Unexpected '+method);
  }});
  return {state,service,load:()=>service.invoke('godot.historyLoad',{worldId:'world-a'}),compare:view=>service.invoke('godot.historyCompare',{worldId:'world-a',viewId:view.viewId,targetOid:B})};
}
test('history and source reads reuse actual context without starting or ending work',async()=>{
  const f=fixture(),view=await f.load();await f.service.invoke('godot.historyReadSource',{worldId:'world-a',revision:1,manifestHash:'d'.repeat(64),path:'world.gd'});await f.compare(view);
  assert.equal(f.state.calls.filter(x=>x.method==='godotProject.sourceContext').length,2);
  assert.ok(!f.state.calls.some(x=>/turn.begin|workspace.endTurn/.test(x.method)));
});
test('no source context is an honest read failure, never a synthetic task fallback',async()=>{
  const f=fixture();f.state.hook=async method=>{if(method==='godotProject.sourceContext')throw Error('GODOT_SOURCE_CONTEXT_UNAVAILABLE');};
  await assert.rejects(f.load(),/GODOT_SOURCE_CONTEXT_UNAVAILABLE/);assert.ok(!f.state.calls.some(x=>x.method==='turn.begin'));
});
test('world, repo, head and formal view identity changes all reject stale reads',async()=>{
  for(const [key,value] of [['selected','world-b'],['repoId','repo-b'],['head',C],['applied',C]]){
    const f=fixture(),view=await f.load();f.state[key]=value;await assert.rejects(f.compare(view),/GODOT_WORLD_CHANGED|GODOT_HISTORY_VIEW_STALE/);
  }
});
test('changes during an asynchronous read reject before returning bytes',async()=>{
  const f=fixture(),view=await f.load();f.state.hook=async method=>{if(method==='content.changes')f.state.applied=C;};
  await assert.rejects(f.compare(view),/GODOT_HISTORY_VIEW_STALE/);
});
test('forged target, view, unknown fields, page and arbitrary path are rejected',async()=>{
  const f=fixture(),view=await f.load(),base={worldId:'world-a',viewId:view.viewId,targetOid:B};
  for(const payload of [{...base,targetOid:C},{...base,viewId:'unknown'},{...base,context:{}},{...base,offset:-1},{...base,offset:2}])await assert.rejects(f.service.invoke('godot.historyCompare',payload),/INVALID_|STALE/);
  for(const path of ['../tasks.sqlite','C:/data/x','world.gd\0','*.gd',':(glob)**','another.gd'])await assert.rejects(f.service.invoke('godot.historyDiff',{...base,path}),/INVALID_HISTORY_DIFF_PATH/);
  assert.ok(!f.state.calls.some(x=>x.method==='content.diff'));
});
test('bounded view eviction invalidates the oldest token',async()=>{
  const f=fixture(),view=await f.load();for(let i=0;i<16;i++)await f.load();await assert.rejects(f.compare(view),/GODOT_HISTORY_VIEW_STALE/);
});
test('private Git diagnostic paths never reach renderer errors',async()=>{
  const f=fixture(),view=await f.load();f.state.hook=async method=>{if(method==='content.diff')throw Error('GIT_DIFF_FAILED D:/private/repo.git');};
  await assert.rejects(f.service.invoke('godot.historyDiff',{worldId:'world-a',viewId:view.viewId,targetOid:B,path:'world.gd'}),error=>error.message==='GODOT_HISTORY_READ_FAILED');
});
test('only finite history channels pass the Main navigation gateway',async()=>{
  const invoked=[],deps={invoke:async(channel,payload)=>{invoked.push(channel);return payload;}};
  for(const channel of ['godot.historyCompare','godot.historyDiff'])await invokeCraftmineNavigation({pluginId:'craftmine.world',channel,payload:{worldId:'world-a'}},deps);
  assert.equal(invoked.length,2);
  for(const channel of ['content.diff','content.readFile','godotProject.sourceContext'])await assert.rejects(invokeCraftmineNavigation({pluginId:'craftmine.world',channel,payload:{}},deps),/PERMISSION_DENIED/);
});
