import test from 'node:test';
import assert from 'node:assert/strict';
import {createGodotMiningAcceptance} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-mining-acceptance.ts';

// Controller negative contracts only. These callbacks do not prove native play.
function fixture(){
  const calls=[];let instance='instance';
  const access={
    observe:async()=>({format:'craftmine.godot-observation/1',baseId:'mining-sandbox',baseVersion:'1.0.0',worldId:'world',buildId:'build',instanceId:instance,payload:{inventory:{wood:2},terrainHash:'terrain',player:{position:[128,160]},bootError:''}}),
    action:async(op,args)=>{
      calls.push({op,args});
      if(op==='snapshot')return {result:{state:{format:'craftmine.godot-progress/1',worldId:'world',baseId:'mining-sandbox',body:{worldId:'world',seed:31415926,terrainHash:'terrain',state:{worldId:'world',inventory:{wood:2}},chunks:{'0,0':{cells:{},revision:0}}}}}};
      if(op==='inventory')return {result:{ok:true,wood:2}};
      if(op==='move')return {result:{distance:1}};
      if(op==='tile')return {result:{ok:true,...args,material:'air',solid:false,breakable:false,requiredTier:0}};
      return {result:{ok:true}};
    },
    capture:async()=>{throw Error('capture must not run after failed route');},
    save:async()=>{throw Error('save must not run after failed route');},
  };
  return {access,calls,setInstance:value=>{instance=value;}};
}
test('unknown methods cannot become game state or source writes',async()=>{
  const f=fixture(),run=createGodotMiningAcceptance(f.access);
  for(const method of ['load','teleport','set_tile','prompt','godotPlay'])await assert.rejects(run(method),/Unknown fixed/);
  assert.equal(f.calls.length,0);
});
test('no dig target is a finite explicit failure with raw evidence and pause',async()=>{
  const f=fixture(),result=await createGodotMiningAcceptance(f.access)('godotPlayMine');
  assert.equal(result.ok,false);assert.match(result.error,/finds reachable/);
  assert.equal(f.calls.filter(c=>c.op==='tile').length,12);assert.equal(f.calls.at(-1).op,'pause');
  assert.ok(result.actions.every(a=>a.raw));
  assert.equal(f.calls.some(c=>['dig','place','craft','load','set_tile'].includes(c.op)),false);
});
test('actual runtime identity change is retained as failure and releases controller',async()=>{
  const f=fixture(),original=f.access.action;
  f.access.action=async(op,args)=>{const out=await original(op,args);f.setInstance('changed');return out;};
  const run=createGodotMiningAcceptance(f.access),result=await run('godotPlayMine');
  assert.equal(result.ok,false);assert.match(result.error,/Same runtime/);assert.equal(result.actions.length,1);
  const again=await run('godotPlayMine');assert.equal(again.ok,false);assert.match(again.error,/finds reachable/);
});
test('observation cannot replace the complete native chunk snapshot',async()=>{
  const f=fixture(),original=f.access.action;
  f.access.action=async(op,args)=>op==='snapshot'?{result:{state:await f.access.observe()}}:original(op,args);
  const result=await createGodotMiningAcceptance(f.access)('godotPlayMine');assert.equal(result.ok,false);assert.match(result.error,/Complete mining progress/);
});
