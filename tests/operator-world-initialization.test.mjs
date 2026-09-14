import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {confirmOperatorCreatedWorld,readOperatorInitializingRuntime} from './helpers/operator-world-initialization.mjs';

const timeout=()=>Error('Error: Craftmine Rust request timed out');
const worlds=(state='initializing',activeWorldId='new-world')=>({activeWorldId,worlds:[{id:'old-world',state:'ready'},{id:'new-world',state}]});
function fixture(script){
  let reads=0,cancelled=false,exited=false,uiError=null;
  const timeouts=[];
  const args={existingIds:new Set(['old-world']),readList:async()=>{reads++;assert(script.length,'fixture script exhausted');const value=script.shift();if(value instanceof Error||typeof value==='string')throw value;return value;},
    readUiError:async()=>uiError,onReadTimeout:error=>timeouts.push(error.message),
    until:async(read,accept)=>{for(;;){if(exited)throw Error('DESKTOP_EXITED');if(cancelled)throw Error('OPERATOR_CANCELLED');const value=await read();if(accept(value))return value;}}};
  return{args,timeouts,reads:()=>reads,cancel:()=>cancelled=true,exit:()=>exited=true,setUiError:value=>uiError=value};
}

test('a previously submitted creation survives exact read timeouts and requires its actual active ready row',async()=>{
  const f=fixture([timeout(),worlds('building'),timeout(),worlds('ready','old-world'),worlds('ready')]);
  const result=await confirmOperatorCreatedWorld(f.args);
  assert.equal(result.activeWorldId,'new-world');assert.equal(f.reads(),5);assert.equal(f.timeouts.length,2);
  assert.deepEqual(Object.keys(f.args).sort(),['existingIds','onReadTimeout','readList','readUiError','until'].sort(),'confirmation has no create/install/write callback');
});

test('terminal creation states are failures immediately, even before selection catches up',async()=>{
  for(const state of ['failed','cancelled','interrupted']){
    const f=fixture([worlds(state,'old-world'),worlds('ready')]);
    await assert.rejects(confirmOperatorCreatedWorld(f.args),/WORLD_INITIALIZATION_TERMINAL/);assert.equal(f.reads(),1);assert.equal(f.timeouts.length,0);
  }
});

test('unknown transport errors, malformed lists and multiple new worlds are never retried',async()=>{
  for(const error of [Error('Craftmine Rust request timed out unexpectedly'),Error('GODOT_INITIALIZATION_FAILED'),Error('PAGE_RPC_TIMEOUT:read'),Error('BACKUP_SWITCH_IN_PROGRESS'),'Craftmine Rust request timed out']){
    const f=fixture([error,worlds('ready')]);await assert.rejects(confirmOperatorCreatedWorld(f.args),value=>value===error);assert.equal(f.reads(),1);assert.equal(f.timeouts.length,0);
  }
  const malformed=fixture([{}]);await assert.rejects(confirmOperatorCreatedWorld(malformed.args),/WORLD_CONFIRMATION_INVALID_LIST/);
  const duplicate=fixture([{activeWorldId:'new-world',worlds:[{id:'new-world',state:'ready'},{id:'unexpected-world',state:'ready'}]}]);
  await assert.rejects(confirmOperatorCreatedWorld(duplicate.args),/WORLD_CONFIRMATION_MULTIPLE_NEW_WORLDS/);
});

test('UI errors are not mistaken for a transient list read; cancel and desktop exit stay owned by the caller',async()=>{
  const ui=fixture([worlds('ready')]);ui.setUiError('Craftmine Rust request timed out');await assert.rejects(confirmOperatorCreatedWorld(ui.args),/Craftmine Rust request timed out/);assert.equal(ui.reads(),0);
  for(const reason of ['cancel','exit']){
    const f=fixture([timeout(),worlds('ready')]);f.args.onReadTimeout=()=>f[reason]();
    await assert.rejects(confirmOperatorCreatedWorld(f.args),reason==='cancel'?/OPERATOR_CANCELLED/:/DESKTOP_EXITED/);assert.equal(f.reads(),1);
  }
});

test('reopening a cancelled or failed world reports its real state before waiting for a nonexistent runtime',async()=>{
  for(const state of ['failed','cancelled','interrupted']){
    let observations=0;
    const list=worlds(state);list.worlds[1].creation={error:{message:'No world runtime is running; WORLD_BUSY'}};
    let caught;
    try{await readOperatorInitializingRuntime({readList:async()=>list,observe:async()=>{observations++;},worldId:'new-world'});}catch(error){caught=error;}
    assert.equal(caught?.code,'WORLD_INITIALIZATION_TERMINAL');assert(caught.message.includes(state));assert.equal(observations,0);
    const source=fs.readFileSync(new URL('./product-agent-operator-native.mjs',import.meta.url),'utf8');
    const actual=source.slice(source.indexOf('async function until('),source.indexOf('\nasync function evaluate('));
    const until=Function('abort','ended','delay',actual+';return until;')({signal:{aborted:false}},false,()=>assert.fail('terminal errors must not be delayed or swallowed'));
    await assert.rejects(until(async()=>{throw caught;},()=>false),error=>error===caught);
  }
});

test('runtime confirmation retries only list timeouts and preserves actual observation and selection failures',async()=>{
  let observations=0,retries=0;
  const observe=async()=>{observations++;return {worldId:'new-world',instanceId:'real-instance'};};
  assert.equal(await readOperatorInitializingRuntime({readList:async()=>{throw timeout();},observe,worldId:'new-world',onReadTimeout:()=>retries++}),null);
  assert.equal(retries,1);assert.equal(observations,0);
  const observed=await readOperatorInitializingRuntime({readList:async()=>worlds('ready'),observe,worldId:'new-world'});
  assert.deepEqual(observed,{worldId:'new-world',instanceId:'real-instance'});assert.equal(observations,1);
  await assert.rejects(readOperatorInitializingRuntime({readList:async()=>worlds('ready','old-world'),observe,worldId:'new-world'}),/WORLD_CONFIRMATION_SELECTION_CHANGED/);
  await assert.rejects(readOperatorInitializingRuntime({readList:async()=>worlds('ready'),observe,worldId:'missing'}),/WORLD_CONFIRMATION_TARGET_MISSING/);
  const error=Error('GODOT_RUNTIME_RESTORE_FAILED');
  await assert.rejects(readOperatorInitializingRuntime({readList:async()=>worlds('ready'),observe:async()=>{throw error;},worldId:'new-world'}),value=>value===error);
});

test('only post-create confirmation routes use the helper and production timeouts remain unchanged',()=>{
  const source=fs.readFileSync(new URL('./product-agent-operator-native.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/await confirmCreatedWorld\(/g)??[]).length,3);
  assert(source.includes("const existingIds=new Set((await nav('world.list')).worlds.map(row=>row.id))"),'initial navigation is not silently retried by a creation-only classifier');
  assert(source.includes("scope:'read-only-world-list-confirmation',creationResubmitted:false"));
  const helper=fs.readFileSync(new URL('./helpers/operator-world-initialization.mjs',import.meta.url),'utf8');
  assert(helper.includes("from '../player-feedback/P8/initialization-poll.mjs'"));
  assert(!helper.includes('INITIALIZATION_DEADLINE_MS'));assert(!helper.includes('world.create'));
  const client=fs.readFileSync(new URL('../plugins/craftmine-world/core-client.cjs',import.meta.url),'utf8');
  assert(client.includes('call(method, params={}, timeoutMs=5000)'));
});
