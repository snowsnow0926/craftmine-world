import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const storage=new Map(); globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
globalThis.window=Object.assign(new EventTarget(),{setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout});
globalThis.requestAnimationFrame=window.requestAnimationFrame;globalThis.cancelAnimationFrame=clearTimeout;
let created=0;globalThis.fb02Api={createSession:async()=>({session:{id:'new-'+(++created),title:'New',mode:'build',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messageCount:0}})};
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/stores/app-store.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'host',setup(b){b.onResolve({filter:/lib\/api$/},()=>({path:'api',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const api=new Proxy({}, {get:(_target,key)=>(...args)=>globalThis.fb02Api[key](...args)});'}));}}]});
const {useAppStore,materializeDraftSession,restoreWorldEntrySession}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const original=useAppStore.getState();
const world={id:'plugin:craftmine.world/world',kind:'plugin',resource:'craftmine.world/world'};
const file={id:'file:private.txt',kind:'file',resource:'private.txt'};
function reset(){useAppStore.setState({...original,settings:{defaultMode:'build'},workspace:null,workPanelOpen:true,workPanelTabs:[world,file],activeWorkPanelTabId:world.id,workPanelContexts:{},workPanelFileRequest:{path:'private.txt',seq:1},activeSessionId:undefined,messages:[],retainedSessionIds:[],sessions:[]});}
test('actual materializeDraftSession retains the world while host create is pending and after send/attachment materialization',async()=>{
 reset(); let resolve; fb02Api.createSession=()=>new Promise(done=>resolve=done);
 const pending=materializeDraftSession();
 assert.equal(useAppStore.getState().workPanelOpen,true);assert.equal(useAppStore.getState().activeWorkPanelTabId,world.id);
 resolve({session:{id:'draft-materialized',title:'New',mode:'build',messageCount:0}});
 assert.equal(await pending,'draft-materialized');
 const state=useAppStore.getState();assert.equal(state.workPanelOpen,true);assert.equal(state.activeWorkPanelTabId,world.id);assert.deepEqual(state.workPanelTabs,[world]);assert.equal(state.workPanelFileRequest,null);
 assert.equal(state.workPanelContexts['@craftmine/home'].tabs.some(tab=>tab.id===file.id),true,'original files remain owned by home');
});
test('automatic review and plan files do not cover the world; explicit opening remains possible',()=>{
 const state=useAppStore.getState();state.openWorkPanelTabForSession(state.activeSessionId,{id:'review',kind:'review'},{background:true});
 assert.equal(useAppStore.getState().activeWorkPanelTabId,world.id);
 state.openWorkPanelTabForSession(state.activeSessionId,file,{background:true});assert.equal(useAppStore.getState().activeWorkPanelTabId,world.id);
 state.openWorkPanelTab(file);assert.equal(useAppStore.getState().activeWorkPanelTabId,file.id);
});
test('background session artifact never switches visible world or leaks its file',()=>{
 useAppStore.getState().openWorkPanelTab(world);
 useAppStore.getState().openWorkPanelTabForSession('another-session',{id:'file:other.txt',kind:'file',resource:'other.txt'},{background:true});
 assert.equal(useAppStore.getState().activeWorkPanelTabId,world.id);assert.ok(!useAppStore.getState().workPanelTabs.some(tab=>tab.resource==='other.txt'));
 assert.equal(useAppStore.getState().workPanelContexts['another-session'].activeTabId,'file:other.txt');
});

test('returning to a draft home restores its own files without keeping the created world session selected', async()=>{
 await restoreWorldEntrySession();const state=useAppStore.getState();assert.equal(state.activeSessionId,undefined);assert.equal(state.messages.length,0);assert.equal(state.activeWorkPanelTabId,world.id);assert.ok(state.workPanelTabs.some(tab=>tab.id===file.id));assert.ok(state.sessions.some(session=>session.id==='draft-materialized'),'created conversation is preserved');
});

test('a world pinned behind play artifacts follows the newly materialized session, but a create file workspace does not',async()=>{
 for(const mode of ['play','create']){
 reset();localStorage.setItem('craftmine.desktop.layout.v1',JSON.stringify({mode}));useAppStore.setState({activeWorkPanelTabId:file.id});fb02Api.createSession=async()=>({session:{id:'artifact-'+mode,title:'New',mode:'build',messageCount:0}});await materializeDraftSession();
 assert.equal(useAppStore.getState().workPanelOpen,mode==='play');assert.deepEqual(useAppStore.getState().workPanelTabs,mode==='play'?[world]:[]);
 }
});
